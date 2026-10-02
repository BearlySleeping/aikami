// packages/frontend/ai-gateway/src/lib/decision/live_measurement.ts
//
// Live measurement entry point (issue #381).
//
// This file used to BE the scorer. It no longer computes anything: every
// metric, every gate and every slice now lives in `metrics.ts`, which this
// module and the deterministic harness and the evaluator CLI all call. There is
// exactly one implementation of "safe", and it is not the one that shipped with
// the wrong negative-case semantics.
//
// What changed, and why it matters:
//
//   - A command fired on a case labelled "no command is warranted" is an
//     UNSAFE ACCEPTANCE. It is counted as one, and it fails the gate. The old
//     scorer incremented coverage and returned early, which let two correct
//     positives plus one out-of-scope command report zero risky acceptance and
//     pass.
//   - "Ambiguous, two defensible readings" is a separate case kind (`excluded`)
//     rather than being conflated with a negative. An excluded case never
//     improves coverage and never becomes a false acceptance.
//   - `answeredAccuracy` was documented as "correct over answered positives" but
//     divided by every answered case. Both numbers are now reported separately:
//     `positiveRecall` (the gate) and `answeredPositiveAccuracy` (a diagnostic
//     that reads 1.000 for a backend that abstains on everything hard).
//   - A fixture's own language is dispatched with. It is no longer overwritten
//     by the policy language, so an unsupported slice abstains instead of being
//     answered in English.
//   - Cold/warm are established by `metrics.ts`, not asserted by a fixture.
//
// `skipped` is still NOT a pass. It means the environment could not produce a
// number and it says exactly why; #381 stays open on that distinction.

import type { DecisionAdapter } from './adapters/types.ts';
import { analyzeDecisionSchema } from './analyzer.ts';
import {
  type DecisionValueComparator,
  type EvaluationCase,
  type EvaluationLatencyGate,
  type EvaluationQualityGate,
  type EvaluationReport,
  evaluateQualityGates,
  evaluateSplit,
  type LegacyEvaluationCase,
  MIN_REPETITIONS_FOR_PERCENTILE,
} from './metrics.ts';
import { bindDecisionPolicy } from './policy.ts';
import type { DecisionLimits, DecisionTaskPolicy } from './types.ts';

export type { EvaluationLatencyGate, EvaluationQualityGate, EvaluationReport };
export { MIN_REPETITIONS_FOR_PERCENTILE };

/** One scored case. Accepted here so existing callers keep compiling. */
export type MeasurementCase = EvaluationCase | LegacyEvaluationCase;

/** Latency gate, reported against declared thresholds. */
export type MeasurementLatencyGate = EvaluationLatencyGate;

/** Frozen quality gates. Not defaulted here — the caller must supply them. */
export type MeasurementQualityGate = EvaluationQualityGate;

/**
 * Aggregate for one split.
 *
 * Kept as a flat alias of the shared slice so an old call site reading
 * `metrics.accuracy` still finds a number — but the names say what they mean:
 * `positiveRecall` is the gate, `answeredPositiveAccuracy` is a diagnostic.
 */
export type SplitMeasurement = EvaluationReport['overall'] & {
  /** Legacy name for {@link SplitMeasurement.positiveRecall}. */
  readonly accuracy: number;
  /** Cases carrying a non-null expected label. */
  readonly cases: number;
  /** Cases where a legal value was produced. */
  readonly answered: number;
  /** Accepted AND correct. */
  readonly correct: number;
  /** Share of cases that reached a decision. */
  readonly coverage: number;
  /** Answered but wrong on a case that required abstention. */
  readonly riskyFalseAcceptance: number;
};

/** What a measurement produced. */
export type LiveMeasurementResult =
  | {
      readonly status: 'measured';
      readonly backendId: string;
      readonly dialect: string;
      readonly task: string;
      readonly report: EvaluationReport;
      readonly splits: readonly SplitMeasurement[];
      /** Gate outcomes per split. */
      readonly gateFailures: readonly string[];
      readonly passed: boolean;
    }
  | {
      readonly status: 'skipped';
      /** Why nothing was measured. Never a failure dressed as a skip. */
      readonly reason: string;
    };

/** Measurement options. */
export type RunLiveMeasurementOptions = {
  /** Backend under test. Omit to obtain an explicit, reported skip. */
  readonly adapter?: DecisionAdapter;
  /** The task's real schema — never a substitute schema. */
  readonly schema: unknown;
  readonly policy: DecisionTaskPolicy;
  /** The caller's real fixtures, split by name. */
  readonly splits: Readonly<Record<string, readonly MeasurementCase[]>>;
  readonly qualityGate: MeasurementQualityGate;
  readonly latencyGate?: MeasurementLatencyGate;
  readonly limits?: Partial<DecisionLimits>;
  /** Per-call deadline. A cold model may legitimately exceed it; that is data. */
  readonly timeoutMs?: number;
  readonly domainValidate?: (value: Record<string, unknown>) => boolean;
  /** Validates the reconstructed value against the original schema. */
  readonly validateValue?: (value: unknown) => boolean;
  /** How to reduce a reconstructed value to the literal being graded. */
  readonly compareValue?: DecisionValueComparator;
  /** The task's "no command is warranted" literal, when the schema has one. */
  readonly safeLiteral?: string;
  /** Requests treated as cold before the warm condition is established. */
  readonly coldSamples?: number;
  /** Unmeasured dispatches that establish the warm condition. */
  readonly warmupRequests?: number;
};

/**
 * Compiles the schema and binds the policy, or explains the refusal.
 *
 * Everything the split runner needs is computed here so the runner body stays a
 * loop: a measurement entry point that also compiles, binds and gates is three
 * responsibilities in one function.
 */
const bindForMeasurement = (
  options: RunLiveMeasurementOptions,
):
  | {
      ok: true;
      planOptions: Omit<Parameters<typeof evaluateSplit>[0], 'split' | 'cases'>;
    }
  | { ok: false; reason: string } => {
  const analysis = analyzeDecisionSchema({
    schema: options.schema,
    limits: { ...options.policy.limits, ...options.limits },
  });
  if (!analysis.ok) {
    return {
      ok: false,
      reason: `schema does not compile: ${analysis.reasons.map((r) => r.code).join(', ')}`,
    };
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: options.policy });
  if (!binding.ok) {
    return {
      ok: false,
      reason: `policy does not bind: ${binding.reasons.map((r) => r.code).join(', ')}`,
    };
  }
  const adapter = options.adapter;
  if (adapter === undefined) {
    // Unreachable: the caller checked. Kept so this helper needs no cast.
    throw new Error('bindForMeasurement requires an adapter');
  }
  return {
    ok: true,
    planOptions: {
      adapter,
      plan: binding.plan,
      schema: options.schema as Record<string, unknown>,
      policy: options.policy,
      timeoutMs: options.timeoutMs ?? 5_000,
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(options.domainValidate === undefined ? {} : { domainValidate: options.domainValidate }),
      ...(options.validateValue === undefined ? {} : { validateValue: options.validateValue }),
      ...(options.compareValue === undefined ? {} : { compareValue: options.compareValue }),
      ...(options.safeLiteral === undefined ? {} : { safeLiteral: options.safeLiteral }),
      ...(options.coldSamples === undefined ? {} : { coldSamples: options.coldSamples }),
      ...(options.warmupRequests === undefined ? {} : { warmupRequests: options.warmupRequests }),
    },
  };
};

/**
 * Runs the gated measurement, or reports an explicit skip.
 *
 * A `skipped` result is NOT a pass and NOT a failure. It means the environment
 * could not produce a number, and it says exactly why.
 */
export const runLiveDecisionMeasurement = async (
  options: RunLiveMeasurementOptions,
): Promise<LiveMeasurementResult> => {
  if (options.adapter === undefined) {
    return {
      status: 'skipped',
      reason:
        'no decision backend adapter was supplied; nothing was measured and no result should be inferred from this',
    };
  }

  const bound = bindForMeasurement(options);
  if (!bound.ok) {
    return { status: 'skipped', reason: bound.reason };
  }

  const reports: EvaluationReport[] = [];
  for (const [name, cases] of Object.entries(options.splits)) {
    reports.push(await evaluateSplit({ ...bound.planOptions, split: name, cases }));
  }

  // Gates apply to the held-out split only. The dev split exists to be tuned
  // against; scoring a gate on it is how a threshold gets fitted to the data it
  // is then judged on.
  const heldOut = reports.find((report) => report.split === 'heldout');
  const gateFailures =
    heldOut === undefined
      ? ['no held-out split was measured']
      : evaluateQualityGates(heldOut, options.qualityGate, options.latencyGate);

  return {
    status: 'measured',
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    task: options.policy.task,
    report: reports[0] as EvaluationReport,
    splits: reports.map((report) => ({
      ...report.overall,
      accuracy: report.overall.positiveRecall,
      cases: report.overall.attempted,
      answered: report.overall.successful,
      correct: report.overall.correct,
      coverage: report.overall.coverage,
      riskyFalseAcceptance: report.overall.falseAcceptances,
    })),
    gateFailures,
    passed: gateFailures.length === 0,
  };
};

export { evaluateQualityGates, evaluateSplit };
