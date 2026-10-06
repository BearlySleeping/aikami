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
// actions that NPC cannot take — precisely the defect the task exists to remove.
//
// So this driver compiles a PER-CASE plan from that case's own option set.
//
// It does not fork the SCORER. Every number below comes from `metrics.ts` —
// `scoreResult`, `foldOutcome`, `summarizeTally`, `evaluateQualityGates` — the
// one corrected implementation. Only the dispatch loop is local, and the only
// reason is the per-case plan.
//
// ---------------------------------------------------------------------------
// Two corrections this driver exists to enforce (lane C review)
// ---------------------------------------------------------------------------
//
// 1. EVERY GRADABLE FIXTURE CASE IS SCORED EXACTLY ONCE. The first version used a
//    POSITIONAL warm-up: label the first N cases cold, discard the next N, then
//    score. On the held-out fixture that discarded block landed entirely inside
//    the positives, so a 33-case / 15-positive corpus was reported as 30 / 12.
//    Warm-up now runs on a DEDICATED, NON-FIXTURE request ({@link WARMUP_REQUEST})
//    whose result is never folded.
//
// 2. COLD/WARM COMES FROM RUNTIME LIFECYCLE EVIDENCE, NOT POSITION. Labelling by
//    dispatch order is an assumption: a runtime that pre-loads or evicts under
//    memory pressure produces the same latency shape while every positional label
//    is wrong. Each dispatch asks the adapter whether the checkpoint is resident
//    ({@link ResidencyEvidence}); when the runtime cannot answer the case is
//    recorded as `cold` — "not known to be warm" — so unverified latency never
//    enters the warm aggregate.

import type { DecisionAdapter, ResidencyEvidence } from '../adapters/types.ts';
import type { EvaluationLatencyGate, EvaluationQualityGate } from '../gates.ts';
import { buildDecisionDispatch, createDecisionPlanCache, runDecision } from '../index.ts';
import {
  createEvaluationTally,
  type EvaluationSliceMetrics,
  evaluateQualityGates,
  foldOutcome,
  MIN_REPETITIONS_FOR_PERCENTILE,
  scoreResult,
  summarizeTally,
  toEvaluationCase,
} from '../metrics.ts';
import type { DecisionPlan, DecisionTaskPolicy } from '../types.ts';
import {
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_COMPARATOR,
  NPC_ACTION_SELECTION_TASK_ID,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
} from './npc_action_selection.ts';
import type {
  MeasureNpcActionSelectionOptions,
  NpcActionCorpusCase,
  NpcActionMeasurement,
  NpcActionMeasurementCase,
  NpcActionMeasurementConditions,
  NpcActionMeasurementSplit,
} from './npc_action_selection_measurement_types.ts';

/**
 * The dedicated warm-up request.
 *
 * NOT a fixture case and never folded. It exists so "warm" can be reached without
 * spending a graded case to get there.
 */
export const WARMUP_REQUEST = {
  id: 'warmup-dedicated',
  state: [
    '[NPC]',
    'Merchant',
    'Deals in what the village needs and nothing else.',
    '',
    '[EXCHANGE]',
    '"What have you?" / "Take a look."',
  ].join('\n'),
  options: [
    {
      id: NPC_ACTION_NONE_ID,
      description: 'Nothing state-changing is called for here. Keep talking.',
    },
    { id: 'trade', description: 'Open the trade overlay so the player can buy or sell.' },
  ],
} as const;

const DEFAULTS = {
  warmupRequests: 2,
  perCaseTimeoutMs: 120_000,
} as const;

/** Mutable counters for one run. */
type RunCounters = {
  readinessProbes: number;
  warmupDispatches: number;
  residencyObservations: number;
  inferenceDispatches: number;
  verifiedWarm: number;
  verifiedCold: number;
  unverified: number;
  residencyVerified: boolean;
  residencyMethod: string;
  setupMs: number;
  readinessMs: number;
  residencyMs: number;
  inferenceMs: number;
};

/** Accumulators for one split. */
type SplitAccumulator = {
  readonly split: string;
  readonly cases: readonly NpcActionCorpusCase[];
  readonly tally: ReturnType<typeof createEvaluationTally>;
  readonly byCategory: Map<string, ReturnType<typeof createEvaluationTally>>;
  readonly outcomes: NpcActionMeasurementCase[];
};

/** Asks the runtime whether the checkpoint is resident, right now. */
const observeResidency = async (
  adapter: DecisionAdapter,
  counters: RunCounters,
): Promise<ResidencyEvidence> => {
  if (adapter.residency === undefined) {
    return { verified: false, method: 'none', detail: 'adapter exposes no residency route' };
  }
  const observed = await adapter.residency({ signal: new AbortController().signal });
  counters.residencyObservations += 1;
  return observed;
};

/**
 * Turns residency evidence into a latency condition.
 *
 * Unverified becomes `cold` — "not known to be warm" — so an unverifiable
 * latency never enters the warm aggregate.
 */
const classifyCondition = (
  evidence: ResidencyEvidence,
): { readonly latencyCondition: 'cold' | 'warm'; readonly conditionVerified: boolean } => ({
  latencyCondition: evidence.verified && evidence.resident === true ? 'warm' : 'cold',
  conditionVerified: evidence.verified,
});

/** Tallies one condition. Warm-up dispatches are not corpus cases and are skipped. */
const tallyCondition = (
  counters: RunCounters,
  latencyCondition: 'cold' | 'warm',
  conditionVerified: boolean,
  scored: boolean,
): void => {
  if (!scored) {
    return;
  }
  if (!conditionVerified) {
    counters.unverified += 1;
    return;
  }
  if (latencyCondition === 'warm') {
    counters.verifiedWarm += 1;
    return;
  }
  counters.verifiedCold += 1;
};

/**
 * A case whose plan never compiled or never dispatched.
 *
 * This is a HARNESS failure, not a backend decision, and must not be scored as
 * one. Two earlier drafts got this wrong in opposite directions:
 *
 *   - marking it `unsafeAcceptance` on a required-abstain case charged the
 *     BACKEND with a false acceptance it never made;
 *   - folding it at all added a placeholder `0 ms` to the latency arrays,
 *     dragging warm percentiles toward zero for a case that was never measured.
 *
 * It is therefore excluded from the tallies entirely and surfaced as a
 * `denominatorProblems` entry, which is the honest reading: the case produced no
 * measurement, so the denominators no longer describe what was measured.
 */
const unusableCase = (
  raw: NpcActionCorpusCase,
  conditionVerified: boolean,
  reason: string,
): NpcActionMeasurementCase => ({
  caseId: raw.caseId,
  category: raw.category,
  language: raw.language,
  kind: raw.kind,
  accepted: false,
  schemaValid: false,
  correct: false,
  unsafeAcceptance: false,
  safeAnswer: false,
  unexplainedAcceptance: false,
  latencyMs: 0,
  latencyCondition: 'cold',
  expected: raw.expected,
  npcId: raw.npcId,
  optionCount: raw.options.length,
  conditionVerified,
  measured: false,
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

/** A case's compiled and bound plan, ready to dispatch. */
type PlannedCase = {
  readonly schema: unknown;
  readonly policy: DecisionTaskPolicy;
  readonly plan: DecisionPlan;
  readonly planCacheHit: boolean;
};

/** Compiles and binds a case's own plan, or explains why it could not. */
const planFor = (options: {
  readonly raw: NpcActionCorpusCase;
  readonly cache: ReturnType<typeof createDecisionPlanCache>;
  readonly policyOverride: MeasureNpcActionSelectionOptions['policyOverride'];
}): { ok: true; planned: PlannedCase } | { ok: false; reason: string } => {
  const { raw, cache, policyOverride } = options;
  const optionIds = raw.options.map((option) => option.id);
  const descriptions = Object.fromEntries(
    raw.options.map((option) => [option.id, option.description]),
  );
  const schema = npcActionSelectionSchema(optionIds);
  const policy =
    policyOverride?.(optionIds, descriptions) ?? npcActionSelectionPolicy(optionIds, descriptions);

  const analyzed = cache.analyze({
    // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
    schema: schema as unknown as Record<string, unknown>,
  });
  if (analyzed.analysis.ok !== true) {
    return { ok: false, reason: 'schema-rejected' };
  }
  const bound = cache.bind({ plan: analyzed.analysis.plan, policy, supportedLanguages: ['en'] });
  if (bound.ok !== true) {
    return { ok: false, reason: 'policy-rejected' };
  }
  return {
    ok: true,
    planned: {
      schema,
      policy,
      plan: bound.plan,
      planCacheHit: analyzed.cacheHit,
    },
  };
};

/** Dispatches and scores exactly one fixture case. */
const measureOneCase = async (
  raw: NpcActionCorpusCase,
  context: {
    readonly adapter: DecisionAdapter;
    readonly cache: ReturnType<typeof createDecisionPlanCache>;
    readonly policyOverride: MeasureNpcActionSelectionOptions['policyOverride'];
    readonly conditions: { perCaseTimeoutMs: number };
    readonly split: string;
    readonly counters: RunCounters;
    /**
     * False for the dedicated warm-up request.
     *
     * A warm-up dispatch is a real provider call and is counted as one, but it
     * is not a corpus case: it must not contribute to the condition tallies or
     * to the scored-inference count, or the denominators it exists to protect
     * are the ones it would corrupt.
     */
    readonly scored: boolean;
  },
): Promise<NpcActionMeasurementCase> => {
  const { adapter, cache, counters } = context;

  const evidence = await observeResidency(adapter, counters);
  if (evidence.verified) {
    counters.residencyVerified = true;
    counters.residencyMethod = evidence.method;
  }
  const { latencyCondition, conditionVerified } = classifyCondition(evidence);
  tallyCondition(counters, latencyCondition, conditionVerified, context.scored);

  const setupStarted = performance.now();
  const planned = planFor({ raw, cache, policyOverride: context.policyOverride });
  counters.setupMs += performance.now() - setupStarted;

  if (!planned.ok) {
    return unusableCase(raw, conditionVerified, planned.reason);
  }

  const dispatched = buildDecisionDispatch({ plan: planned.planned.plan, context: raw.state });
  if (dispatched.ok !== true) {
    return unusableCase(raw, conditionVerified, dispatched.refusal.reason);
  }

  const started = Date.now();
  if (context.scored) {
    counters.inferenceDispatches += 1;
  }
  const result = await runDecision({
    plan: planned.planned.plan,
    schema: planned.planned.schema as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
    policy: planned.planned.policy,
    adapter,
    context: raw.state,
    language: raw.language,
    deadlineAt: started + context.conditions.perCaseTimeoutMs,
    signal: new AbortController().signal,
    requestId: `measure:${context.split}:${raw.caseId}`,
    stateRevision: 0,
    planCacheHit: planned.planned.planCacheHit,
  });

  const scored = scoreResult({
    testCase: toEvaluationCase({
      caseId: raw.caseId,
      category: raw.category,
      language: raw.language,
      kind: raw.kind,
      expected: raw.expected,
      state: raw.state,
    }),
    result,
    latencyMs: Date.now() - started,
    latencyCondition,
    compareValue: NPC_ACTION_SELECTION_COMPARATOR,
    safeLiteral: NPC_ACTION_NONE_ID,
  });

  const chosenProbability = result.ok ? chosenProbabilityOf(result.answers) : undefined;
  if (result.ok) {
    counters.inferenceMs += result.provenance.timings.inferenceMs;
  }

  return {
    ...scored,
    expected: raw.expected,
    npcId: raw.npcId,
    optionCount: raw.options.length,
    producedOption: scored.produced,
    ...(chosenProbability === undefined ? {} : { chosenProbability }),
    conditionVerified,
    measured: true,
    residencyDetail: evidence.detail,
    reason: result.ok ? undefined : result.reason,
  };
};

/** Everything one dispatch loop needs, assembled once. */
type RunContext = {
  readonly adapter: DecisionAdapter;
  readonly cache: ReturnType<typeof createDecisionPlanCache>;
  readonly policyOverride: MeasureNpcActionSelectionOptions['policyOverride'];
  readonly conditions: { perCaseTimeoutMs: number };
  readonly counters: RunCounters;
};

const runContext = (
  options: MeasureNpcActionSelectionOptions,
  cache: ReturnType<typeof createDecisionPlanCache>,
  conditions: { perCaseTimeoutMs: number },
  counters: RunCounters,
): RunContext => ({
  adapter: options.adapter,
  cache,
  policyOverride: options.policyOverride,
  conditions,
  counters,
});

/**
 * Dedicated warm-up, on a NON-FIXTURE request.
 *
 * Its answers are discarded and it never enters a tally — this is the change that
 * stops a graded case being spent to establish a condition.
 */
const runWarmups = async (context: RunContext & { readonly requests: number }): Promise<void> => {
  for (let index = 0; index < context.requests; index += 1) {
    await measureOneCase(
      {
        caseId: `${WARMUP_REQUEST.id}-${index}`,
        category: 'warmup',
        language: 'en',
        kind: 'excluded',
        expected: null,
        state: WARMUP_REQUEST.state,
        npcId: 'warmup',
        options: WARMUP_REQUEST.options,
        rationale: 'dedicated warm-up request; not a corpus case',
      },
      { ...context, split: 'warmup', scored: false },
    );
    context.counters.warmupDispatches += 1;
  }
};

/**
 * Scores every fixture case of every split, exactly once.
 *
 * A case that produced no measurement is NOT folded — see
 * {@link NpcActionMeasurementCase.measured} — and is collected for the
 * denominator report instead.
 */
const scoreAllSplits = async (
  context: RunContext & { readonly plan: readonly SplitAccumulator[] },
): Promise<readonly string[]> => {
  const problems: string[] = [];
  for (const entry of context.plan) {
    for (const raw of entry.cases) {
      const outcome = await measureOneCase(raw, {
        ...context,
        split: entry.split,
        scored: true,
      });
      if (!outcome.measured) {
        problems.push(
          `split ${entry.split} case ${raw.caseId} produced no measurement (${outcome.reason ?? 'unknown'})`,
        );
        continue;
      }
      foldOutcome(entry.tally, outcome);
      const categoryTally = entry.byCategory.get(raw.category) ?? createEvaluationTally();
      foldOutcome(categoryTally, outcome);
      entry.byCategory.set(raw.category, categoryTally);
      entry.outcomes.push(outcome);
    }
  }
  return problems;
};

/** Gates the HELD-OUT split only. */
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
 * Measures one backend over the corpus: every fixture case dispatched once and
 * folded once. Only the dedicated warm-up dispatches are discarded.
 */
export const measureNpcActionSelection = async (
  options: MeasureNpcActionSelectionOptions,
): Promise<NpcActionMeasurement> => {
  const runStarted = Date.now();
  const warmupRequests = options.warmupRequests ?? DEFAULTS.warmupRequests;
  const conditions = {
    perCaseTimeoutMs: options.perCaseTimeoutMs ?? DEFAULTS.perCaseTimeoutMs,
  };

  const counters: RunCounters = {
    readinessProbes: 0,
    warmupDispatches: 0,
    residencyObservations: 0,
    inferenceDispatches: 0,
    verifiedWarm: 0,
    verifiedCold: 0,
    unverified: 0,
    residencyVerified: false,
    residencyMethod: 'none',
    setupMs: 0,
    readinessMs: 0,
    residencyMs: 0,
    inferenceMs: 0,
  };

  const cache = createDecisionPlanCache();

  // One readiness probe per arm, timed and counted separately so it is never
  // mistaken for inference. (The chat-model comparator's probe is a real
  // generation, so this matters for that arm in particular.)
  const readinessStarted = performance.now();
  counters.readinessProbes += 1;
  const capability = await options.adapter.capability({
    deadlineAt: options.readinessDeadlineAt ?? Date.now() + 15_000,
    signal: new AbortController().signal,
  });
  counters.readinessMs += performance.now() - readinessStarted;

  const conditionsReport = (): NpcActionMeasurementConditions => ({
    warmupRequests,
    minimumPercentileSamples: MIN_REPETITIONS_FOR_PERCENTILE,
    perCaseTimeoutMs: conditions.perCaseTimeoutMs,
    residencyVerified: counters.residencyVerified,
    residencyMethod: counters.residencyMethod,
    verifiedWarmCases: counters.verifiedWarm,
    verifiedColdCases: counters.verifiedCold,
    unverifiedCases: counters.unverified,
  });

  if (!capability.ready) {
    return {
      backendId: options.adapter.backendId,
      dialect: options.adapter.dialect,
      task: NPC_ACTION_SELECTION_TASK_ID,
      status: 'unavailable',
      unavailableReason: capability.notReadyReason ?? 'backend is not ready',
      conditions: conditionsReport(),
      latencyConditionMethod: 'runtime-residency',
      calls: {
        readinessProbes: counters.readinessProbes,
        warmupDispatches: 0,
        residencyObservations: counters.residencyObservations,
        inferenceDispatches: 0,
      },
      timings: {
        setupMsTotal: counters.setupMs,
        readinessProbeMsTotal: counters.readinessMs,
        residencyMsTotal: counters.residencyMs,
        inferenceMsTotal: 0,
        totalMs: Date.now() - runStarted,
      },
      splits: [],
      gateFailures: [],
      warmConditionEstablished: false,
      denominatorProblems: [],
    };
  }

  const plan: SplitAccumulator[] = Object.entries(options.splits).map(([split, cases]) => ({
    split,
    cases,
    tally: createEvaluationTally(),
    byCategory: new Map(),
    outcomes: [],
  }));

  await runWarmups({
    adapter: options.adapter,
    cache,
    policyOverride: options.policyOverride,
    conditions,
    counters,
    requests: warmupRequests,
  });

  const unusableProblems = await scoreAllSplits({
    plan,
    ...runContext(options, cache, conditions, counters),
  });

  const splits: NpcActionMeasurementSplit[] = plan.map((entry) => ({
    split: entry.split,
    overall: summarizeTally('overall', 'overall', entry.tally),
    byCategory: [...entry.byCategory.entries()]
      .map(([key, tally]) => summarizeTally(key, 'category', tally))
      .sort((a, b) => a.key.localeCompare(b.key)),
    cases: entry.outcomes,
    fixtureCaseCount: entry.cases.length,
    fixturePositiveCount: entry.cases.filter((c) => c.kind === 'positive').length,
    fixtureRequiredAbstentionCount: entry.cases.filter((c) => c.kind === 'required-abstain').length,
  }));

  const denominatorProblems = [...unusableProblems, ...denominatorProblemsFor(splits)];
  const heldout = splits.find((entry) => entry.split === 'heldout');
  const gateFailures = [
    ...denominatorProblems,
    ...gateFailuresFor({
      heldout,
      backendId: options.adapter.backendId,
      dialect: options.adapter.dialect,
      qualityGate: options.qualityGate,
      latencyGate: options.latencyGate,
    }),
  ];

  return {
    backendId: options.adapter.backendId,
    dialect: options.adapter.dialect,
    task: NPC_ACTION_SELECTION_TASK_ID,
    status: 'measured',
    conditions: conditionsReport(),
    latencyConditionMethod: 'runtime-residency',
    calls: {
      readinessProbes: counters.readinessProbes,
      warmupDispatches: counters.warmupDispatches,
      residencyObservations: counters.residencyObservations,
      inferenceDispatches: counters.inferenceDispatches,
    },
    timings: {
      setupMsTotal: counters.setupMs,
      readinessProbeMsTotal: counters.readinessMs,
      residencyMsTotal: counters.residencyMs,
      inferenceMsTotal: counters.inferenceMs,
      totalMs: Date.now() - runStarted,
    },
    splits,
    gateFailures,
    warmConditionEstablished: heldout !== undefined && counters.verifiedWarm > 0,
    denominatorProblems,
  };
};

/**
 * Fails the run when a split did not score its whole fixture — the regression the
 * first version had: 33/15 declared, 30/12 scored.
 */
export const denominatorProblemsFor = (splits: readonly NpcActionMeasurementSplit[]): string[] => {
  const problems: string[] = [];
  for (const split of splits) {
    const scored = split.cases.length;
    if (scored !== split.fixtureCaseCount) {
      problems.push(
        `split ${split.split} scored ${scored} case(s) but its fixture declares ${split.fixtureCaseCount}`,
      );
    }
    const seen = new Set(split.cases.map((entry) => entry.caseId));
    if (seen.size !== scored) {
      problems.push(`split ${split.split} contains ${scored - seen.size} duplicate case id(s)`);
    }
    const positives = split.cases.filter((entry) => entry.kind === 'positive').length;
    if (positives !== split.fixturePositiveCount) {
      problems.push(
        `split ${split.split} scored ${positives} positive(s) but its fixture declares ${split.fixturePositiveCount}`,
      );
    }
    const abstentions = split.cases.filter((entry) => entry.kind === 'required-abstain').length;
    if (abstentions !== split.fixtureRequiredAbstentionCount) {
      problems.push(
        `split ${split.split} scored ${abstentions} required-abstention case(s) but its fixture declares ${split.fixtureRequiredAbstentionCount}`,
      );
    }
  }
  return problems;
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
