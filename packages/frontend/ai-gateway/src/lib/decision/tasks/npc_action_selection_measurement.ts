// packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection_measurement.ts
//
// Measuring `npc-action-selection` (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this does not just call `evaluateBackend`
// ---------------------------------------------------------------------------
//
// `evaluateBackend` compiles ONE plan from ONE static task schema and runs
// every corpus case against it. That is the right shape for the probe, whose
// literal space really is static.
//
// It is the wrong shape here. In production, two NPCs in the same conversation
// see DIFFERENT legal actions: the merchant's option set contains six
// `giveItem` instances and no `recruit`, the village elder's contains two
// `presentEvidence` instances and no `giveItem` at all. Scoring a turn against
// the union of every option any NPC has would hand the backend a menu of
// actions that NPC cannot take — which is precisely the defect the task exists
// to remove.
//
// So this driver compiles a PER-CASE plan from that case's own option set.
//
// It does not fork the SCORER. Every number below comes from `metrics.ts` —
// `scoreResult`, `foldOutcome`, `summarizeTally`, `evaluateQualityGates` — the
// one corrected implementation. The corrected negative-case semantics, the
// `required-abstain` / `excluded` distinction, `unsafeAcceptance`, the safe
// literal and the per-language floors are all the shipped ones. Only the
// dispatch loop is local, and the only reason is the per-case plan.
//
// A different scorer would be the defect this whole lane exists to close.

import type { DecisionAdapter } from '../adapters/types.ts';
import type { EvaluationLatencyGate, EvaluationQualityGate } from '../gates.ts';
import { buildDecisionDispatch, createDecisionPlanCache, runDecision } from '../index.ts';
import {
  type CaseOutcome,
  createEvaluationTally,
  type EvaluationSliceMetrics,
  evaluateQualityGates,
  foldOutcome,
  MIN_REPETITIONS_FOR_PERCENTILE,
  scoreResult,
  summarizeTally,
  toEvaluationCase,
} from '../metrics.ts';
import type { DecisionTaskPolicy } from '../types.ts';
import {
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_COMPARATOR,
  NPC_ACTION_SELECTION_TASK_ID,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
} from './npc_action_selection.ts';

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

/** How the measurement established its conditions. */
export type NpcActionMeasurementConditions = {
  /** First N dispatches, labelled cold. Model load is included, not excluded. */
  readonly coldSamples: number;
  /** Unmeasured dispatches that load the checkpoint before any timing is kept. */
  readonly warmupRequests: number;
  readonly minimumPercentileSamples: number;
  readonly perCaseTimeoutMs: number;
};

/** One case's result, kept so a number can be traced to the text it came from. */
export type NpcActionMeasurementCase = CaseOutcome & {
  readonly npcId: string;
  readonly optionCount: number;
  readonly producedOption?: string;
  /**
   * The backend's own probability for the option it chose.
   *
   * Recorded because it is the ONLY evidence a selective-acceptance threshold
   * can honestly be calibrated on: it is what the backend said about its own
   * answer, per case, before any threshold exists. Absent for a chat-model arm,
   * which reports no distribution — and that absence is itself the finding.
   */
  readonly chosenProbability?: number;
  readonly reason?: string;
};

/** A whole split, measured. */
export type NpcActionMeasurementSplit = {
  readonly split: string;
  readonly overall: EvaluationSliceMetrics;
  readonly byCategory: readonly EvaluationSliceMetrics[];
  readonly cases: readonly NpcActionMeasurementCase[];
};

/** What one backend produced across both splits. */
export type NpcActionMeasurement = {
  readonly backendId: string;
  readonly dialect: string;
  readonly task: string;
  readonly status: 'measured' | 'unavailable';
  readonly unavailableReason?: string;
  readonly conditions: NpcActionMeasurementConditions;
  readonly latencyConditionMethod: 'cold-then-warm';
  readonly splits: readonly NpcActionMeasurementSplit[];
  readonly gateFailures: readonly string[];
  /** Whether the warm percentile could be established at all. */
  readonly percentileEstablished: boolean;
};

/** Inputs to one measurement. */
export type MeasureNpcActionSelectionOptions = {
  readonly adapter: DecisionAdapter;
  readonly cases: readonly NpcActionCorpusCase[];
  readonly splits: Readonly<Record<string, readonly NpcActionCorpusCase[]>>;
  readonly qualityGate: EvaluationQualityGate;
  readonly latencyGate?: EvaluationLatencyGate;
  readonly coldSamples?: number;
  readonly warmupRequests?: number;
  readonly perCaseTimeoutMs?: number;
  readonly deadlineAt?: number;
  /**
   * Builds the policy for a candidate set, replacing the task's own.
   *
   * Used ONLY by the calibration pass, to observe what a backend WOULD answer
   * before any threshold exists. With it, a threshold is chosen from observed
   * confidence on the development split and then frozen for held-out scoring —
   * rather than being declared blind and then failing every correct answer.
   */
  readonly policyOverride?: (
    optionIds: readonly string[],
    descriptions: Readonly<Record<string, string>>,
  ) => DecisionTaskPolicy;
};

const DEFAULTS = {
  coldSamples: 3,
  warmupRequests: 3,
  perCaseTimeoutMs: 120_000,
} as const;

/** Everything one case's dispatch needs from the enclosing run. */
type MeasureCaseContext = {
  readonly adapter: DecisionAdapter;
  readonly cache: ReturnType<typeof createDecisionPlanCache>;
  readonly policyOverride: MeasureNpcActionSelectionOptions['policyOverride'];
  readonly conditions: NpcActionMeasurementConditions;
  readonly dispatched: number;
  readonly split: string;
};

/** An outcome for a case whose plan never compiled — a corpus bug, not a refusal. */
const unusable = (
  raw: NpcActionCorpusCase,
  latencyCondition: 'cold' | 'warm',
  reason: string,
): NpcActionMeasurementCase => ({
  caseId: raw.caseId,
  category: raw.category,
  language: raw.language,
  kind: raw.kind,
  accepted: false,
  schemaValid: false,
  correct: false,
  unsafeAcceptance: raw.kind === 'required-abstain',
  safeAnswer: false,
  unexplainedAcceptance: false,
  latencyMs: 0,
  latencyCondition,
  npcId: raw.npcId,
  optionCount: raw.options.length,
  reason,
});

/** The backend's own confidence in the option it picked. */
const chosenProbabilityOf = (
  answers: readonly { optionKey?: string; probabilities?: Readonly<Record<string, number>> }[],
): number | undefined => {
  const answer = answers[0];
  const reported = answer?.probabilities?.[answer?.optionKey ?? ''];
  return typeof reported === 'number' ? reported : undefined;
};

/**
 * Dispatches and scores ONE case against its own candidate set.
 *
 * Extracted from the run loop so the loop stays a loop. The compile, bind,
 * dispatch and score steps are a list of rules; a rule list that also has to
 * track cold/warm phases and per-category tallies is where branches go wrong.
 */
const measureOneCase = async (
  raw: NpcActionCorpusCase,
  ctx: MeasureCaseContext,
): Promise<NpcActionMeasurementCase> => {
  const latencyCondition: 'cold' | 'warm' =
    ctx.dispatched < ctx.conditions.coldSamples ? 'cold' : 'warm';

  const testCase = toEvaluationCase({
    caseId: raw.caseId,
    category: raw.category,
    language: raw.language,
    kind: raw.kind,
    expected: raw.expected,
    state: raw.state,
  });

  const optionIds = raw.options.map((option) => option.id);
  const descriptions = Object.fromEntries(
    raw.options.map((option) => [option.id, option.description]),
  );
  const schema = npcActionSelectionSchema(optionIds);
  const policy =
    ctx.policyOverride?.(optionIds, descriptions) ??
    npcActionSelectionPolicy(optionIds, descriptions);

  const analyzed = ctx.cache.analyze({
    schema: schema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
  });
  if (analyzed.analysis.ok !== true) {
    return unusable(raw, latencyCondition, 'schema-rejected');
  }
  const bound = ctx.cache.bind({
    plan: analyzed.analysis.plan,
    policy,
    supportedLanguages: ['en'],
  });
  if (bound.ok !== true) {
    return unusable(raw, latencyCondition, 'policy-rejected');
  }

  const dispatched = buildDecisionDispatch({ plan: bound.plan, context: raw.state });
  if (dispatched.ok !== true) {
    return unusable(raw, latencyCondition, dispatched.refusal.reason);
  }

  const started = Date.now();
  const result = await runDecision({
    plan: bound.plan,
    schema: schema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
    policy,
    adapter: ctx.adapter,
    context: raw.state,
    language: raw.language,
    deadlineAt: started + ctx.conditions.perCaseTimeoutMs,
    signal: new AbortController().signal,
    requestId: `measure:${ctx.split}:${raw.caseId}:${ctx.dispatched}`,
    stateRevision: ctx.dispatched,
    planCacheHit: analyzed.cacheHit,
  });

  const scored = scoreResult({
    testCase,
    result,
    latencyMs: Date.now() - started,
    latencyCondition,
    compareValue: NPC_ACTION_SELECTION_COMPARATOR,
    safeLiteral: NPC_ACTION_NONE_ID,
  });

  const chosenProbability = result.ok ? chosenProbabilityOf(result.answers) : undefined;
  return {
    ...scored,
    npcId: raw.npcId,
    optionCount: optionIds.length,
    producedOption: scored.produced,
    ...(chosenProbability === undefined ? {} : { chosenProbability }),
    reason: result.ok ? undefined : result.reason,
  };
};

/** Mutable accumulator for one split, folded into the result at the end. */
type SplitAccumulator = {
  readonly split: string;
  readonly cases: readonly NpcActionCorpusCase[];
  readonly tally: ReturnType<typeof createEvaluationTally>;
  readonly byCategory: Map<string, ReturnType<typeof createEvaluationTally>>;
  readonly outcomes: NpcActionMeasurementCase[];
};

/**
 * Gates the HELD-OUT split only.
 *
 * Scoring a gate on the split used to choose thresholds is how a threshold gets
 * fitted to the data it is then judged on, so a missing held-out split is a
 * failure rather than a silent pass.
 */
const gateFailuresFor = (options: {
  readonly heldout: NpcActionMeasurementSplit | undefined;
  readonly backendId: string;
  readonly dialect: string;
  readonly qualityGate: EvaluationQualityGate;
  readonly latencyGate?: EvaluationLatencyGate;
}): string[] => {
  if (options.heldout === undefined) {
    return ['no held-out split was measured'];
  }
  return evaluateQualityGates(
    {
      split: 'heldout',
      backendId: options.backendId,
      dialect: options.dialect,
      task: NPC_ACTION_SELECTION_TASK_ID,
      overall: options.heldout.overall,
      byLanguage: [],
      byCategory: options.heldout.byCategory,
      outcomes: options.heldout.cases,
      latencyConditionMethod: 'cold-then-warm',
    },
    options.qualityGate,
    options.latencyGate,
  );
};

/**
 * Measures one backend over the corpus.
 *
 * Cold and warm are ESTABLISHED here by dispatch order, never asserted by the
 * caller: the first `coldSamples` cases are labelled cold, the next
 * `warmupRequests` are dispatched and discarded, and only then are latencies
 * kept. A warm percentile that cannot be established withholds itself rather
 * than reporting a p50 over three samples.
 */
export const measureNpcActionSelection = async (
  options: MeasureNpcActionSelectionOptions,
): Promise<NpcActionMeasurement> => {
  const conditions: NpcActionMeasurementConditions = {
    coldSamples: options.coldSamples ?? DEFAULTS.coldSamples,
    warmupRequests: options.warmupRequests ?? DEFAULTS.warmupRequests,
    minimumPercentileSamples: MIN_REPETITIONS_FOR_PERCENTILE,
    perCaseTimeoutMs: options.perCaseTimeoutMs ?? DEFAULTS.perCaseTimeoutMs,
  };

  // Compiled plans are cached across cases: several NPCs appear more than once,
  // so the same option set is compiled once. The cache is keyed by schema
  // content, so a different option set is a different plan.
  const cache = createDecisionPlanCache();

  const capability = await options.adapter.capability({
    deadlineAt: options.deadlineAt ?? Date.now() + 15_000,
    signal: new AbortController().signal,
  });
  if (!capability.ready) {
    return {
      backendId: options.adapter.backendId,
      dialect: options.adapter.dialect,
      task: NPC_ACTION_SELECTION_TASK_ID,
      status: 'unavailable',
      unavailableReason: capability.notReadyReason ?? 'backend is not ready',
      conditions,
      latencyConditionMethod: 'cold-then-warm',
      splits: [],
      gateFailures: [],
      percentileEstablished: false,
    };
  }

  const plan: SplitAccumulator[] = Object.entries(options.splits).map(([split, cases]) => ({
    split,
    cases,
    tally: createEvaluationTally(),
    byCategory: new Map(),
    outcomes: [],
  }));

  // Each split establishes its OWN conditions. Warming the checkpoint on the
  // development split and then reporting the held-out split as warm would be
  // true but weaker: the held-out numbers would depend on the development
  // split having run first. Per-split cold means the held-out report states
  // its own load cost, and needs enough cases to leave 20 warm samples.
  for (const entry of plan) {
    const warmupTarget = conditions.coldSamples + conditions.warmupRequests;
    let dispatched = 0;
    for (const raw of entry.cases) {
      const outcome = await measureOneCase(raw, {
        adapter: options.adapter,
        cache,
        policyOverride: options.policyOverride,
        conditions,
        dispatched,
        split: entry.split,
      });
      // Warmup dispatches are performed and discarded: they establish the
      // condition, and their numbers are never kept.
      const isWarmup = dispatched >= conditions.coldSamples && dispatched < warmupTarget;
      if (!isWarmup) {
        foldOutcome(entry.tally, outcome);
        const categoryTally = entry.byCategory.get(raw.category) ?? createEvaluationTally();
        foldOutcome(categoryTally, outcome);
        entry.byCategory.set(raw.category, categoryTally);
        entry.outcomes.push(outcome);
      }
      dispatched += 1;
    }
  }

  const splits: NpcActionMeasurementSplit[] = plan.map((entry) => ({
    split: entry.split,
    overall: summarizeTally('overall', 'overall', entry.tally),
    byCategory: [...entry.byCategory.entries()]
      .map(([key, tally]) => summarizeTally(key, 'category', tally))
      .sort((a, b) => a.key.localeCompare(b.key)),
    cases: entry.outcomes,
  }));

  const gateFailures = gateFailuresFor({
    heldout: splits.find((entry) => entry.split === 'heldout'),
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    qualityGate: options.qualityGate,
    latencyGate: options.latencyGate,
  });

  return {
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    task: NPC_ACTION_SELECTION_TASK_ID,
    status: 'measured',
    conditions,
    latencyConditionMethod: 'cold-then-warm',
    splits,
    gateFailures,
    percentileEstablished: splits.some(
      (entry) => entry.split === 'heldout' && entry.overall.warmP95Ms !== undefined,
    ),
  };
};

/** Formats one slice for a report. */
export const formatSlice = (slice: EvaluationSliceMetrics): string =>
  [
    `attempted=${slice.attempted}`,
    `successful=${slice.successful}`,
    `positives=${slice.positives}`,
    `positiveRecall=${slice.positiveRecall.toFixed(3)}`,
    `answeredPositiveAccuracy=${slice.answeredPositiveAccuracy.toFixed(3)}`,
    `requiredAbstention=${slice.requiredAbstention}`,
    `falseAcceptances=${slice.falseAcceptances}`,
    `falseAcceptanceRate=${slice.falseAcceptanceRate.toFixed(3)}`,
    `coverage=${slice.coverage.toFixed(3)}`,
    `legalValueRate=${slice.legalValueRate.toFixed(3)}`,
    `abstained=${slice.abstained}`,
    `medianMs=${slice.medianMs?.toFixed(1) ?? 'n/a'}`,
    `p95Ms=${slice.p95Ms?.toFixed(1) ?? 'n/a'}`,
    `warmP50=${slice.warmMedianMs?.toFixed(1) ?? 'n/a'}`,
    `warmP95=${slice.warmP95Ms?.toFixed(1) ?? 'n/a'}`,
    `coldP50=${slice.coldP50Ms?.toFixed(1) ?? 'n/a'}`,
    `coldP95=${slice.coldP95Ms?.toFixed(1) ?? 'n/a'}`,
    slice.percentileUnavailable !== undefined
      ? `percentileUnavailable=${slice.percentileUnavailable}`
      : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ');
