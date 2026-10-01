// packages/frontend/ai-gateway/src/lib/decision/adapters/deterministic_adapter.ts
//
// Deterministic baseline backend (issue #381, contract C-566).
//
// This is the CONTROL in every evaluation, not a competitor. It answers from an
// authored lexicon, has no checkpoint, and abstains whenever no rule matches —
// which is exactly what makes it useful: it measures the floor that keyword
// matching already achieves for free, so a decision model's measured gain has
// to beat a baseline that costs nothing and never hallucinates.
//
// It also gives the whole module something runnable with no model installed.

import type {
  DecisionAnswer,
  DecisionCapability,
  DecisionDispatchUnit,
  DecisionLiteral,
  DecisionPlan,
  DecisionQuestion,
} from '../types.ts';
import { pathKeyFor } from '../util.ts';
import type { DecisionAdapter, DecisionAdapterResponse, DecisionRequest } from './types.ts';

/** One authored lexicon rule. */
export type DeterministicRule = {
  /** Lowercase substrings; any match contributes this rule's weight. */
  readonly match: readonly string[];
  /** Weight added to this option when any substring matches. */
  readonly weight: number;
  /**
   * Literal VALUE this rule votes for. Omit for boolean questions.
   *
   * Value-keyed rather than option-key-keyed for the same reason the policy's
   * descriptions are: an authored rule that names `o0` silently votes for
   * whatever the compiler sorted into slot zero.
   */
  readonly value?: DecisionLiteral;
  /** Boolean value this rule votes for. Omit for choice questions. */
  readonly booleanValue?: boolean;
};

/**
 * The authored lexicon, keyed by ENCODED PROPERTY PATH.
 *
 * Keyed by path rather than by plan question key on purpose: question keys carry
 * a digest so they stay unique when two paths sanitize alike, which makes them
 * unusable as authoring handles. `pathKeyFor` is the readable encoding
 * (`command__kind`) and is what an author writes.
 */
export type DeterministicRuleSet = {
  /** Rules per encoded property path, e.g. `command__kind`. */
  readonly rules: Readonly<Record<string, readonly DeterministicRule[]>>;
};

/** Normalizes text for matching without lowercasing in a locale-dependent way. */
const normalizeContext = (text: string): string => text.toLowerCase();

/** Counts how many of a rule's substrings appear. */
const ruleScore = (rule: DeterministicRule, context: string): number => {
  let hits = 0;
  for (const needle of rule.match) {
    if (context.includes(needle.toLowerCase())) {
      hits += 1;
    }
  }
  return hits * rule.weight;
};

/** Converts raw scores into a distribution summing to 1. */
const toProbabilities = (scores: ReadonlyMap<string, number>): Record<string, number> => {
  const total = [...scores.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return {};
  }
  const probabilities: Record<string, number> = {};
  for (const [key, value] of scores) {
    probabilities[key] = value / total;
  }
  return probabilities;
};

/** The question shape the lexicon must match, derived from the unit. */
const questionShape = (
  unit: DecisionDispatchUnit,
  key: string,
): DecisionDispatchUnit['questions'][number] | undefined =>
  unit.questions.find((question) => question.key === key);

/** The plan question behind a dispatched question, for its readable path. */
const planQuestionFor = (plan: DecisionPlan, key: string): DecisionQuestion | undefined =>
  plan.questions.find((question) => question.key === key);

/** Builds the baseline's refusal for a run that could not answer. */
const abstainWith = (detail: string, startedAt: number): DecisionAdapterResponse => ({
  ok: false,
  reason: 'invalid-response',
  detail,
  queueMs: 0,
  inferenceMs: Date.now() - startedAt,
});

/** Answers every dispatched question in a unit against the authored lexicon. */
const answerUnit = (request: DecisionRequest, rules: DeterministicRuleSet): DecisionAnswer[] => {
  const text = normalizeContext(request.unit.state);
  return request.unit.questions.flatMap((question) => {
    const shape = questionShape(request.unit, question.key);
    if (shape === undefined) {
      return [];
    }
    const path = planQuestionFor(request.plan, question.key)?.path ?? [];
    const scored = scoreQuestion({
      questionKey: question.key,
      shape,
      rules: rules.rules[pathKeyFor(path)] ?? [],
      text,
    });
    return scored === undefined ? [] : [scored.answer];
  });
};

/** Resolves the option key an authored value-keyed rule votes for. */
const keyForValue = (
  shape: DecisionDispatchUnit['questions'][number],
  value: DecisionLiteral,
): string | undefined =>
  [
    ...(shape.options ?? []),
    // A combination carries a rendered label rather than a literal value.
    ...(shape.combinationOptions ?? []).map((option) => ({ key: option.key, value: option.label })),
  ].find((option) => option.value === value)?.key;

/** Scores one dispatched question against its authored rules. */
const scoreQuestion = (options: {
  questionKey: string;
  shape: DecisionDispatchUnit['questions'][number];
  rules: readonly DeterministicRule[];
  text: string;
}): { readonly answer: DecisionAnswer } | undefined => {
  const optionKeys = new Set(
    (options.shape.options ?? [])
      .map((option) => option.key)
      .concat(options.shape.combinationOptions?.map((option) => option.key) ?? []),
  );
  const scores = new Map<string, number>();
  const booleanVotes = new Map<boolean, number>();

  for (const rule of options.rules) {
    accumulateRule({
      rule,
      text: options.text,
      shape: options.shape,
      optionKeys,
      scores,
      booleanVotes,
    });
  }

  return resolveVote({ questionKey: options.questionKey, scores, booleanVotes });
};

/** Tallies one authored rule's contribution into the per-option score maps. */
const accumulateRule = (options: {
  rule: DeterministicRule;
  text: string;
  shape: DecisionDispatchUnit['questions'][number];
  optionKeys: ReadonlySet<string>;
  scores: Map<string, number>;
  booleanVotes: Map<boolean, number>;
}): void => {
  const score = ruleScore(options.rule, options.text);
  if (score === 0) {
    return;
  }
  if (options.rule.booleanValue !== undefined) {
    options.booleanVotes.set(
      options.rule.booleanValue,
      (options.booleanVotes.get(options.rule.booleanValue) ?? 0) + score,
    );
    return;
  }
  const key =
    options.rule.value === undefined ? undefined : keyForValue(options.shape, options.rule.value);
  if (key !== undefined && options.optionKeys.has(key)) {
    options.scores.set(key, (options.scores.get(key) ?? 0) + score);
  }
};

/** Turns tallied votes into one answer, or `undefined` when nothing voted. */
const resolveVote = (options: {
  questionKey: string;
  scores: ReadonlyMap<string, number>;
  booleanVotes: ReadonlyMap<boolean, number>;
}): { readonly answer: DecisionAnswer } | undefined => {
  if (options.booleanVotes.size > 0) {
    const total = [...options.booleanVotes.values()].reduce((sum, value) => sum + value, 0);
    const yes = options.booleanVotes.get(true) ?? 0;
    const probabilities = { true: yes / total, false: 1 - yes / total };
    return {
      answer: {
        questionKey: options.questionKey,
        booleanValue: probabilities.true >= probabilities.false,
        probabilities,
      },
    };
  }

  const best = [...options.scores.entries()].sort((left, right) => right[1] - left[1])[0];
  if (best === undefined) {
    return undefined;
  }
  return {
    answer: {
      questionKey: options.questionKey,
      optionKey: best[0],
      probabilities: toProbabilities(options.scores),
    },
  };
};

/**
 * Builds the deterministic adapter for a lexicon.
 *
 * @param options.rules - Authored lexicon keyed by encoded property path, e.g.
 *   `command__kind`. See {@link DeterministicRuleSet} for why not the plan
 *   question key.
 * @param options.backendId - Stable identity reported in provenance.
 */
export const createDeterministicDecisionAdapter = (options: {
  rules: DeterministicRuleSet;
  backendId?: string;
}): DecisionAdapter => {
  const backendId = options.backendId ?? 'deterministic-baseline';

  return {
    backendId,
    dialect: 'lexicon',

    async capability(): Promise<DecisionCapability> {
      return {
        backendId,
        dialect: 'lexicon',
        ready: true,
        primitives: ['boolean', 'choice', 'combination'],
        maxOptions: Number.MAX_SAFE_INTEGER,
        maxQuestions: Number.MAX_SAFE_INTEGER,
        maxContextBytes: Number.MAX_SAFE_INTEGER,
        languages: ['en'],
        checkpoint: 'authored-lexicon',
        runtime: 'in-process',
        resourceId: 'cpu',
      };
    },

    async run(request: DecisionRequest): Promise<DecisionAdapterResponse> {
      const started = Date.now();
      if (request.signal.aborted) {
        return {
          ok: false,
          reason: 'cancelled',
          detail: 'cancelled before scoring',
          queueMs: 0,
          inferenceMs: 0,
        };
      }

      const answers = answerUnit(request, options.rules);
      if (answers.length === 0) {
        return abstainWith(
          'no authored rule matched; the deterministic baseline abstains rather than guessing',
          started,
        );
      }
      if (answers.length !== request.unit.questions.length) {
        return abstainWith(
          `answered ${answers.length} of ${request.unit.questions.length} questions`,
          started,
        );
      }
      return { ok: true, answers, queueMs: 0, inferenceMs: Date.now() - started };
    },
  };
};
