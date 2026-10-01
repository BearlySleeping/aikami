// packages/frontend/ai-gateway/src/lib/decision/live_measurement.ts
//
// The live measurement consumer (issue #381, contract C-567).
//
// C-566 named this gap itself and it is why #381 is still open: *"No such
// consumer exists yet."* It shipped the fixtures, the frozen gates and a
// deterministic harness, and then had nothing to point at a real backend.
//
// This module is that consumer. It is the single missing link between "a
// backend now exists" and "we have a number", and it is deliberately hard to
// misuse:
//
//   - It NEVER invents a measurement. With no adapter it returns `skipped`
//     with the reason, and `passed` is only ever true when real samples were
//     scored against the frozen gates.
//   - It scores ACCEPTED and ABSTAINED cases separately. A backend that
//     abstains on everything scores 0 coverage and 0 accuracy, so it cannot
//     "win" by refusing to answer.
//   - It refuses percentile claims below a declared repetition count. C-566
//     already warns that this corpus is far too small for a confidence
//     interval; quoting a p95 off three samples would repeat that mistake in
//     a new place.
//
// Nothing here talks to a backend the caller did not hand it, and nothing
// downloads or upgrades a runtime.

import type { DecisionAdapter } from './adapters/types.ts';
import { analyzeDecisionSchema } from './analyzer.ts';
import { bindDecisionPolicy } from './policy.ts';
import { runDecision } from './runner.ts';
import type { DecisionLimits, DecisionPlan, DecisionTaskPolicy } from './types.ts';

/**
 * Minimum samples before a percentile is reported at all.
 *
 * Below this the harness reports min/median/max and says the percentile is
 * unavailable. A p95 over a handful of samples is not a latency measurement,
 * it is a rounding of the maximum.
 */
export const MIN_REPETITIONS_FOR_PERCENTILE = 20;

/** One scored case. */
export type MeasurementCase = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  /** Authored label, or `'ambiguous'` when two readings are defensible. */
  readonly label: string;
  /** Expected literal, or `null` for ambiguous/out-of-scope cases. */
  readonly expected: string | null;
  /** The state text sent to the backend. */
  readonly state: string;
  /** Caller establishes the cache condition before the case; unlabelled samples cannot satisfy latency gates. */
  readonly latencyCondition?: 'cold' | 'warm';
};

/** Frozen quality gates. Not defaulted here — the caller must supply them. */
export type MeasurementQualityGate = {
  readonly minHeldOutAccuracy: number;
  readonly maxRiskyFalseAcceptance: number;
  readonly minCoverage: number;
  readonly requireLegalValueRate: number;
};

/** Latency gate, reported against declared thresholds. */
export type MeasurementLatencyGate = {
  readonly maxWarmP50Ms: number;
  readonly maxWarmP95Ms: number;
  readonly maxColdP95Ms: number;
};

/** Aggregate for one split. */
export type SplitMeasurement = {
  readonly split: string;
  readonly cases: number;
  /** Cases carrying a non-null expected label. */
  readonly positives: number;
  /** Cases where a legal value was produced. */
  readonly answered: number;
  /** Accepted AND correct. */
  readonly correct: number;
  /**
   * Correct over ANSWERED positives only.
   *
   * Diagnostic, never a gate. C-566's headline finding was that this number
   * reads 1.000 for a backend that abstains on every hard case, which is
   * survivorship bias, not quality.
   */
  readonly answeredAccuracy: number;
  /** Correct over ALL positives; abstention counts as a miss. This is the gate. */
  readonly accuracy: number;
  /** Share of cases that reached a decision. */
  readonly coverage: number;
  /** Share of produced values that satisfied the original schema. */
  readonly legalValueRate: number;
  /** Answered but wrong. The expensive failure mode. */
  readonly riskyFalseAcceptance: number;
  /** End-to-end milliseconds per case, including abstentions. */
  readonly latenciesMs: readonly number[];
  /** Median, or `undefined` with no answered case. */
  readonly medianMs?: number;
  /** Only present when `latenciesMs.length >= MIN_REPETITIONS_FOR_PERCENTILE`. */
  readonly p95Ms?: number;
  /** Median of explicitly warm samples. */
  readonly warmMedianMs?: number;
  /** Warm/cold p95 require the minimum repetitions in that condition. */
  readonly warmP95Ms?: number;
  readonly coldP95Ms?: number;
  /** Why a percentile is absent, when it is. */
  readonly percentileUnavailable?: string;
  /** Abstention codes and how often each occurred. */
  readonly abstentions: Readonly<Record<string, number>>;
};

/** What a measurement produced. */
export type LiveMeasurementResult =
  | {
      readonly status: 'measured';
      readonly backendId: string;
      readonly dialect: string;
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
};

/** Monotonic milliseconds for both latency timestamps. */
const now = (): number => performance.now();

/** Percentile by nearest-rank. Callers gate on repetition count first. */
const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
};

/** Median of an already-populated list. */
const median = (sorted: readonly number[]): number | undefined => {
  if (sorted.length === 0) {
    return undefined;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** Running tally for one split, so the loop body stays flat. */
type Tally = {
  answered: number;
  correct: number;
  legal: number;
  positives: number;
  risky: number;
  latencies: number[];
  warmLatencies: number[];
  coldLatencies: number[];
  abstentions: Record<string, number>;
};

/** Runs one fixture case and folds its outcome into the tally. */
const scoreCase = async (
  options: Parameters<typeof measureSplit>[0],
  testCase: MeasurementCase,
  index: number,
  tally: Tally,
): Promise<void> => {
  // Count the denominator BEFORE dispatch. Counting only answered cases would
  // divide by however many the backend was willing to attempt, which is the
  // survivorship bias this harness exists to expose: a backend that abstains
  // on every hard case would score a perfect accuracy.
  const isScored = testCase.expected !== null;
  if (isScored) {
    tally.positives += 1;
  }

  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  // One request id per case: request identity is what lets a caller reject a
  // late result, and a measurement that reused one id would hide exactly the
  // staleness we care about.
  const result = await runDecision({
    plan: options.plan,
    schema: options.schema,
    policy: { ...options.policy, limits: { ...options.policy.limits, ...options.limits } },
    adapter: options.adapter,
    context: testCase.state,
    deadlineAt: Date.now() + options.timeoutMs,
    signal: controller.signal,
    requestId: `measure:${options.split}:${testCase.caseId}:${index}`,
    stateRevision: index,
    domainValidate: options.domainValidate,
  });
  clearTimeout(timer);
  const latency = now() - started;
  tally.latencies.push(latency);
  if (testCase.latencyCondition === 'warm') {
    tally.warmLatencies.push(latency);
  } else if (testCase.latencyCondition === 'cold') {
    tally.coldLatencies.push(latency);
  }

  if (!result.ok) {
    tally.abstentions[result.reason] = (tally.abstentions[result.reason] ?? 0) + 1;
    return;
  }

  tally.answered += 1;
  if (options.validateValue?.(result.value) ?? true) {
    tally.legal += 1;
  }
  // Ambiguous cases carry no expected value: they count toward coverage, but
  // never toward correctness in either direction.
  if (!isScored) {
    return;
  }
  const produced = result.value.commandKind ?? Object.values(result.value)[0];
  if (produced === testCase.expected) {
    tally.correct += 1;
  } else {
    tally.risky += 1;
  }
};

/** Folds a tally into the reported row, withholding an unearned percentile. */
const summarize = (split: string, total: number, tally: Tally): SplitMeasurement => {
  const sorted = [...tally.latencies].sort((a, b) => a - b);
  const reportedMedian = median(sorted);
  const warm = [...tally.warmLatencies].sort((a, b) => a - b);
  const cold = [...tally.coldLatencies].sort((a, b) => a - b);
  const hasRepetitions = sorted.length >= MIN_REPETITIONS_FOR_PERCENTILE;

  return {
    split,
    cases: total,
    positives: tally.positives,
    answered: tally.answered,
    correct: tally.correct,
    answeredAccuracy: tally.answered === 0 ? 0 : tally.correct / tally.answered,
    accuracy: tally.positives === 0 ? 0 : tally.correct / tally.positives,
    coverage: total === 0 ? 0 : tally.answered / total,
    legalValueRate: tally.answered === 0 ? 0 : tally.legal / tally.answered,
    riskyFalseAcceptance: tally.answered === 0 ? 0 : tally.risky / tally.answered,
    latenciesMs: tally.latencies,
    warmMedianMs: median(warm),
    warmP95Ms: warm.length >= MIN_REPETITIONS_FOR_PERCENTILE ? percentile(warm, 95) : undefined,
    coldP95Ms: cold.length >= MIN_REPETITIONS_FOR_PERCENTILE ? percentile(cold, 95) : undefined,
    ...(reportedMedian === undefined ? {} : { medianMs: reportedMedian }),
    ...(hasRepetitions
      ? { p95Ms: percentile(sorted, 95) }
      : {
          percentileUnavailable: `${sorted.length} sample(s); a percentile needs ${MIN_REPETITIONS_FOR_PERCENTILE}. Reporting p95 here would be rounding the maximum.`,
        }),
    abstentions: tally.abstentions,
  };
};

/**
 * Scores one split against a backend.
 *
 * Reports accepted and abstained cases separately by construction: `accuracy`
 * divides by ALL positives so an abstention is a miss, and `coverage` exposes
 * how often the backend declined to answer at all.
 */
export const measureSplit = async (options: {
  split: string;
  cases: readonly MeasurementCase[];
  adapter: DecisionAdapter;
  plan: DecisionPlan;
  schema: Record<string, unknown>;
  policy: DecisionTaskPolicy;
  timeoutMs: number;
  limits?: Partial<DecisionLimits>;
  domainValidate?: (value: Record<string, unknown>) => boolean;
  validateValue?: (value: unknown) => boolean;
}): Promise<SplitMeasurement> => {
  const tally: Tally = {
    answered: 0,
    correct: 0,
    legal: 0,
    positives: 0,
    risky: 0,
    latencies: [],
    warmLatencies: [],
    coldLatencies: [],
    abstentions: {},
  };
  for (const [index, testCase] of options.cases.entries()) {
    await scoreCase(options, testCase, index, tally);
  }
  return summarize(options.split, options.cases.length, tally);
};

/**
 * Applies the frozen quality gates to one split.
 *
 * Kept separate from the runner so the gate list can be read as a list: these
 * thresholds were declared before any backend was scored, and a measurement
 * that quietly moved one would be worthless.
 */
const evaluateGates = (
  split: SplitMeasurement | undefined,
  gate: MeasurementQualityGate,
  latencyGate: MeasurementLatencyGate | undefined,
): string[] => {
  if (split === undefined) {
    return ['no held-out split was measured'];
  }
  const failures: string[] = [];
  if (split.accuracy < gate.minHeldOutAccuracy) {
    failures.push(`accuracy ${split.accuracy.toFixed(3)} < required ${gate.minHeldOutAccuracy}`);
  }
  if (split.riskyFalseAcceptance > gate.maxRiskyFalseAcceptance) {
    failures.push(
      `risky false acceptance ${split.riskyFalseAcceptance.toFixed(3)} > allowed ${gate.maxRiskyFalseAcceptance}`,
    );
  }
  if (split.coverage < gate.minCoverage) {
    failures.push(`coverage ${split.coverage.toFixed(3)} < required ${gate.minCoverage}`);
  }
  if (split.legalValueRate < gate.requireLegalValueRate) {
    failures.push(
      `legal value rate ${split.legalValueRate.toFixed(3)} < required ${gate.requireLegalValueRate}`,
    );
  }
  if (latencyGate === undefined) {
    return failures;
  }
  for (const [label, value, threshold] of [
    ['warm p50', split.warmMedianMs, latencyGate.maxWarmP50Ms],
    ['warm p95', split.warmP95Ms, latencyGate.maxWarmP95Ms],
    ['cold p95', split.coldP95Ms, latencyGate.maxColdP95Ms],
  ] as const) {
    if (value === undefined) {
      failures.push(`${label} latency gate could not be evaluated: insufficient labelled samples`);
    } else if (value > threshold) {
      failures.push(`${label} ${value} ms > allowed ${threshold} ms`);
    }
  }
  return failures;
};

/**
 * Runs the gated measurement, or reports an explicit skip.
 *
 * A `skipped` result is NOT a pass and NOT a failure. It means the environment
 * could not produce a number, and it says exactly why. That distinction is the
 * point: #381 stays open because this has never returned `measured` on a real
 * backend, and it must be impossible to mistake silence for success.
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

  const analysis = analyzeDecisionSchema({
    schema: options.schema,
    limits: { ...options.policy.limits, ...options.limits },
  });
  if (!analysis.ok) {
    return {
      status: 'skipped',
      reason: `schema does not compile: ${analysis.reasons.map((r) => r.code).join(', ')}`,
    };
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: options.policy });
  if (!binding.ok) {
    return {
      status: 'skipped',
      reason: `policy does not bind: ${binding.reasons.map((r) => r.code).join(', ')}`,
    };
  }

  const splits: SplitMeasurement[] = [];
  for (const [name, cases] of Object.entries(options.splits)) {
    splits.push(await measureSplitFor(options, binding.plan, name, cases));
  }

  // Gates are applied to the held-out split only. The dev split exists to be
  // tuned against; scoring a gate on it is how a threshold gets fitted to the
  // data it is then judged on.
  const heldOut = splits.find((entry) => entry.split === 'heldout');
  const gateFailures = evaluateGates(heldOut, options.qualityGate, options.latencyGate);

  return {
    status: 'measured',
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    splits,
    gateFailures,
    passed: gateFailures.length === 0,
  };
};

/** Runs one split with the caller's adapter and plan. */
const measureSplitFor = async (
  options: RunLiveMeasurementOptions,
  plan: DecisionPlan,
  name: string,
  cases: readonly MeasurementCase[],
): Promise<SplitMeasurement> => {
  const adapter = options.adapter;
  if (adapter === undefined) {
    // Unreachable: the caller checked. Kept so this helper needs no cast.
    throw new Error('measureSplitFor requires an adapter');
  }
  return measureSplit({
    split: name,
    cases,
    adapter,
    plan,
    schema: options.schema as Record<string, unknown>,
    policy: options.policy,
    timeoutMs: options.timeoutMs ?? 5_000,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.domainValidate === undefined ? {} : { domainValidate: options.domainValidate }),
    ...(options.validateValue === undefined ? {} : { validateValue: options.validateValue }),
  });
};
