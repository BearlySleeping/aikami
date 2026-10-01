// packages/frontend/ai-gateway/src/lib/decision/reconstruct.ts
//
// Answer → value, with the original schema as the final authority
// (issue #381, contract C-566).
//
// The compiler decides which questions are legal; this module decides whether
// the answers that came back produce a value the ORIGINAL schema accepts. Those
// are different questions, and only the second one protects the caller: a
// schema-valid value can still be domain-invalid (an `attack` step aimed at a
// dead actor), which is why validation is exposed as an injected predicate
// rather than assumed here.

import { schemaCheck } from '@aikami/schemas';
import type {
  DecisionAnswer,
  DecisionLiteral,
  DecisionPlan,
  DecisionQuestion,
  DecisionReconstruction,
  DecisionReconstructionFailure,
} from './types.ts';
import { safeSegment } from './util.ts';

/** Builds a reconstruction failure. */
const failure = (
  code: DecisionReconstructionFailure['code'],
  detail: string,
  questionKey?: string,
): DecisionReconstruction => ({
  ok: false,
  failure: { code, detail, questionKey },
});

/** A probability is usable only if it is finite and inside the unit interval. */
const isUsableProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Writes one value at a path without ever assigning through a prototype.
 *
 * Objects are created null-prototyped and populated with
 * `Object.defineProperty`, so a schema property named `__proto__` cannot mutate
 * the prototype chain even if it somehow reached this point. The analyzer
 * already rejects such names; this is the second, independent line.
 */
const writePath = (
  root: Record<string, unknown>,
  path: readonly string[],
  value: DecisionLiteral,
): void => {
  let cursor: Record<string, unknown> = root;
  for (const [index, segment] of path.entries()) {
    if (!safeSegment(segment)) {
      throw new Error(`refusing to write unsafe property name at depth ${index}`);
    }
    const isLeaf = index === path.length - 1;
    if (isLeaf) {
      Object.defineProperty(cursor, segment, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return;
    }
    const existing = cursor[segment];
    if (typeof existing !== 'object' || existing === null) {
      const child: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(cursor, segment, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      cursor = child;
      continue;
    }
    cursor = existing as Record<string, unknown>;
  }
};

/** Finds the answer for a question key. */
const answerFor = (
  answers: readonly DecisionAnswer[],
  questionKey: string,
): DecisionAnswer | undefined => answers.find((answer) => answer.questionKey === questionKey);

/** Reads the chosen option key for a question, or explains why it is unusable. */
const chosenOptionKey = (
  question: DecisionQuestion,
  answer: DecisionAnswer,
):
  | { readonly ok: true; readonly optionKey: string }
  | { readonly ok: false; readonly failure: DecisionReconstruction } => {
  const optionKey = answer.optionKey;
  if (optionKey === undefined) {
    return {
      ok: false,
      failure: failure(
        'missing-option-key',
        `question ${question.key} returned no option key`,
        question.key,
      ),
    };
  }
  const known = [...(question.options ?? []), ...(question.combinationOptions ?? [])].some(
    (option) => option.key === optionKey,
  );
  if (!known) {
    return {
      ok: false,
      failure: failure(
        'unknown-option-key',
        `option ${optionKey} is not part of question ${question.key}`,
        question.key,
      ),
    };
  }
  if (answer.probabilities !== undefined) {
    const value = answer.probabilities[optionKey];
    if (!isUsableProbability(value)) {
      return {
        ok: false,
        failure: failure(
          'probability-out-of-range',
          `probability for ${question.key}/${optionKey} is not a finite value in [0,1]`,
          question.key,
        ),
      };
    }
  }
  return { ok: true, optionKey };
};

/** Writes every constant and answer into `root`, or explains why it could not. */
const writePlanValue = (options: {
  plan: DecisionPlan;
  answers: readonly DecisionAnswer[];
  root: Record<string, unknown>;
}): DecisionReconstruction | undefined => {
  for (const constant of options.plan.constants) {
    writePath(options.root, constant.path, constant.value);
  }
  for (const question of options.plan.questions) {
    const answer = answerFor(options.answers, question.key);
    if (answer === undefined) {
      return failure('missing-answer', `no answer for question ${question.key}`, question.key);
    }
    if (question.kind === 'boolean') {
      if (typeof answer.booleanValue !== 'boolean') {
        return failure(
          'ambiguous-answer',
          `question ${question.key} expects a boolean answer`,
          question.key,
        );
      }
      writePath(options.root, question.path, answer.booleanValue);
      continue;
    }
    const chosen = chosenOptionKey(question, answer);
    if (!chosen.ok) {
      return chosen.failure;
    }
    const written = writeChoice(options.root, question, chosen.optionKey);
    if (!written.ok) {
      return written.failure;
    }
  }
  return undefined;
};

/** Writes one choice or combination answer at its question's path. */
const writeChoice = (
  root: Record<string, unknown>,
  question: DecisionQuestion,
  optionKey: string,
): { readonly ok: true } | { readonly ok: false; readonly failure: DecisionReconstruction } => {
  if (question.kind === 'combination') {
    const option = question.combinationOptions?.find((candidate) => candidate.key === optionKey);
    if (option === undefined) {
      return {
        ok: false,
        failure: failure(
          'unknown-option-key',
          `combination option ${optionKey} vanished`,
          question.key,
        ),
      };
    }
    for (const entry of option.values) {
      writePath(root, entry.path, entry.value);
    }
    return { ok: true };
  }
  const option = question.options?.find((candidate) => candidate.key === optionKey);
  if (option === undefined) {
    return {
      ok: false,
      failure: failure('unknown-option-key', `option ${optionKey} vanished`, question.key),
    };
  }
  writePath(root, question.path, option.value);
  return { ok: true };
};

/**
 * Rebuilds the original-shaped value from plan answers.
 *
 * Always re-validates against `schema` — the ORIGINAL schema, not the compiled
 * projection — so a compiler bug surfaces as a rejection rather than as a value
 * the rest of the game has to defend against.
 *
 * @param options.domainValidate - Optional existing domain validation. A value
 *   that satisfies the schema but violates game rules is schema-valid and must
 *   still be rejected; pass the caller's real validator here.
 */
export const reconstructDecisionValue = (options: {
  plan: DecisionPlan;
  answers: readonly DecisionAnswer[];
  schema: Record<string, unknown>;
  domainValidate?: (value: Record<string, unknown>) => boolean;
}): DecisionReconstruction => {
  const { plan, answers, schema } = options;
  const root = Object.create(null) as Record<string, unknown>;

  let writeFailure: DecisionReconstruction | undefined;
  try {
    writeFailure = writePlanValue({ plan, answers, root });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure(
      'unsafe-property-path',
      `plan contains an unaddressable property path: ${detail}`,
    );
  }
  if (writeFailure !== undefined) {
    return writeFailure;
  }

  for (const answer of answers) {
    if (!plan.questions.some((question) => question.key === answer.questionKey)) {
      return failure(
        'unknown-question-key',
        `answer references unknown question ${answer.questionKey}`,
        answer.questionKey,
      );
    }
  }

  const value = { ...root } as Record<string, unknown>;
  if (!schemaCheck(schema, value)) {
    return failure(
      'schema-validation-failed',
      'reconstructed value does not satisfy the original schema',
    );
  }
  if (options.domainValidate && !options.domainValidate(value)) {
    return failure(
      'schema-validation-failed',
      'reconstructed value failed existing domain validation',
    );
  }
  return { ok: true, value };
};
