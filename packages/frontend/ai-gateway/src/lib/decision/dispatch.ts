// packages/frontend/ai-gateway/src/lib/decision/dispatch.ts
//
// Group assembly and pre-dispatch bounds (issue #381, contract C-566).
//
// The rule this module exists to enforce: an oversized request is refused
// BEFORE it is dispatched. Silently truncating state, options or instructions
// would produce a confidently wrong answer from a model that never saw the
// thing it was asked about — and the truncation would be invisible in every
// downstream metric.

import {
  DEFAULT_DECISION_LIMITS,
  type DecisionDispatchUnit,
  type DecisionLimits,
  type DecisionPlan,
  type DecisionQuestion,
  type DecisionQuestionGroup,
} from './types.ts';
import { utf8ByteLength } from './util.ts';

/** Why a plan could not be assembled into dispatchable units. */
export type DecisionDispatchRefusal = {
  readonly reason: 'context-too-large' | 'question-limit-exceeded';
  readonly detail: string;
  /** UTF-8 byte length that triggered the refusal. */
  readonly size: number;
  /** Bound that was exceeded. */
  readonly limit: number;
};

/** Outcome of assembling a plan into dispatchable units. */
export type DecisionDispatchPlan =
  | { readonly ok: true; readonly units: readonly DecisionDispatchUnit[] }
  | { readonly ok: false; readonly refusal: DecisionDispatchRefusal };

/** Renders one question into its dispatch form, or `undefined` when unbound. */
const toDispatch = (
  question: DecisionQuestion,
): DecisionDispatchUnit['questions'][number] | undefined => {
  const instructions = question.instructions;
  if (instructions === undefined) {
    return undefined;
  }
  if (question.kind === 'boolean') {
    return { key: question.key, instructions };
  }
  if (question.kind === 'combination') {
    return {
      key: question.key,
      instructions,
      combinationOptions: question.combinationOptions,
      options: (question.combinationOptions ?? []).map((option) => ({
        key: option.key,
        value: option.label,
      })),
    };
  }
  return { key: question.key, instructions, options: question.options };
};

/**
 * Assembles a bound plan into dispatchable units.
 *
 * @param options.context - The text the backend will read. Sized here rather
 *   than at the adapter so every dialect gets the same bound.
 * @param options.limits - Bound overrides for this task.
 */
export const buildDecisionDispatch = (options: {
  plan: DecisionPlan;
  context: string;
  limits?: Partial<DecisionLimits>;
}): DecisionDispatchPlan => {
  const limits = { ...DEFAULT_DECISION_LIMITS, ...options.limits };
  const contextBytes = utf8ByteLength(options.context);
  if (contextBytes > limits.maxContextBytes) {
    return {
      ok: false,
      refusal: {
        reason: 'context-too-large',
        detail: `context is ${contextBytes} bytes; limit is ${limits.maxContextBytes}`,
        size: contextBytes,
        limit: limits.maxContextBytes,
      },
    };
  }

  const byKey = new Map(options.plan.questions.map((question) => [question.key, question]));
  const units: DecisionDispatchUnit[] = [];

  for (const group of options.plan.groups satisfies readonly DecisionQuestionGroup[]) {
    const questions = group.questionKeys
      .map((key) => byKey.get(key))
      .filter((question): question is DecisionQuestion => question !== undefined)
      .map(toDispatch)
      .filter((question): question is NonNullable<typeof question> => question !== undefined);

    if (questions.length === 0) {
      continue;
    }
    if (questions.length > limits.maxQuestions) {
      return {
        ok: false,
        refusal: {
          reason: 'question-limit-exceeded',
          detail: `group ${group.id} asks ${questions.length} questions; limit is ${limits.maxQuestions}`,
          size: questions.length,
          limit: limits.maxQuestions,
        },
      };
    }
    units.push({
      groupId: group.id,
      dispatch: group.dispatch,
      questions,
      state: options.context,
      stateBytes: contextBytes,
    });
  }

  return { ok: true, units };
};
