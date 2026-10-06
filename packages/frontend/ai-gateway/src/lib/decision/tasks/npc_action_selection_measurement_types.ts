// packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection_measurement_types.ts
//
// The contracts a measurement reports (issue #381, lane C).
//
// Split from the driver so each file has one job. The driver is logic; this is
// the shape of what the logic produces, which the evaluation scripts, the
// evidence exporter and the tests all need to name.
//
// Nothing here imports the driver, so the dependency runs one way.

import type { DecisionAdapter } from '../adapters/types.ts';
import type { EvaluationLatencyGate, EvaluationQualityGate } from '../gates.ts';
import type { CaseOutcome, EvaluationSliceMetrics } from '../metrics.ts';
import type { DecisionTaskPolicy } from '../types.ts';

/** One corpus case, carrying the option set its NPC is actually offered. */
export type NpcActionCorpusCase = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  readonly kind: 'positive' | 'required-abstain' | 'excluded';
  readonly expected: string | null;
  readonly state: string;
  readonly npcId: string;
  readonly options: readonly { readonly id: string; readonly description: string }[];
  readonly rationale: string;
};

/** How the measurement established its latency conditions. */
export type NpcActionMeasurementConditions = {
  /** Dedicated warm-up dispatches performed before scoring. Never folded. */
  readonly warmupRequests: number;
  readonly minimumPercentileSamples: number;
  readonly perCaseTimeoutMs: number;
  /** Whether the runtime could report residency at all. */
  readonly residencyVerified: boolean;
  readonly residencyMethod: string;
  /** How many cases were labelled warm from real evidence. */
  readonly verifiedWarmCases: number;
  /** How many were labelled cold because residency was proven absent. */
  readonly verifiedColdCases: number;
  /** How many could not be verified at all. */
  readonly unverifiedCases: number;
};

/** Provider calls this measurement made, separated by purpose. */
export type NpcActionCallCounts = {
  /** Readiness probes (`adapter.capability`). Each may itself generate. */
  readonly readinessProbes: number;
  /** Dedicated warm-up dispatches. Never scored. */
  readonly warmupDispatches: number;
  /** Residency observations — cheap local state queries, not inference. */
  readonly residencyObservations: number;
  /**
   * Inference dispatches for SCORED cases. Excludes warm-up, which is reported
   * separately: a probe is not inference, and a warm-up is not a measurement.
   */
  readonly inferenceDispatches: number;
};

/** Timing split by purpose, so a probe is never counted as inference. */
export type NpcActionTimings = {
  /** Schema compile + policy bind, per case. */
  readonly setupMsTotal: number;
  /** Readiness probe wall time, summed. */
  readonly readinessProbeMsTotal: number;
  /** Residency observation wall time, summed. */
  readonly residencyMsTotal: number;
  /** Model-reported inference time, summed over scored dispatches. */
  readonly inferenceMsTotal: number;
  /** Wall time of the whole measured run. */
  readonly totalMs: number;
};

/** One case's result. */
export type NpcActionMeasurementCase = CaseOutcome & {
  /**
   * The fixture's label for this case.
   *
   * Carried because `CaseOutcome` — the SHARED scorer, deliberately unmodified —
   * does not echo it, and an exported evidence row without its label cannot be
   * checked against a rate. This is the only place lane C adds to the shape.
   */
  readonly expected: string | null;
  readonly npcId: string;
  readonly optionCount: number;
  readonly producedOption?: string;
  /** The backend's own probability for the option it chose, when it reports one. */
  readonly chosenProbability?: number;
  /** Whether residency was observable for this case. */
  readonly conditionVerified: boolean;
  /**
   * Whether this case produced a MEASUREMENT.
   *
   * False only for a case whose plan never compiled or never dispatched — a
   * harness failure. Such a case is excluded from the tallies rather than
   * folded with a placeholder zero, which would corrupt both the safety counts
   * and the latency percentiles.
   */
  readonly measured: boolean;
  readonly residencyDetail?: string;
  readonly reason?: string;
};

/** A whole split, measured. */
export type NpcActionMeasurementSplit = {
  readonly split: string;
  readonly overall: EvaluationSliceMetrics;
  readonly byCategory: readonly EvaluationSliceMetrics[];
  readonly cases: readonly NpcActionMeasurementCase[];
  /** Fixture cases in the split, for a denominator check against `cases`. */
  readonly fixtureCaseCount: number;
  readonly fixturePositiveCount: number;
  readonly fixtureRequiredAbstentionCount: number;
};

/** What one backend produced across both splits. */
export type NpcActionMeasurement = {
  readonly backendId: string;
  readonly dialect: string;
  readonly task: string;
  readonly status: 'measured' | 'unavailable';
  readonly unavailableReason?: string;
  readonly conditions: NpcActionMeasurementConditions;
  readonly latencyConditionMethod: 'runtime-residency';
  readonly calls: NpcActionCallCounts;
  readonly timings: NpcActionTimings;
  readonly splits: readonly NpcActionMeasurementSplit[];
  readonly gateFailures: readonly string[];
  readonly warmConditionEstablished: boolean;
  /**
   * Denominator self-check.
   *
   * Non-empty when a split scored fewer (or different) cases than its fixture
   * declares. A silent denominator change is exactly the failure this whole
   * revision exists to remove, so it is surfaced rather than computed silently.
   */
  readonly denominatorProblems: readonly string[];
};

/** Inputs to one measurement. */
export type MeasureNpcActionSelectionOptions = {
  readonly adapter: DecisionAdapter;
  readonly splits: Readonly<Record<string, readonly NpcActionCorpusCase[]>>;
  readonly qualityGate: EvaluationQualityGate;
  readonly latencyGate?: EvaluationLatencyGate;
  readonly warmupRequests?: number;
  readonly perCaseTimeoutMs?: number;
  readonly readinessDeadlineAt?: number;
  readonly policyOverride?: (
    optionIds: readonly string[],
    descriptions: Readonly<Record<string, string>>,
  ) => DecisionTaskPolicy;
};
