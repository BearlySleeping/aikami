// packages/frontend/ai-gateway/src/lib/decision/gates.ts
//
// The frozen quality and latency gates (issue #381).
//
// Split out of `metrics.ts` so the numbers and the thresholds stay legible
// apart. These thresholds were declared before any backend was scored, and the
// evaluator records the gate it used in its artifact, so a threshold moved after
// the fact is visible in the report rather than buried in a diff.
//
// The safety gate is checked against BOTH a rate and an absolute count. A rate
// over a handful of required-abstention cases can hide a single dangerous
// command behind an unlucky denominator, and one command fired where none was
// warranted is a real state change in the game.

import {
  type EvaluationReport,
  type EvaluationSliceMetrics,
  MIN_REPETITIONS_FOR_PERCENTILE,
} from './metrics.ts';

/** Latency thresholds, reported against declared conditions. */
export type EvaluationLatencyGate = {
  readonly maxWarmP50Ms: number;
  readonly maxWarmP95Ms: number;
  readonly maxColdP95Ms: number;
};

/** Frozen quality thresholds. Declared before any backend is scored. */
export type EvaluationQualityGate = {
  /** Correct over all held-out positives; abstention is a miss. */
  readonly minPositiveRecall: number;
  /** Share of required-abstention cases that must NOT receive a command. */
  readonly maxFalseAcceptanceRate: number;
  /** Absolute ceiling on commands fired where none was warranted. */
  readonly maxFalseAcceptances: number;
  /** Share of graded cases that must reach a decision at all. */
  readonly minCoverage: number;
  /** Every produced value must satisfy the original schema. */
  readonly minLegalValueRate: number;
  /** Languages the held-out slice requires a positive recall for, when any. */
  readonly minLanguageRecall?: Readonly<Record<string, number>>;
};

/** One threshold comparison, rendered as a gate-failure line when it fails. */
type GateComparison = {
  readonly label: string;
  readonly actual: number;
  readonly threshold: number;
  /** `min` fails below the threshold; `max` fails above it. */
  readonly direction: 'min' | 'max';
  /** Renders a failing comparison. */
  readonly render: (actual: number, threshold: number) => string;
};

const THREE_DECIMALS = (value: number): string => value.toFixed(3);

/** The quality comparisons, in the order they are reported. */
const qualityComparisons = (
  metrics: EvaluationSliceMetrics,
  gate: EvaluationQualityGate,
): GateComparison[] => [
  {
    label: 'positive recall',
    actual: metrics.positiveRecall,
    threshold: gate.minPositiveRecall,
    direction: 'min',
    render: (actual, threshold) =>
      `positive recall ${THREE_DECIMALS(actual)} < required ${threshold}`,
  },
  {
    label: 'false acceptance rate',
    actual: metrics.falseAcceptanceRate,
    threshold: gate.maxFalseAcceptanceRate,
    direction: 'max',
    render: (actual, threshold) =>
      `false acceptance rate ${THREE_DECIMALS(actual)} > allowed ${threshold}`,
  },
  {
    label: 'false acceptances',
    actual: metrics.falseAcceptances,
    threshold: gate.maxFalseAcceptances,
    direction: 'max',
    render: (actual, threshold) =>
      `${actual} command(s) fired where none was warranted > allowed ${threshold}`,
  },
  {
    label: 'coverage',
    actual: metrics.coverage,
    threshold: gate.minCoverage,
    direction: 'min',
    render: (actual, threshold) => `coverage ${THREE_DECIMALS(actual)} < required ${threshold}`,
  },
  {
    label: 'legal value rate',
    actual: metrics.legalValueRate,
    threshold: gate.minLegalValueRate,
    direction: 'min',
    render: (actual, threshold) =>
      `legal value rate ${THREE_DECIMALS(actual)} < required ${threshold}`,
  },
];

/** The per-language recall floors, each with its own failure line. */
const languageFailures = (report: EvaluationReport, gate: EvaluationQualityGate): string[] =>
  Object.entries(gate.minLanguageRecall ?? {}).flatMap(([language, minimum]) => {
    const slice = report.byLanguage.find((entry) => entry.key === language);
    if (slice === undefined) {
      return [`language slice ${language} is required but was not measured`];
    }
    if (slice.positives === 0) {
      return [`language slice ${language} has no positive cases; its recall is unmeasurable`];
    }
    return slice.positiveRecall < minimum
      ? [
          `language ${language} positive recall ${THREE_DECIMALS(slice.positiveRecall)} < required ${minimum}`,
        ]
      : [];
  });

/** Turns one comparison into a failure line, or nothing when it holds. */
const failureFor = (comparison: GateComparison): string | undefined => {
  const failed =
    comparison.direction === 'min'
      ? comparison.actual < comparison.threshold
      : comparison.actual > comparison.threshold;
  return failed ? comparison.render(comparison.actual, comparison.threshold) : undefined;
};

/** The latency comparisons. A missing value is a failure, not a pass. */
const latencyComparisons = (
  metrics: EvaluationSliceMetrics,
  gate: EvaluationLatencyGate,
): GateComparison[] => [
  {
    label: 'warm p50',
    actual: metrics.warmMedianMs ?? 0,
    threshold: gate.maxWarmP50Ms,
    direction: 'max',
    render: (a, t) => `warm p50 ${a} ms > allowed ${t} ms`,
  },
  {
    label: 'warm p95',
    actual: metrics.warmP95Ms ?? 0,
    threshold: gate.maxWarmP95Ms,
    direction: 'max',
    render: (a, t) => `warm p95 ${a} ms > allowed ${t} ms`,
  },
  {
    label: 'cold p95',
    actual: metrics.coldP95Ms ?? 0,
    threshold: gate.maxColdP95Ms,
    direction: 'max',
    render: (a, t) => `cold p95 ${a} ms > allowed ${t} ms`,
  },
];

/**
 * Why a latency threshold could not be judged, or undefined when it could.
 *
 * A percentile is only reportable once the condition was established with
 * enough labelled samples, so "absent" and "fast" must never collapse into the
 * same answer.
 */
const unestablishedLatency = (
  metrics: EvaluationSliceMetrics,
  label: string,
): string | undefined => {
  const absent = (condition: string): string =>
    `${label} latency gate could not be evaluated: ${condition} condition was not established with ${MIN_REPETITIONS_FOR_PERCENTILE} labelled samples`;
  if (label === 'cold p95') {
    return metrics.coldP95Ms === undefined ? absent('cold') : undefined;
  }
  const warmEstablished = metrics.warmP95Ms !== undefined || metrics.warmMedianMs !== undefined;
  return warmEstablished ? undefined : absent('warm');
};

/** Applies the frozen gates to a report. */
export const evaluateQualityGates = (
  report: EvaluationReport,
  gate: EvaluationQualityGate,
  latencyGate?: EvaluationLatencyGate,
): string[] => {
  const metrics = report.overall;
  const structural: string[] = [];
  if (metrics.positives === 0) {
    structural.push('no positive cases were measured; positive recall cannot be computed');
  }
  if (metrics.answeredPositiveAccuracy > metrics.positiveRecall && metrics.positivesAnswered > 0) {
    // Survivorship-bias guard: the diagnostic must never exceed the gate metric.
    structural.push(
      `answered-positive accuracy ${THREE_DECIMALS(metrics.answeredPositiveAccuracy)} exceeds positive recall ${THREE_DECIMALS(metrics.positiveRecall)}; the corpus or the scorer is inconsistent`,
    );
  }
  const quality = qualityComparisons(metrics, gate).flatMap((comparison) => {
    const failure = failureFor(comparison);
    return failure === undefined ? [] : [failure];
  });
  if (latencyGate === undefined) {
    return [...structural, ...quality, ...languageFailures(report, gate)];
  }
  const latency = latencyComparisons(metrics, latencyGate).flatMap((comparison) => {
    const unestablished = unestablishedLatency(metrics, comparison.label);
    if (unestablished !== undefined) {
      return [unestablished];
    }
    const failure = failureFor(comparison);
    return failure === undefined ? [] : [failure];
  });
  return [...structural, ...quality, ...languageFailures(report, gate), ...latency];
};
