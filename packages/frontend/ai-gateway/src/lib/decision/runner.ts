// packages/frontend/ai-gateway/src/lib/decision/runner.ts
//
// The single place that decides accept / abstain (issue #381, contract C-566).
//
// Everything that must not be re-decided per call site lives here: explicit
// opt-in, readiness, language, oversize refusal, the shared absolute deadline,
// per-task boolean thresholds, reconstruction, and the original schema check.
// A caller that routes through this runner cannot accidentally bypass any of
// them, and a caller that does NOT route through it has changed nothing.
//
// The runner never retries and never picks a different backend. Choosing a
// fallback is a routing decision the caller owns; doing it here would hide a
// backend's failure rate inside an aggregate that still looks healthy.

import type { DecisionAdapter, DecisionRequest } from './adapters/types.ts';
import { buildDecisionDispatch } from './dispatch.ts';
import { resolveBooleanPolicy } from './policy.ts';
import { reconstructDecisionValue } from './reconstruct.ts';
import {
  DEFAULT_DECISION_LIMITS,
  type DecisionAbstentionReason,
  type DecisionAnswer,
  type DecisionCapability,
  type DecisionDispatchUnit,
  type DecisionPlan,
  type DecisionProvenance,
  type DecisionResult,
  type DecisionTaskPolicy,
} from './types.ts';

/** Everything one decision call needs. */
export type RunDecisionOptions = {
  /** A plan that has already passed `bindDecisionPolicy`. */
  readonly plan: DecisionPlan;
  /** The ORIGINAL schema. Used for the final validation, not the projection. */
  readonly schema: Record<string, unknown>;
  /** Task policy carrying the explicit opt-in and thresholds. */
  readonly policy: DecisionTaskPolicy;
  /** The backend to use. Callers choose it; this runner never auto-selects. */
  readonly adapter: DecisionAdapter;
  /** The text the backend will read. */
  readonly context: string;
  /** Absolute deadline in epoch ms. Never restarted by a retry. */
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly stateRevision: number;
  /** Existing domain validation, applied after the schema check. */
  readonly domainValidate?: (value: Record<string, unknown>) => boolean;
  /** Whether the compiled plan was reused. Recorded in provenance. */
  readonly planCacheHit?: boolean;
};

/** Accumulates timings across a call so provenance reflects the real work split. */
type TimingAccumulator = {
  queueMs: number;
  inferenceMs: number;
  validateMs: number;
};

/** Builds an abstention with a complete provenance record. */
const abstained = (options: {
  reason: DecisionAbstentionReason;
  adapter: DecisionAdapter;
  planCacheHit: boolean;
  startedAt: number;
  timings: TimingAccumulator;
  capability?: {
    readonly checkpoint?: string;
    readonly runtime?: string;
    readonly resourceId?: string;
  };
}): DecisionResult => {
  const provenance: DecisionProvenance = {
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    checkpoint: options.capability?.checkpoint,
    runtime: options.capability?.runtime,
    resourceId: options.capability?.resourceId,
    outcome: 'abstained',
    abstentionReason: options.reason,
    timings: {
      planMs: 0,
      queueMs: options.timings.queueMs,
      inferenceMs: options.timings.inferenceMs,
      validateMs: options.timings.validateMs,
      totalMs: Date.now() - options.startedAt,
    },
    planCacheHit: options.planCacheHit,
  };
  return { ok: false, abstained: true, reason: options.reason, provenance };
};

/**
 * Applies the task's boolean policy to one answer.
 *
 * Returns an abstention reason when the answer must be rejected or routed to
 * an LLM. Thresholds compare the probability for the answer, not confidence
 * or entropy. Confident answers are accepted without fallback.
 */
const booleanAcceptable = (options: {
  answer: DecisionAnswer;
  policy: ReturnType<typeof resolveBooleanPolicy>;
}): DecisionAbstentionReason | undefined => {
  const { answer, policy } = options;
  if (answer.probabilities === undefined) {
    return undefined;
  }
  const probabilities = answer.probabilities;
  const chosen = answer.booleanValue === true ? probabilities.true : probabilities.false;
  if (typeof chosen !== 'number' || !Number.isFinite(chosen) || chosen < 0 || chosen > 1) {
    return 'below-accept-threshold';
  }
  if (chosen >= policy.confidentProbability) {
    return undefined;
  }
  if (chosen < policy.acceptProbability) {
    return 'below-accept-threshold';
  }
  return policy.fallback === 'llm' ? 'llm-fallback-required' : 'below-accept-threshold';
};

/** Readiness, primitive and language gates before dispatch. */
const checkPreflight = (options: {
  capability: DecisionCapability;
  plan: DecisionPlan;
  policy: DecisionTaskPolicy;
}): DecisionAbstentionReason | undefined => {
  if (!options.capability.ready) {
    return 'backend-unavailable';
  }
  if (
    options.plan.questions.some(
      (question) => !options.capability.primitives.includes(question.kind),
    )
  ) {
    return 'schema-incompatible';
  }
  const language = options.policy.language ?? 'en';
  return options.capability.languages.includes(language) ? undefined : 'language-unsupported';
};

/** Collects every answer from the dispatched units, or the refusal that stopped it. */
const collectAnswers = async (options: {
  plan: DecisionPlan;
  units: readonly DecisionDispatchUnit[];
  adapter: DecisionAdapter;
  request: Omit<DecisionRequest, 'plan' | 'unit'>;
  timings: TimingAccumulator;
}): Promise<
  | {
      readonly ok: true;
      readonly answers: DecisionAnswer[];
      readonly checkpoint?: string;
      readonly runtime?: string;
    }
  | { readonly ok: false; readonly reason: DecisionAbstentionReason }
> => {
  const answers: DecisionAnswer[] = [];
  let checkpoint: string | undefined;
  let runtime: string | undefined;
  for (const unit of options.units) {
    if (options.request.signal.aborted) {
      return { ok: false, reason: 'cancelled' };
    }
    const response = await options.adapter.run({ ...options.request, plan: options.plan, unit });
    options.timings.queueMs += response.queueMs;
    options.timings.inferenceMs += response.inferenceMs;
    if (!response.ok) {
      return { ok: false, reason: response.reason };
    }
    answers.push(...response.answers);
    checkpoint = response.checkpoint ?? checkpoint;
    runtime = response.runtime ?? runtime;
  }
  return { ok: true, answers, checkpoint, runtime };
};

/** Applies the task's boolean policy to every boolean answer. */
const booleansAcceptable = (
  plan: DecisionPlan,
  answers: readonly DecisionAnswer[],
  policy: ReturnType<typeof resolveBooleanPolicy>,
): DecisionAbstentionReason | undefined => {
  const byKey = new Map(plan.questions.map((question) => [question.key, question]));
  const reasons = answers
    .filter((answer) => byKey.get(answer.questionKey)?.kind === 'boolean')
    .map((answer) => booleanAcceptable({ answer, policy }));
  // A rejected answer takes precedence over a request for fallback.
  return reasons.includes('below-accept-threshold')
    ? 'below-accept-threshold'
    : reasons.find((reason) => reason !== undefined);
};

/**
 * Runs one decision call end to end against a caller-chosen backend.
 *
 * @returns An accepted value with full provenance, or an explicit abstention
 *   with the reason. There is no third "maybe" outcome.
 */
export const runDecision = async (options: RunDecisionOptions): Promise<DecisionResult> => {
  const startedAt = Date.now();
  const planCacheHit = options.planCacheHit ?? false;
  const timings: TimingAccumulator = { queueMs: 0, inferenceMs: 0, validateMs: 0 };
  const abort = (reason: DecisionAbstentionReason): DecisionResult =>
    abstained({ reason, adapter: options.adapter, planCacheHit, startedAt, timings });

  if (!options.policy.enabled) {
    return abort('disabled-by-policy');
  }
  if (options.signal.aborted) {
    return abort('cancelled');
  }

  const capability = await options.adapter.capability({
    deadlineAt: options.deadlineAt,
    signal: options.signal,
  });
  if (options.signal.aborted) {
    return abort('cancelled');
  }
  if (Date.now() >= options.deadlineAt) {
    return abort('deadline-exceeded');
  }
  const preflight = checkPreflight({ capability, policy: options.policy, plan: options.plan });
  if (preflight !== undefined) {
    return abstained({
      reason: preflight,
      adapter: options.adapter,
      planCacheHit,
      startedAt,
      timings,
      capability,
    });
  }

  const limits = { ...DEFAULT_DECISION_LIMITS, ...options.policy.limits };
  const dispatch = buildDecisionDispatch({
    plan: options.plan,
    context: options.context,
    limits: {
      ...limits,
      maxOptions: Math.min(limits.maxOptions, capability.maxOptions),
      maxQuestions: Math.min(limits.maxQuestions, capability.maxQuestions),
      maxContextBytes: Math.min(limits.maxContextBytes, capability.maxContextBytes),
    },
  });
  if (!dispatch.ok) {
    return abort(
      dispatch.refusal.reason === 'context-too-large' ? 'context-too-large' : 'invalid-response',
    );
  }
  if (dispatch.units.length === 0) {
    return abort('invalid-response');
  }

  const collected = await collectAnswers({
    plan: options.plan,
    units: dispatch.units,
    adapter: options.adapter,
    request: {
      deadlineAt: options.deadlineAt,
      signal: options.signal,
      requestId: options.requestId,
      stateRevision: options.stateRevision,
    },
    timings,
  });
  if (!collected.ok) {
    return abort(collected.reason);
  }

  const observedCheckpoint = collected.checkpoint ?? capability.checkpoint;
  const observedRuntime = collected.runtime ?? capability.runtime;

  const booleanRefusal = booleansAcceptable(
    options.plan,
    collected.answers,
    resolveBooleanPolicy(options.policy),
  );
  if (booleanRefusal !== undefined) {
    return abstained({
      reason: booleanRefusal,
      adapter: options.adapter,
      planCacheHit,
      startedAt,
      timings,
      capability: { ...capability, checkpoint: observedCheckpoint, runtime: observedRuntime },
    });
  }

  const validateStarted = Date.now();
  const reconstruction = reconstructDecisionValue({
    plan: options.plan,
    answers: collected.answers,
    schema: options.schema,
    domainValidate: options.domainValidate,
  });
  timings.validateMs = Date.now() - validateStarted;

  const provenance: DecisionProvenance = {
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    checkpoint: observedCheckpoint,
    runtime: observedRuntime,
    resourceId: capability.resourceId,
    outcome: 'accepted',
    timings: {
      planMs: 0,
      queueMs: timings.queueMs,
      inferenceMs: timings.inferenceMs,
      validateMs: timings.validateMs,
      totalMs: Date.now() - startedAt,
    },
    planCacheHit,
  };

  if (!reconstruction.ok) {
    return {
      ok: false,
      abstained: true,
      reason: 'invalid-response',
      provenance: { ...provenance, outcome: 'abstained', abstentionReason: 'invalid-response' },
    };
  }

  return { ok: true, value: reconstruction.value, answers: collected.answers, provenance };
};
