// packages/frontend/ai-gateway/src/lib/decision/evaluator.ts
//
// The evaluator: runs a real backend against the frozen corpus and produces one
// inspectable artifact (issue #381).
//
// It exists because #381 has been open for three contracts without a number.
// The rule it enforces is the one the previous harnesses broke: an unavailable
// backend is `unavailable`, a measured failure is `failed`, and only a measured
// pass is `passed`. There is no code path that turns silence into success.
//
// Conditions are ESTABLISHED, not asserted:
//   - cold samples are the first dispatches of a freshly started process, model
//     load included, and the count is recorded;
//   - a fixed number of unmeasured warm-up dispatches runs before any latency is
//     read as warm;
//   - a percentile is withheld below MIN_REPETITIONS_FOR_PERCENTILE rather than
//     reported off three samples;
//   - the gate the run was judged against is written into the artifact, so a
//     threshold moved after the fact is visible in the report rather than buried
//     in a diff.
//
// Credentials never appear here. The caller passes a resolver, not a secret, and
// nothing in this module reads an environment variable, writes a header value to
// disk or echoes a request body.

import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { DecisionAdapter } from './adapters/types.ts';
import { analyzeDecisionSchema } from './analyzer.ts';
import {
  type EvaluationCase,
  type EvaluationLatencyGate,
  type EvaluationQualityGate,
  type EvaluationReport,
  evaluateQualityGates,
  evaluateSplit,
  MIN_REPETITIONS_FOR_PERCENTILE,
} from './metrics.ts';
import { bindDecisionPolicy } from './policy.ts';
import { probeDecisionBackend } from './readiness.ts';
import { loadDecisionCorpus, NPC_COMMAND_KIND_HELDOUT } from './tasks/fixtures.ts';
import {
  NPC_COMMAND_KIND_COMPARATOR,
  NPC_COMMAND_KIND_LATENCY_GATE,
  NPC_COMMAND_KIND_NONE,
  NPC_COMMAND_KIND_POLICY,
  NPC_COMMAND_KIND_QUALITY_GATE,
  NPC_COMMAND_KIND_SCHEMA,
  NPC_COMMAND_KIND_TASK_ID,
} from './tasks/npc_command_kind.ts';
import type {
  DecisionLanguage,
  DecisionLimits,
  DecisionPlan,
  DecisionTaskPolicy,
} from './types.ts';

/** Artifact schema version. Bumped when a field changes meaning. */
export const EVALUATION_ARTIFACT_VERSION = 'decision-evaluation/2';

/** The three outcomes, which are never conflated. */
export type EvaluationStatus = 'passed' | 'failed' | 'unavailable';

/** The task under evaluation. Defaults to the shipped research probe. */
export type EvaluatorTask = {
  readonly id: string;
  readonly schema: unknown;
  readonly policy: DecisionTaskPolicy;
  readonly compareValue: (value: Record<string, unknown>) => string | undefined;
  /**
   * The literal meaning "no command is warranted", when the schema has one.
   *
   * A task that can express it has two safe outcomes on a required-abstention
   * case — abstain, or answer the safe literal — and a task that cannot has
   * only one. Declaring it keeps the safety gate from failing a backend for
   * doing the right thing.
   */
  readonly safeLiteral?: string;
  readonly qualityGate: EvaluationQualityGate;
  readonly latencyGate?: EvaluationLatencyGate;
  /** Existing domain validation, applied after the schema check. */
  readonly domainValidate?: (value: Record<string, unknown>) => boolean;
};

/** The shipped research probe, as an evaluator task. */
export const NPC_COMMAND_KIND_TASK: EvaluatorTask = {
  id: NPC_COMMAND_KIND_TASK_ID,
  schema: NPC_COMMAND_KIND_SCHEMA,
  policy: NPC_COMMAND_KIND_POLICY,
  compareValue: NPC_COMMAND_KIND_COMPARATOR,
  safeLiteral: NPC_COMMAND_KIND_NONE,
  qualityGate: NPC_COMMAND_KIND_QUALITY_GATE,
  latencyGate: NPC_COMMAND_KIND_LATENCY_GATE,
};

/** Every task this evaluator can run. */
export const EVALUATOR_TASKS: Readonly<Record<string, EvaluatorTask>> = {
  [NPC_COMMAND_KIND_TASK_ID]: NPC_COMMAND_KIND_TASK,
};

/** Gates the run is judged by, applied to the held-out split only. */
const gateFailuresFor = (reports: readonly EvaluationReport[], task: EvaluatorTask): string[] => {
  const heldOut = reports.find((report) => report.split === 'heldout');
  return heldOut === undefined
    ? ['no held-out split was measured']
    : evaluateQualityGates(heldOut, task.qualityGate, task.latencyGate);
};

/** Scores one corpus split under the run's established conditions. */
const scoreSplit = async (options: {
  readonly options: EvaluateBackendOptions;
  readonly task: EvaluatorTask;
  readonly adapter: DecisionAdapter;
  readonly plan: DecisionPlan;
  readonly schema: Record<string, unknown>;
  readonly conditions: EvaluationConditions;
  readonly name: string;
  readonly cases: readonly EvaluationCase[];
}): Promise<EvaluationReport> =>
  evaluateSplit({
    split: options.name,
    cases: options.cases,
    adapter: options.adapter,
    plan: options.plan,
    schema: options.schema,
    policy: options.task.policy,
    timeoutMs: options.conditions.timeoutMs,
    compareValue: options.task.compareValue,
    // The corpus is loaded in order; nothing here reorders it.
    coldSamples: options.name === 'heldout' ? options.conditions.coldSamples : 0,
    warmupRequests: options.name === 'heldout' ? options.conditions.warmupRequests : 0,
    ...(options.options.limits === undefined ? {} : { limits: options.options.limits }),
    ...(options.task.safeLiteral === undefined ? {} : { safeLiteral: options.task.safeLiteral }),
    ...(options.task.domainValidate === undefined
      ? {}
      : { domainValidate: options.task.domainValidate }),
    // `task.schema` is `unknown` so a caller can hand a TypeBox schema without
    // casting at every call site; the compiler already proved it is a
    // compilable schema, so it is narrowed once, here.
    validateValue: (value) => Value.Check(options.task.schema as TSchema, value),
  });

/** Conditions the run established, recorded so they cannot be relabelled later. */
export type EvaluationConditions = {
  /** Per-case deadline in ms. */
  readonly timeoutMs: number;
  /** First dispatches of the process, counted as cold. */
  readonly coldSamples: number;
  /** Unmeasured dispatches establishing the warm condition. */
  readonly warmupRequests: number;
  /** Minimum samples before any percentile is reported. */
  readonly minimumPercentileSamples: number;
  /** Languages the checkpoint declares. Anything else must abstain. */
  readonly declaredLanguages: readonly DecisionLanguage[];
};

/** One split's result inside the artifact. */
export type EvaluationSplitArtifact = {
  readonly split: string;
  readonly overall: EvaluationReport['overall'];
  readonly byLanguage: readonly EvaluationReport['byLanguage'][number][];
  readonly byCategory: readonly EvaluationReport['byCategory'][number][];
  readonly latencyConditionMethod: EvaluationReport['latencyConditionMethod'];
};

/** Everything a reader needs to judge or reproduce a run. */
export type EvaluationArtifact = {
  readonly artifactVersion: string;
  readonly status: EvaluationStatus;
  /** Present only when `status` is `unavailable`. Says exactly why. */
  readonly unavailableReason?: string;
  readonly task: string;
  readonly backendId: string;
  readonly dialect: string;
  readonly runtime?: string;
  readonly checkpoint?: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly conditions: EvaluationConditions;
  /** The frozen gates this run was judged against. */
  readonly gates: {
    readonly quality: EvaluationQualityGate;
    readonly latency?: EvaluationLatencyGate;
  };
  readonly splits: readonly EvaluationSplitArtifact[];
  readonly gateFailures: readonly string[];
  /** Per-case outcomes, so a number can be traced back to the text that produced it. */
  readonly cases: EvaluationReport['outcomes'];
  /** The corpus's own stated limitations, copied from the fixture files. */
  readonly corpusLimitations: readonly string[];
};

/** Evaluator options. */
export type EvaluateBackendOptions = {
  readonly adapter: DecisionAdapter;
  /** Defaults to the shipped research probe. */
  readonly task?: EvaluatorTask;
  readonly declaredLanguages?: readonly DecisionLanguage[];
  readonly timeoutMs?: number;
  /** Defaults to MIN_REPETITIONS_FOR_PERCENTILE. */
  readonly coldSamples?: number;
  /** Defaults to 1. */
  readonly warmupRequests?: number;
  readonly limits?: Partial<DecisionLimits>;
  /** Probe budget before the corpus runs. Readiness is proven, not assumed. */
  readonly readinessTimeoutMs?: number;
};

/** Default conditions. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Readiness probe shared by every evaluator run. */
const probeOnce = (
  options: EvaluateBackendOptions,
): Promise<Awaited<ReturnType<typeof probeDecisionBackend>>> =>
  probeDecisionBackend({
    adapter: options.adapter,
    deadlineAt: Date.now() + (options.readinessTimeoutMs ?? 15_000),
    signal: new AbortController().signal,
    requestId: `evaluate-readiness:${options.task?.id ?? NPC_COMMAND_KIND_TASK_ID}`,
    stateRevision: 0,
  });

/**
 * Proves readiness with a real sample, then binds the task.
 *
 * Returns the bound plan, or the reason it could not be bound. A backend that
 * cannot answer, a corpus that contradicts itself and a task that does not
 * compile are all the same shape here: nothing was measured, and the artifact
 * says exactly which.
 */
const prepareRun = async (
  options: EvaluateBackendOptions,
  task: EvaluatorTask,
  declaredLanguages: readonly DecisionLanguage[],
): Promise<
  | {
      ok: true;
      schema: Record<string, unknown>;
      plan: DecisionPlan;
      binding: { policy: DecisionTaskPolicy };
    }
  | { ok: false; reason: string }
> => {
  const verdict = await probeOnce(options);
  if (verdict.state !== 'ready') {
    return {
      ok: false,
      reason: `backend is not ready: ${verdict.reason} (state: ${verdict.state})`,
    };
  }
  const corpus = loadDecisionCorpus();
  if (corpus.problems.length > 0) {
    return { ok: false, reason: `corpus integrity failed: ${corpus.problems.join('; ')}` };
  }
  const schema = task.schema as Record<string, unknown>;
  const analysis = analyzeDecisionSchema({
    schema,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  if (!analysis.ok) {
    return {
      ok: false,
      reason: `task schema does not compile: ${analysis.reasons.map((entry) => entry.code).join(', ')}`,
    };
  }
  const binding = bindDecisionPolicy({
    plan: analysis.plan,
    policy: task.policy,
    supportedLanguages: declaredLanguages,
  });
  if (!binding.ok) {
    return {
      ok: false,
      reason: `task policy does not bind: ${binding.reasons.map((entry) => entry.code).join(', ')}`,
    };
  }
  return { ok: true, schema, plan: binding.plan, binding: { policy: task.policy } };
};

/**
 * Runs the full evaluation.
 *
 * Never throws for an unreachable backend: it returns an artifact with
 * `status: 'unavailable'` and the reason, which is what the CLI turns into a
 * distinct exit code.
 */
export const evaluateBackend = async (
  options: EvaluateBackendOptions,
): Promise<EvaluationArtifact> => {
  const startedAt = new Date();
  const started = performance.now();
  const task = options.task ?? NPC_COMMAND_KIND_TASK;
  const adapter = options.adapter;

  const base = {
    artifactVersion: EVALUATION_ARTIFACT_VERSION,
    task: task.id,
    backendId: adapter.backendId,
    dialect: adapter.dialect,
    startedAt: startedAt.toISOString(),
  } as const;

  const unavailable = (reason: string): EvaluationArtifact => ({
    ...base,
    status: 'unavailable',
    unavailableReason: reason,
    durationMs: performance.now() - started,
    conditions: {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      coldSamples: options.coldSamples ?? MIN_REPETITIONS_FOR_PERCENTILE,
      warmupRequests: options.warmupRequests ?? 1,
      minimumPercentileSamples: MIN_REPETITIONS_FOR_PERCENTILE,
      declaredLanguages: options.declaredLanguages ?? ['en'],
    },
    gates: {
      quality: task.qualityGate,
      ...(task.latencyGate === undefined ? {} : { latency: task.latencyGate }),
    },
    splits: [],
    gateFailures: [],
    cases: [],
    corpusLimitations: NPC_COMMAND_KIND_HELDOUT.labelProvenance.limitations,
  });

  const declaredLanguages = options.declaredLanguages ?? (['en'] as const);
  const prepared = await prepareRun(options, task, declaredLanguages);
  if (!prepared.ok) {
    return unavailable(prepared.reason);
  }

  const { schema, plan } = prepared;
  const conditions: EvaluationConditions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    coldSamples: options.coldSamples ?? MIN_REPETITIONS_FOR_PERCENTILE,
    warmupRequests: options.warmupRequests ?? 1,
    minimumPercentileSamples: MIN_REPETITIONS_FOR_PERCENTILE,
    declaredLanguages,
  };

  const corpus = loadDecisionCorpus();
  const reports: EvaluationReport[] = [];
  for (const [name, cases] of Object.entries(corpus.splits)) {
    reports.push(
      await scoreSplit({ options, task, adapter, plan, schema, conditions, name, cases }),
    );
  }

  // Gates apply to the held-out split only. The dev split exists to be tuned
  // against; scoring a gate on it is how a threshold gets fitted to the data it
  // is then judged on.
  const gateFailures = gateFailuresFor(reports, task);

  return {
    ...base,
    status: gateFailures.length === 0 ? 'passed' : 'failed',
    durationMs: performance.now() - started,
    conditions,
    gates: {
      quality: task.qualityGate,
      ...(task.latencyGate === undefined ? {} : { latency: task.latencyGate }),
    },
    splits: reports.map((report) => ({
      split: report.split,
      overall: report.overall,
      byLanguage: report.byLanguage,
      byCategory: report.byCategory,
      latencyConditionMethod: report.latencyConditionMethod,
    })),
    gateFailures,
    cases: reports.flatMap((report) => report.outcomes),
    corpusLimitations: NPC_COMMAND_KIND_HELDOUT.labelProvenance.limitations,
  };
};
