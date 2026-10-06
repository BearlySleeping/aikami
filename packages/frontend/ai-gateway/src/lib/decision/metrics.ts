// packages/frontend/ai-gateway/src/lib/decision/metrics.ts
//
// THE metric implementation for issue #381. There is exactly one, and the
// deterministic harness, the live measurement and the evaluator CLI all call
// it. Two scorers disagreeing about what "safe" means is how a backend
// shipped with zero risky acceptance while the research harness said nine.
//
// ---------------------------------------------------------------------------
// What was wrong, and the correction
// ---------------------------------------------------------------------------
//
// The live scorer treated a case with `expected: null` as coverage-only: a
// backend that answered it was counted as having COVERED the case and then
// returned early without incrementing risky acceptance. Two correct positives
// plus one command fired at an out-of-scope greeting therefore produced
// accuracy 1, coverage 1, risky acceptance 0 and a passing safety gate. That is
// a false pass on the exact failure the gate exists to catch, and the test that
// pinned the behaviour asserted the wrong contract.
//
// Three case kinds replace the single `expected: string | null`:
//
//   `positive`         — a command IS warranted and the label names it.
//                        Getting it wrong is a false *answer*; abstaining is a
//                        miss counted against positive recall.
//   `required-abstain` — no command is warranted. The backend MUST abstain.
//                        Answering here is the unsafe case, counted against the
//                        safety gate and excluded from coverage credit.
//   `excluded`         — genuinely ungradable: two defensible readings and no
//                        single right answer. Excluded from every denominator.
//
// The third kind is what makes the second honest. Conflating "ambiguous" with
// "out of scope" forced one of two wrong behaviours: either treat ambiguity as a
// negative (so a correct, careful `none` is scored as a false acceptance) or
// treat it as free coverage (so a wild guess is rewarded). Neither is
// measurable. `excluded` cases are dropped from the denominators and reported
// separately, and an answer on one is recorded as an unexplained acceptance
// rather than silently improving any metric.
//
// ---------------------------------------------------------------------------
// What this module deliberately does NOT do
// ---------------------------------------------------------------------------
//
// It does not decide whether a task qualifies. It reports numbers and lets
// `evaluateQualityGates` compare them against thresholds that were frozen
// before any backend was scored. Moving a threshold after seeing a result is
// not this module's job, and the evaluator records the thresholds it used in
// its artifact so a moved gate is visible.

import type { DecisionAdapter } from './adapters/types.ts';
import { runDecision } from './runner.ts';
import type {
  DecisionAbstentionReason,
  DecisionLimits,
  DecisionPlan,
  DecisionResult,
  DecisionTaskPolicy,
} from './types.ts';

/**
 * Minimum samples before a percentile is reported at all.
 *
 * Below this the harness reports min/median/max and says the percentile is
 * unavailable. A p95 over a handful of samples is not a latency measurement, it
 * is a rounding of the maximum.
 */
export const MIN_REPETITIONS_FOR_PERCENTILE = 20;

/** What a fixture case is asking the backend to do. */
export type EvaluationCaseKind =
  /** A command is warranted and the label names it. */
  | 'positive'
  /** No command is warranted; the backend must abstain. */
  | 'required-abstain'
  /** Two defensible readings, no single right answer. Excluded from scoring. */
  | 'excluded';

/** One scored case. */
export type EvaluationCase = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  readonly kind: EvaluationCaseKind;
  /**
   * The authored label.
   *
   * Required for `positive` and always `null` for the other two kinds — a
   * `required-abstain` case with a label is a contradiction, and
   * `assertCaseIntegrity` rejects the corpus rather than guessing which half
   * the author meant.
   */
  readonly expected: string | null;
  /** The state text sent to the backend. */
  readonly state: string;
};

/**
 * Legacy case shape, accepted so an older fixture file still loads.
 *
 * `label: 'ambiguous'` maps to `excluded` and `expected: null` maps to
 * `required-abstain`. This is a migration shim for the corpus, not a second
 * scorer: it produces an {@link EvaluationCase} and nothing else.
 */
export type LegacyEvaluationCase = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  readonly label?: 'authored' | 'ambiguous';
  readonly expected: string | null;
  readonly state: string;
};

/**
 * The case kind a legacy fixture implies.
 *
 * `ambiguous` means two defensible readings and no label; a null expectation on
 * an authored case means the backend must not fire a command.
 */
const caseKindFor = (input: LegacyEvaluationCase): EvaluationCaseKind => {
  if (input.label === 'ambiguous') {
    return 'excluded';
  }
  return input.expected === null ? 'required-abstain' : 'positive';
};

/** Normalises either corpus shape into the scored shape. */
export const toEvaluationCase = (input: EvaluationCase | LegacyEvaluationCase): EvaluationCase => {
  if ('kind' in input) {
    return input;
  }
  const kind = caseKindFor(input);
  return {
    caseId: input.caseId,
    category: input.category,
    language: input.language,
    kind,
    expected: kind === 'positive' ? input.expected : null,
    state: input.state,
  };
};

/**
 * Extracts the comparable answer from a reconstructed value.
 *
 * The previous scorer hard-coded `value.commandKind ?? Object.values(value)[0]`.
 * That reads the right key only when the task happens to be named
 * `commandKind`, and reads an arbitrary first key otherwise — so a task whose
 * field order changed silently started being scored against the wrong literal.
 * A task that cannot say which of its outputs is being graded returns
 * `undefined`, and the case is reported as uncomparable instead of scored.
 */
export type DecisionValueComparator = (value: Record<string, unknown>) => string | undefined;

/**
 * Default comparator: a single-field result is unambiguous.
 *
 * A multi-field result has no obvious "the answer", so it is not guessed at.
 */
export const defaultDecisionValueComparator: DecisionValueComparator = (value) => {
  const keys = Object.keys(value);
  const only = keys.length === 1 ? keys[0] : undefined;
  if (only === undefined) {
    return undefined;
  }
  const raw = value[only];
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
    ? String(raw)
    : undefined;
};

/** Why a case produced no comparable answer. */
export const UNCOMPARABLE = 'uncomparable';

/** How a case's latency condition was established, recorded in the report. */
export type LatencyConditionMethod =
  /** First dispatches of a freshly created adapter, before any warm-up. */
  | 'cold-then-warm'
  /** Every measured sample is warm; no cold sample was established. */
  | 'warm-only';

/** One executed case, before aggregation. */
export type CaseOutcome = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  readonly kind: EvaluationCaseKind;
  readonly accepted: boolean;
  readonly schemaValid: boolean;
  readonly abstentionReason?: DecisionAbstentionReason;
  /** The compared literal, when the value could be reduced to one. */
  readonly produced?: string;
  readonly correct: boolean;
  /**
   * Answered something other than the task's safe "no command" literal on a case
   * that required no command. This is the failure the safety gate exists for,
   * and it is never credited as coverage.
   */
  readonly unsafeAcceptance: boolean;
  /**
   * Answered the task's safe literal (`none`) on a case that required no
   * command. Counted separately from abstention so a task whose schema can
   * express "nothing is warranted" is not penalised for using it.
   */
  readonly safeAnswer: boolean;
  /** Answered on an `excluded` case. Reported, never rewarded, never gated. */
  readonly unexplainedAcceptance: boolean;
  readonly latencyMs: number;
  readonly latencyCondition: 'cold' | 'warm';
};

/** Aggregate counters for one slice. */
export type EvaluationTally = {
  attempted: number;
  /** Cases where a legal value was produced, excluded cases included. */
  successful: number;
  /** Graded cases (positives + required abstentions) where a value was produced. */
  gradedAnswered: number;
  /** Produced values that satisfied the original schema. */
  schemaValid: number;
  abstained: number;
  /** `positive` + `required-abstain`. Excluded cases are not graded. */
  graded: number;
  positives: number;
  positivesAnswered: number;
  correct: number;
  requiredAbstention: number;
  /** Required-abstention cases answered with the task's safe literal. */
  safeAnswers: number;
  falseAcceptances: number;
  excluded: number;
  unexplainedAcceptances: number;
  /** Answers that could not be reduced to a comparable literal. */
  uncomparable: number;
  latenciesMs: number[];
  warmLatenciesMs: number[];
  coldLatenciesMs: number[];
  abstentions: Record<string, number>;
};

/** An empty tally. */
export const createEvaluationTally = (): EvaluationTally => ({
  attempted: 0,
  successful: 0,
  gradedAnswered: 0,
  schemaValid: 0,
  abstained: 0,
  graded: 0,
  positives: 0,
  positivesAnswered: 0,
  correct: 0,
  requiredAbstention: 0,
  safeAnswers: 0,
  falseAcceptances: 0,
  excluded: 0,
  unexplainedAcceptances: 0,
  uncomparable: 0,
  latenciesMs: [],
  warmLatenciesMs: [],
  coldLatenciesMs: [],
  abstentions: {},
});

/** Records the latency split for one case. */
const foldLatency = (tally: EvaluationTally, outcome: CaseOutcome): void => {
  tally.latenciesMs.push(outcome.latencyMs);
  if (outcome.latencyCondition === 'warm') {
    tally.warmLatenciesMs.push(outcome.latencyMs);
    return;
  }
  tally.coldLatenciesMs.push(outcome.latencyMs);
};

/** Records an abstention and its reason. */
const foldAbstention = (tally: EvaluationTally, outcome: CaseOutcome): void => {
  tally.abstained += 1;
  const reason = outcome.abstentionReason ?? 'unknown';
  tally.abstentions[reason] = (tally.abstentions[reason] ?? 0) + 1;
};

/**
 * Folds an excluded case.
 *
 * An excluded case is ungradable, so it never enters a denominator. An answer
 * on one is recorded as an unexplained acceptance — reported, never rewarded,
 * never gated — because dropping the fact entirely would hide a backend that
 * guesses where nobody knows the answer.
 */
const foldExcluded = (tally: EvaluationTally, outcome: CaseOutcome): void => {
  tally.excluded += 1;
  if (outcome.accepted) {
    tally.unexplainedAcceptances += 1;
    tally.successful += 1;
    if (outcome.schemaValid) {
      tally.schemaValid += 1;
    }
    return;
  }
  foldAbstention(tally, outcome);
};

/** Folds an accepted graded case: validity, safety and correctness. */
const foldAcceptedGraded = (tally: EvaluationTally, outcome: CaseOutcome): void => {
  tally.successful += 1;
  tally.gradedAnswered += 1;
  if (outcome.schemaValid) {
    tally.schemaValid += 1;
  }
  if (outcome.kind === 'positive') {
    tally.positivesAnswered += 1;
  }
  if (outcome.safeAnswer) {
    tally.safeAnswers += 1;
  }
  if (outcome.correct) {
    tally.correct += 1;
    return;
  }
  if (outcome.kind === 'required-abstain' && !outcome.safeAnswer) {
    tally.falseAcceptances += 1;
  }
  if (outcome.produced === undefined) {
    tally.uncomparable += 1;
  }
};

/** Folds one case outcome into a tally. */
export const foldOutcome = (tally: EvaluationTally, outcome: CaseOutcome): void => {
  tally.attempted += 1;
  foldLatency(tally, outcome);

  if (outcome.kind === 'excluded') {
    foldExcluded(tally, outcome);
    return;
  }

  tally.graded += 1;
  if (outcome.kind === 'required-abstain') {
    tally.requiredAbstention += 1;
  } else {
    tally.positives += 1;
  }

  if (!outcome.accepted) {
    foldAbstention(tally, outcome);
    return;
  }
  foldAcceptedGraded(tally, outcome);
};

/** Reported metrics for one slice. */
export type EvaluationSliceMetrics = {
  readonly key: string;
  readonly dimension: 'overall' | 'language' | 'category';
  readonly attempted: number;
  readonly successful: number;
  /** Graded cases that produced a value — the coverage numerator. */
  readonly gradedAnswered: number;
  readonly schemaValid: number;
  readonly abstained: number;
  readonly graded: number;
  readonly positives: number;
  readonly positivesAnswered: number;
  readonly correct: number;
  /**
   * Correct over ALL positive cases; an abstention is a miss.
   *
   * This is the gate. An all-abstain backend scores 0 and cannot pass, which is
   * the property the previous `answeredAccuracy`-based reading hid.
   */
  readonly positiveRecall: number;
  /**
   * Correct over ANSWERED positives only.
   *
   * Diagnostic, never a gate: it reads 1.000 for a backend that abstains on
   * every hard case, which is survivorship bias rather than quality.
   */
  readonly answeredPositiveAccuracy: number;
  readonly requiredAbstention: number;
  /** Required-abstention cases answered with the task's safe literal. */
  readonly safeAnswers: number;
  /** Absolute count of commands fired where none was warranted. */
  readonly falseAcceptances: number;
  /** False acceptances over `requiredAbstention`; 0 when there were none. */
  readonly falseAcceptanceRate: number;
  /** Answered graded cases over graded cases. Excluded cases never help it. */
  readonly coverage: number;
  readonly legalValueRate: number;
  readonly excluded: number;
  readonly unexplainedAcceptances: number;
  readonly uncomparable: number;
  readonly latenciesMs: readonly number[];
  /** Samples recorded under the established warm condition. */
  readonly warmLatenciesMs: readonly number[];
  /** Samples recorded before the warm condition was established. */
  readonly coldLatenciesMs: readonly number[];
  readonly medianMs?: number;
  readonly p95Ms?: number;
  readonly warmMedianMs?: number;
  readonly warmP95Ms?: number;
  readonly coldP50Ms?: number;
  readonly coldP95Ms?: number;
  readonly percentileUnavailable?: string;
  readonly abstentions: Readonly<Record<string, number>>;
};

/** Percentile by nearest-rank. Callers gate on repetition count first. */
export const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
};

/** Median of an already-populated list. */
export const median = (sorted: readonly number[]): number | undefined => {
  if (sorted.length === 0) {
    return undefined;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/**
 * The percentile-bearing latency fields, withheld rather than approximated.
 *
 * `undefined` is meaningful here: it says the condition was never established
 * with enough samples, which is a different fact from "fast".
 */
const latencyFields = (tally: EvaluationTally): Partial<EvaluationSliceMetrics> => {
  const warm = [...tally.warmLatenciesMs].sort((a, b) => a - b);
  const cold = [...tally.coldLatenciesMs].sort((a, b) => a - b);
  const sorted = [...tally.latenciesMs].sort((a, b) => a - b);
  const warmEstablished = warm.length >= MIN_REPETITIONS_FOR_PERCENTILE;
  const coldEstablished = cold.length >= MIN_REPETITIONS_FOR_PERCENTILE;
  const overallEstablished = sorted.length >= MIN_REPETITIONS_FOR_PERCENTILE;
  const reportedMedian = median(sorted);
  return {
    ...(reportedMedian === undefined ? {} : { medianMs: reportedMedian }),
    warmMedianMs: median(warm),
    ...(warmEstablished ? { warmP95Ms: percentile(warm, 95) } : {}),
    ...(coldEstablished
      ? { coldP50Ms: percentile(cold, 50), coldP95Ms: percentile(cold, 95) }
      : {}),
    ...(overallEstablished
      ? { p95Ms: percentile(sorted, 95) }
      : {
          percentileUnavailable: `${sorted.length} sample(s); a percentile needs ${MIN_REPETITIONS_FOR_PERCENTILE}. Reporting p95 here would be rounding the maximum.`,
        }),
  };
};

/** The rate metrics, each an explicit division so no denominator hides. */
type RateFields = Pick<
  EvaluationSliceMetrics,
  | 'positiveRecall'
  | 'answeredPositiveAccuracy'
  | 'falseAcceptanceRate'
  | 'coverage'
  | 'legalValueRate'
>;

const rateFields = (tally: EvaluationTally): RateFields => ({
  positiveRecall: tally.positives === 0 ? 0 : tally.correct / tally.positives,
  answeredPositiveAccuracy:
    tally.positivesAnswered === 0 ? 0 : tally.correct / tally.positivesAnswered,
  falseAcceptanceRate:
    tally.requiredAbstention === 0 ? 0 : tally.falseAcceptances / tally.requiredAbstention,
  // Denominator and numerator are BOTH graded cases. An answer on an excluded
  // case is not graded coverage, and counting it would let a backend report
  // coverage above 100%.
  coverage: tally.graded === 0 ? 0 : tally.gradedAnswered / tally.graded,
  legalValueRate: tally.successful === 0 ? 0 : tally.schemaValid / tally.successful,
});

/** Folds a tally into reported metrics, withholding an unearned percentile. */
export const summarizeTally = (
  key: string,
  dimension: EvaluationSliceMetrics['dimension'],
  tally: EvaluationTally,
): EvaluationSliceMetrics => ({
  ...rateFields(tally),
  ...latencyFields(tally),
  key,
  dimension,
  attempted: tally.attempted,
  successful: tally.successful,
  gradedAnswered: tally.gradedAnswered,
  schemaValid: tally.schemaValid,
  abstained: tally.abstained,
  graded: tally.graded,
  positives: tally.positives,
  positivesAnswered: tally.positivesAnswered,
  correct: tally.correct,
  requiredAbstention: tally.requiredAbstention,
  safeAnswers: tally.safeAnswers,
  falseAcceptances: tally.falseAcceptances,
  excluded: tally.excluded,
  unexplainedAcceptances: tally.unexplainedAcceptances,
  uncomparable: tally.uncomparable,
  latenciesMs: tally.latenciesMs,
  warmLatenciesMs: tally.warmLatenciesMs,
  coldLatenciesMs: tally.coldLatenciesMs,
  abstentions: tally.abstentions,
});

/** A full evaluation over one split. */
export type EvaluationReport = {
  readonly split: string;
  readonly backendId: string;
  readonly dialect: string;
  readonly task: string;
  readonly overall: EvaluationSliceMetrics;
  readonly byLanguage: readonly EvaluationSliceMetrics[];
  readonly byCategory: readonly EvaluationSliceMetrics[];
  readonly outcomes: readonly CaseOutcome[];
  readonly latencyConditionMethod: LatencyConditionMethod;
};

/** Options for one split. */
export type EvaluateSplitOptions = {
  readonly split: string;
  readonly cases: readonly (EvaluationCase | LegacyEvaluationCase)[];
  readonly adapter: DecisionAdapter;
  readonly plan: DecisionPlan;
  readonly schema: Record<string, unknown>;
  readonly policy: DecisionTaskPolicy;
  readonly timeoutMs: number;
  readonly limits?: Partial<DecisionLimits>;
  readonly domainValidate?: (value: Record<string, unknown>) => boolean;
  readonly validateValue?: (value: unknown) => boolean;
  /** How to reduce a reconstructed value to the literal being graded. */
  readonly compareValue?: DecisionValueComparator;
  /** The task's "no command is warranted" literal, when the schema has one. */
  readonly safeLiteral?: string;
  /** Requests treated as cold, i.e. before the backend is warmed. */
  readonly coldSamples?: number;
  /** Unmeasured dispatches run first to establish the warm condition. */
  readonly warmupRequests?: number;
};

/**
 * Rejects a corpus whose case kinds and labels disagree.
 *
 * A `required-abstain` case carrying a label, or a `positive` case carrying
 * none, is a contradiction in the corpus rather than a subtle measurement. It
 * is reported instead of silently reinterpreted, because whichever way it were
 * resolved would move a safety number.
 */
export const assertCaseIntegrity = (
  cases: readonly (EvaluationCase | LegacyEvaluationCase)[],
): readonly string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const raw of cases) {
    const testCase = toEvaluationCase(raw);
    if (ids.has(testCase.caseId)) {
      problems.push(`duplicate case id ${testCase.caseId}`);
    }
    ids.add(testCase.caseId);
    if (testCase.kind === 'positive' && testCase.expected === null) {
      problems.push(`${testCase.caseId}: kind 'positive' requires a label`);
    }
    if (testCase.kind !== 'positive' && testCase.expected !== null) {
      problems.push(`${testCase.caseId}: kind '${testCase.kind}' must carry expected: null`);
    }
  }
  return problems;
};

/** Turns one completed decision into a scored outcome. */
export const scoreResult = (options: {
  testCase: EvaluationCase;
  result: DecisionResult;
  latencyMs: number;
  latencyCondition: 'cold' | 'warm';
  compareValue: DecisionValueComparator;
  validateValue?: (value: unknown) => boolean;
  /**
   * The literal that means "no command is warranted" for this task.
   *
   * A task whose schema can express it (`none`) has two safe outcomes on a
   * required-abstention case: abstain, or answer the safe literal. When the
   * task does not declare one, answering at all is the unsafe outcome — which
   * is the conservative reading and the one the original corpus needed.
   */
  safeLiteral?: string;
}): CaseOutcome => {
  const { testCase, result } = options;
  const base = {
    caseId: testCase.caseId,
    category: testCase.category,
    language: testCase.language,
    kind: testCase.kind,
    latencyMs: options.latencyMs,
    latencyCondition: options.latencyCondition,
    correct: false,
    unsafeAcceptance: false,
    safeAnswer: false,
    unexplainedAcceptance: false,
  };

  if (!result.ok) {
    return {
      ...base,
      accepted: false,
      schemaValid: false,
      abstentionReason: result.reason,
    };
  }

  const produced = options.compareValue(result.value);
  const schemaValid = options.validateValue?.(result.value) ?? true;
  const correct =
    testCase.kind === 'positive' && produced !== undefined && produced === testCase.expected;

  const safeAnswer =
    testCase.kind === 'required-abstain' &&
    options.safeLiteral !== undefined &&
    produced === options.safeLiteral;

  return {
    ...base,
    accepted: true,
    schemaValid,
    ...(produced === undefined ? {} : { produced }),
    correct,
    // Without a declared safe literal there is no answer that is safe here, so
    // any answer counts as the unsafe acceptance.
    unsafeAcceptance: testCase.kind === 'required-abstain' && !safeAnswer,
    safeAnswer,
    unexplainedAcceptance: testCase.kind === 'excluded',
  };
};

/** Dispatches one case under the split's deadline and cancellation. */
const dispatchCase = async (options: {
  evaluate: EvaluateSplitOptions;
  testCase: EvaluationCase;
  index: number;
  compareValue: DecisionValueComparator;
  latencyCondition: 'cold' | 'warm';
}): Promise<CaseOutcome> => {
  const { evaluate, testCase } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), evaluate.timeoutMs);
  const started = performance.now();
  try {
    const result = await runDecision({
      plan: evaluate.plan,
      schema: evaluate.schema,
      policy: {
        ...evaluate.policy,
        limits: { ...evaluate.policy.limits, ...evaluate.limits },
      },
      adapter: evaluate.adapter,
      context: testCase.state,
      language: testCase.language,
      deadlineAt: Date.now() + evaluate.timeoutMs,
      signal: controller.signal,
      requestId: `evaluate:${evaluate.split}:${testCase.caseId}:${options.index}`,
      stateRevision: options.index,
      ...(evaluate.domainValidate === undefined ? {} : { domainValidate: evaluate.domainValidate }),
    });
    return scoreResult({
      testCase: options.testCase,
      result,
      latencyMs: performance.now() - started,
      latencyCondition: options.latencyCondition,
      compareValue: options.compareValue,
      ...(evaluate.safeLiteral === undefined ? {} : { safeLiteral: evaluate.safeLiteral }),
      ...(evaluate.validateValue === undefined ? {} : { validateValue: evaluate.validateValue }),
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Runs unmeasured dispatches so the warm condition is established, not assumed. */
const establishWarmCondition = async (
  evaluate: EvaluateSplitOptions,
  context: string,
  warmupRequests: number,
): Promise<void> => {
  for (let attempt = 0; attempt < warmupRequests; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), evaluate.timeoutMs);
    try {
      await runDecision({
        plan: evaluate.plan,
        schema: evaluate.schema,
        policy: evaluate.policy,
        adapter: evaluate.adapter,
        context,
        deadlineAt: Date.now() + evaluate.timeoutMs,
        signal: controller.signal,
        requestId: `evaluate:${evaluate.split}:warmup:${attempt}`,
        stateRevision: -1,
      });
    } catch {
      // A warm-up failure is not itself a measurement; the measured cases will
      // surface the same condition with a real label.
    } finally {
      clearTimeout(timer);
    }
  }
};

/**
 * Scores one split against a backend.
 *
 * Cold and warm are ESTABLISHED here, not asserted by the caller: the first
 * `coldSamples` measured dispatches are labelled cold, and a fixed number of
 * unmeasured warm-up dispatches runs before any latency is read as warm. The
 * method used is recorded on the report, so a caller cannot relabel a cold
 * number as a warm one by editing a fixture.
 */
export const evaluateSplit = async (evaluate: EvaluateSplitOptions): Promise<EvaluationReport> => {
  const cases = evaluate.cases.map(toEvaluationCase);
  const compareValue = evaluate.compareValue ?? defaultDecisionValueComparator;
  const coldSamples = evaluate.coldSamples ?? 0;
  const warmupRequests = evaluate.warmupRequests ?? 0;

  const overall = createEvaluationTally();
  const byLanguage = new Map<string, EvaluationTally>();
  const byCategory = new Map<string, EvaluationTally>();
  const outcomes: CaseOutcome[] = [];

  const warmupContext = cases.find((testCase) => testCase.kind === 'positive')?.state ?? '';
  if (warmupRequests > 0 && warmupContext.length > 0) {
    await establishWarmCondition(evaluate, warmupContext, warmupRequests);
  }

  for (const [index, testCase] of cases.entries()) {
    const outcome = await dispatchCase({
      evaluate,
      testCase,
      index,
      compareValue,
      latencyCondition: index < coldSamples ? 'cold' : 'warm',
    });
    outcomes.push(outcome);
    foldOutcome(overall, outcome);
    const languageTally = byLanguage.get(testCase.language) ?? createEvaluationTally();
    foldOutcome(languageTally, outcome);
    byLanguage.set(testCase.language, languageTally);
    const categoryTally = byCategory.get(testCase.category) ?? createEvaluationTally();
    foldOutcome(categoryTally, outcome);
    byCategory.set(testCase.category, categoryTally);
  }

  return {
    split: evaluate.split,
    backendId: evaluate.adapter.backendId,
    dialect: evaluate.adapter.dialect,
    task: evaluate.policy.task,
    overall: summarizeTally('overall', 'overall', overall),
    byLanguage: [...byLanguage.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([language, tally]) => summarizeTally(language, 'language', tally)),
    byCategory: [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, tally]) => summarizeTally(category, 'category', tally)),
    outcomes,
    latencyConditionMethod: coldSamples > 0 ? 'cold-then-warm' : 'warm-only',
  };
};

export type { EvaluationLatencyGate, EvaluationQualityGate } from './gates.ts';

export { evaluateQualityGates } from './gates.ts';
/**
 * Applies the frozen gates to a report.
 *
 * The safety gate is checked against BOTH the rate and the absolute count. A
 * rate over a handful of required-abstention cases can hide a single dangerous
 * command behind an unlucky denominator, and one command fired where none was
 * warranted is a real state change in the game.
 */
/** Re-exported so callers do not need a second import for the runner's result type. */
export type { DecisionResult };
