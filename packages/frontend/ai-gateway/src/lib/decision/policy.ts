// packages/frontend/ai-gateway/src/lib/decision/policy.ts
//
// Semantic opt-in and question construction (issue #381, contract C-566).
//
// Structural compatibility answers "could this schema be asked?". This module
// answers the different and harder question "should this task be asked?", and
// it refuses to guess. A field called `battle` is not an instruction; a schema
// `description` is authored text and is; a task with no `enabled` flag is not
// opted in, no matter how compatible its schema looks.
//
// Correlated fields get explicit treatment because the failure mode is silent
// and expensive: asking `action` and `target` independently permits
// `heal`+`enemy`, which is schema-legal and game-wrong.

import {
  DECISION_LANGUAGES,
  DEFAULT_DECISION_LIMITS,
  type DecisionBinding,
  type DecisionCombinationOption,
  type DecisionGroupDispatch,
  type DecisionIncompatibility,
  type DecisionLanguage,
  type DecisionLimits,
  type DecisionLiteral,
  type DecisionOption,
  type DecisionPlan,
  type DecisionQuestion,
  type DecisionQuestionGroup,
  type DecisionTaskPolicy,
} from './types.ts';
import { pathKeyFor, questionKeyFor } from './util.ts';

/** Shortest instruction text accepted as meaningful. */
const MIN_INSTRUCTION_LENGTH = 12;

/** Group id used for questions no correlation claimed. */
const INDEPENDENT_GROUP = 'independent';

/** Builds a single-reason failure. */
const fail = (
  code: DecisionIncompatibility['code'],
  path: readonly string[],
  detail: string,
): DecisionBinding => ({
  ok: false,
  reasons: [{ code, path, detail }],
});

/** Normalizes text for identifier comparison. */
const normalize = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Whether the text merely echoes one of the identifiers it is attached to. */
const isIdentifierEcho = (text: string | undefined, identifiers: readonly string[]): boolean => {
  if (text === undefined) {
    return false;
  }
  const candidate = normalize(text);
  if (candidate.length === 0) {
    return false;
  }
  return identifiers.some((identifier) => normalize(identifier) === candidate);
};

/**
 * Whether instruction text carries meaning rather than repeating an identifier.
 *
 * A field name, a path key, or the task id is not an instruction: a model asked
 * "battle" learns nothing it could not infer from the key it was handed.
 */
const isMeaningfulInstruction = (
  text: string | undefined,
  identifiers: readonly string[],
): boolean => {
  if (text === undefined) {
    return false;
  }
  const trimmed = text.trim();
  return trimmed.length >= MIN_INSTRUCTION_LENGTH && !isIdentifierEcho(trimmed, identifiers);
};

/**
 * Looks up authored option descriptions for one path.
 *
 * Descriptions are authored against the LITERAL VALUE, not the positional
 * option key. Positional keys are stable but opaque, and an author who writes
 * `o0: 'open the trade overlay'` against an enum the compiler reorders gets a
 * confidently mislabelled question. Value-keyed descriptions cannot desync.
 */
const descriptionsFor = (
  policy: DecisionTaskPolicy,
  path: readonly string[],
): Readonly<Record<string, string>> => policy.optionDescriptions?.[pathKeyFor(path)] ?? {};

/** Resolves one option's description, preferring its literal value. */
const descriptionFor = (
  descriptions: Readonly<Record<string, string>>,
  option: { readonly key: string; readonly value: unknown },
): string | undefined => descriptions[String(option.value)] ?? descriptions[option.key];

/** The per-path option lists a correlated expansion multiplies. */
type CombinationInput = {
  readonly question: DecisionQuestion;
  readonly options: readonly DecisionOption[];
};

/**
 * Bounded Cartesian product, filtered to the task's explicit legal tuples.
 *
 * Returns `undefined` the moment the product would exceed the bound, so a wide
 * cross product never reaches the wire — an unbounded expansion is a latency
 * and context problem, not a correctness one.
 */
const expandCombinations = (
  inputs: readonly CombinationInput[],
  maxCombinations: number,
  legalTuples: readonly (readonly DecisionLiteral[])[],
): readonly DecisionCombinationOption[] | undefined => {
  let tuples: { values: { path: readonly string[]; value: DecisionLiteral }[] }[] = [
    { values: [] },
  ];
  for (const input of inputs) {
    const expanded: { values: { path: readonly string[]; value: DecisionLiteral }[] }[] = [];
    for (const tuple of tuples) {
      for (const option of input.options) {
        expanded.push({
          values: [...tuple.values, { path: [...input.question.path], value: option.value }],
        });
        if (expanded.length > maxCombinations) {
          return undefined;
        }
      }
    }
    tuples = expanded;
  }
  return tuples
    .filter((tuple) =>
      legalTuples.some(
        (legal) =>
          legal.length === tuple.values.length &&
          tuple.values.every((entry, index) => entry.value === legal[index]),
      ),
    )
    .map((tuple, index) => ({
      key: `o${index}`,
      label: '',
      values: tuple.values,
    }));
};

/** Resolves the acceptance policy a task declared, or the conservative default. */
export const resolveBooleanPolicy = (
  policy: DecisionTaskPolicy,
): {
  readonly acceptProbability: number;
  readonly confidentProbability: number;
  readonly fallback: 'reject' | 'llm';
} => ({
  acceptProbability: policy.booleanPolicy?.acceptProbability ?? 0.9,
  confidentProbability: policy.booleanPolicy?.confidentProbability ?? 0.98,
  fallback: policy.booleanPolicy?.fallback ?? 'reject',
});

/**
 * Resolves the authored text and option descriptions for one question.
 *
 * Every refusal here is a semantic one: the schema compiled, but the task has
 * not told us what it is asking, in a way a model could act on.
 */
const resolveQuestion = (
  question: DecisionQuestion,
  policy: DecisionTaskPolicy,
):
  | { readonly ok: true; readonly question: DecisionQuestion }
  | { readonly ok: false; readonly reasons: DecisionIncompatibility[] } => {
  const key = pathKeyFor(question.path);
  const localIdentifiers = [key, ...question.path, question.key];
  const authored = policy.fieldInstructions?.[key] ?? question.description;
  const refuse = (
    code: DecisionIncompatibility['code'],
    detail: string,
  ): { ok: false; reasons: DecisionIncompatibility[] } => ({
    ok: false,
    reasons: [{ code, path: question.path, detail }],
  });

  if (authored === undefined) {
    return refuse(
      'missing-field-instructions',
      `field ${key} has no instruction and its schema carries no description`,
    );
  }
  if (isIdentifierEcho(authored, localIdentifiers)) {
    return refuse(
      'opaque-field-name',
      `instruction for ${key} only repeats the field name; a name is not a question`,
    );
  }
  if (!isMeaningfulInstruction(authored, localIdentifiers)) {
    return refuse(
      'missing-field-instructions',
      `instruction for ${key} is shorter than ${MIN_INSTRUCTION_LENGTH} characters`,
    );
  }
  if (question.kind === 'boolean') {
    return { ok: true, question: { ...question, instructions: authored.trim() } };
  }

  const descriptions = descriptionsFor(policy, question.path);
  const described = (question.options ?? []).map((option) => {
    const description = descriptionFor(descriptions, option);
    return {
      ...option,
      description:
        description !== undefined &&
        isMeaningfulInstruction(description, [option.key, String(option.value)])
          ? description.trim()
          : undefined,
    };
  });
  if (described.length === 0 || described.some((option) => option.description === undefined)) {
    return refuse(
      'missing-option-descriptions',
      `field ${key} needs a description for every option`,
    );
  }
  return {
    ok: true,
    question: {
      ...question,
      instructions: authored.trim(),
      options: described as DecisionOption[],
    },
  };
};

/**
 * Applies every declared correlation to the question set.
 *
 * Returns the rewritten question list, or a refusal when a declared
 * correlation has no handling or cannot be expanded inside the bound.
 */
const applyCorrelations = (options: {
  questions: readonly DecisionQuestion[];
  policy: DecisionTaskPolicy;
  limits: DecisionLimits;
}):
  | { readonly ok: true; readonly questions: DecisionQuestion[] }
  | { readonly ok: false; readonly reasons: DecisionIncompatibility[] } => {
  const questionByKey = new Map(options.questions.map((question) => [question.key, question]));
  let working = [...options.questions];

  for (const correlation of options.policy.correlations ?? []) {
    const members = correlation.paths
      .map((path) => questionByKey.get(questionKeyFor(path)))
      .filter((question): question is DecisionQuestion => question !== undefined);
    if (members.length < 2) {
      continue;
    }
    const label = correlation.paths.map(pathKeyFor).join(' + ');

    if (correlation.mode === 'reject' || correlation.mode === 'staged') {
      return {
        ok: false,
        reasons: [
          {
            code: 'correlated-fields-unsupported',
            path: members[0]?.path ?? [],
            detail: `fields ${label} require combination mode with explicit legal tuples; ${correlation.mode} emits no questions`,
          },
        ],
      };
    }
    const inputs: CombinationInput[] = members.map((question) => ({
      question,
      options: (question.options ?? []).filter((option) => option.description !== undefined),
    }));
    const tuples = expandCombinations(
      inputs,
      options.limits.maxCombinations,
      correlation.legalTuples ?? [],
    );
    if (tuples === undefined) {
      return {
        ok: false,
        reasons: [
          {
            code: 'combination-limit-exceeded',
            path: members[0]?.path ?? [],
            detail: `candidate combinations for ${label} exceed the bound of ${options.limits.maxCombinations}; expand deliberately or fall back`,
          },
        ],
      };
    }

    if (tuples.length === 0) {
      return {
        ok: false,
        reasons: [
          {
            code: 'correlated-fields-unsupported',
            path: members[0]?.path ?? [],
            detail: `only choice fields with explicit matching legal tuples can be combined: ${label}`,
          },
        ],
      };
    }

    const memberKeys = new Set(members.map((member) => member.key));
    working = [
      ...working.filter((question) => !memberKeys.has(question.key)),
      combinationQuestion(members, inputs, tuples, label),
    ];
  }

  return { ok: true, questions: working };
};

/** The dispatch mode a group id encodes. */
const dispatchFor = (groupId: string): DecisionGroupDispatch => {
  if (groupId === INDEPENDENT_GROUP) {
    return 'independent';
  }
  return groupId.startsWith('staged:') ? 'staged' : 'combination';
};

/** Builds the single legal-combination question from an expanded tuple set. */
const combinationQuestion = (
  members: readonly DecisionQuestion[],
  inputs: readonly CombinationInput[],
  tuples: readonly DecisionCombinationOption[],
  label: string,
): DecisionQuestion => ({
  key: questionKeyFor(members[0]?.path ?? ['combination']),
  path: members[0]?.path ?? ['combination'],
  kind: 'combination',
  instructions: members
    .map((member) => member.instructions ?? '')
    .filter((text) => text.length > 0)
    .join(' Pick one combination that satisfies both together.'),
  combinationOptions: tuples.map((tuple, index) => ({
    key: `o${index}`,
    label: tuple.values
      .map((entry) => {
        const source = inputs.find((input) => input.question.key === questionKeyFor(entry.path));
        const option = source?.options.find((candidate) => candidate.value === entry.value);
        return option?.description ?? String(entry.value);
      })
      .join(' + '),
    values: tuple.values,
  })),
  groupId: `combination:${label}`,
});

/**
 * Applies task semantics to a structurally valid plan.
 *
 * @param options.plan - Output of `analyzeDecisionSchema`.
 * @param options.policy - The task's explicit opt-in and authored metadata.
 * @param options.supportedLanguages - Languages the target checkpoint declares.
 */
export const bindDecisionPolicy = (options: {
  plan: DecisionPlan;
  policy: DecisionTaskPolicy;
  supportedLanguages?: readonly DecisionLanguage[];
}): DecisionBinding => {
  const { plan, policy } = options;

  if (!policy.enabled) {
    return fail(
      'semantic-opt-in-required',
      [],
      `task ${policy.task} has not opted in to decision inference`,
    );
  }

  const language = policy.language ?? 'en';
  if (!DECISION_LANGUAGES.includes(language)) {
    return fail('unsupported-language', [], `language ${language} is not a decision language tag`);
  }
  if (options.supportedLanguages && !options.supportedLanguages.includes(language)) {
    return fail(
      'unsupported-language',
      [],
      `checkpoint declares [${options.supportedLanguages.join(', ')}]; task needs ${language}`,
    );
  }

  if (policy.booleanPolicy) {
    const { acceptProbability, confidentProbability } = policy.booleanPolicy;
    if (
      !Number.isFinite(acceptProbability) ||
      !Number.isFinite(confidentProbability) ||
      acceptProbability < 0 ||
      confidentProbability > 1 ||
      acceptProbability > confidentProbability
    ) {
      return fail(
        'invalid-boolean-policy',
        [],
        `boolean thresholds must satisfy 0 <= acceptProbability <= confidentProbability <= 1, got ${acceptProbability}/${confidentProbability}`,
      );
    }
  }

  const identifiers = [policy.task, ...plan.questions.map((question) => question.key)];
  if (!isMeaningfulInstruction(policy.instructions, identifiers)) {
    return fail(
      'missing-task-instructions',
      [],
      `task ${policy.task} must carry meaningful instructions, not an identifier`,
    );
  }

  // ---- resolve per-question text and option descriptions ----
  const resolved = plan.questions.map((question) => resolveQuestion(question, policy));
  const reasons = resolved.flatMap((entry) => (entry.ok ? [] : entry.reasons));
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  const questions = resolved.flatMap((entry) => (entry.ok ? [entry.question] : []));

  // ---- correlated fields ----
  const limits = { ...DEFAULT_DECISION_LIMITS, ...policy.limits };
  const correlated = applyCorrelations({ questions, policy, limits });
  if (!correlated.ok) {
    return correlated;
  }
  const working = correlated.questions;

  // ---- groups ----
  const groupIds = [...new Set(working.map((question) => question.groupId))].sort();
  const groups: DecisionQuestionGroup[] = groupIds.map((groupId) => ({
    id: groupId,
    questionKeys: working
      .filter((question) => question.groupId === groupId)
      .map((question) => question.key),
    dispatch: dispatchFor(groupId),
  }));

  return { ok: true, plan: { ...plan, questions: working, groups }, groups };
};
