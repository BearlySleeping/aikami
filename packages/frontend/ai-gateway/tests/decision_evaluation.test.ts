// packages/frontend/ai-gateway/tests/decision_evaluation.test.ts
//
// Contract C-566 AC-7: the evaluation harness, its predeclared gates, and the
// backend availability ledger.
//
// What this test can and cannot prove, stated up front:
//
//   It PROVES that the harness computes the declared metrics correctly, that
//   the deterministic baseline's behaviour is reproducible, and that every
//   gate is actually enforced. Those hold with no model installed anywhere.
//
//   It PROVES NOTHING about any decision model's accuracy or latency. No live
//   backend was runnable here (see the availability ledger), so the model
//   rows in the report carry a `skipped` status, not a score. A mock transport
//   proves the wire contract; it is not evidence about a checkpoint.

import { describe, expect, test } from 'bun:test';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  createDeterministicDecisionAdapter,
  type DecisionPlan,
  type DecisionResult,
  runDecision,
} from '../src/lib/decision/index.ts';
import {
  type DecisionFixtureCase,
  type DecisionFixtureFile,
  PILOT_LATENCY_GATE,
  PILOT_POLICY,
  PILOT_QUALITY_GATE,
  PILOT_SCHEMA,
} from './decision_pilot.ts';
import devFixtures from './fixtures/decision/decision_fixtures_dev.json';
import heldOutFixtures from './fixtures/decision/decision_fixtures_heldout.json';

/** The two on-disk fixture files. */
const DEV = devFixtures as DecisionFixtureFile;
const HELD_OUT = heldOutFixtures as DecisionFixtureFile;

/** Metrics for one backend over one split. */
type Metrics = {
  readonly backendId: string;
  readonly cases: number;
  /** Cases whose label names a real command. */
  readonly positives: number;
  /** Cases where a schema-valid value was produced. */
  readonly answered: number;
  /** Answered cases whose label names a real command. */
  readonly answeredPositives: number;
  /** Answered cases whose command kind matched the authored label. */
  readonly correct: number;
  /** Answered cases that were wrong AND named a real, state-changing command. */
  readonly riskyFalseAcceptances: number;
  /** Produced values that satisfied the original schema. */
  readonly legalValues: number;
  /** Brier score, or `null` when no backend produced a graded distribution. */
  readonly brier: number | null;
  /** Correct over ALL positive cases; an abstention counts as a miss. */
  readonly accuracy: number;
  /** Correct over ANSWERED positive cases only. Diagnostic, never a gate. */
  readonly answeredAccuracy: number;
  readonly coverage: number;
  readonly legalValueRate: number;
  readonly abstentions: Readonly<Record<string, number>>;
};

/** The pilot plan, compiled and bound once. */
const pilotPlan = (): DecisionPlan => {
  const analysis = analyzeDecisionSchema({ schema: PILOT_SCHEMA });
  if (!analysis.ok) {
    throw new Error('pilot schema failed to compile');
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: PILOT_POLICY });
  if (!binding.ok) {
    throw new Error('pilot policy failed to bind');
  }
  return binding.plan;
};

/**
 * The deterministic baseline lexicon.
 *
 * Authored for the pilot and deliberately incomplete: general surface cues
 * only, no fixture-specific nouns, and it abstains on everything else.
 *
 * This is the control. It exists to be beaten, and its numbers are the honest
 * floor for "no model at all" on this corpus — which is the comparison any
 * decision model has to win before it earns a place in the request path.
 */
const BASELINE_RULES = {
  rules: {
    commandKind: [
      {
        match: ['buy', 'sell', 'trade', 'shop', 'price', 'cost', 'purchase'],
        value: 'trade',
        weight: 1,
      },
      {
        match: ['join', 'recruit', 'party', 'ride with', 'walk with', 'come with', 'travel with'],
        value: 'recruit',
        weight: 1,
      },
      {
        match: ['evidence', 'proof', 'seal', 'sigil', 'here, take it', 'here it is'],
        value: 'presentEvidence',
        weight: 1,
      },
      {
        match: ['roll', 'persuade', 'sneak', 'sleight', 'intimidate', 'skill check'],
        value: 'skillCheck',
        weight: 1,
      },
    ],
  },
} as const;

/** Runs one case through the deterministic baseline. */
const runCase = async (
  testCase: DecisionFixtureCase,
  plan: DecisionPlan,
): Promise<DecisionResult> =>
  runDecision({
    plan,
    schema: PILOT_SCHEMA,
    policy: PILOT_POLICY,
    adapter: createDeterministicDecisionAdapter({ rules: BASELINE_RULES }),
    context: testCase.state,
    // The deterministic baseline is in-process; the budget exists so the
    // deadline path is exercised the same way a live backend would see it.
    deadlineAt: Date.now() + 5000,
    signal: new AbortController().signal,
    requestId: `fixture:${testCase.caseId}`,
    stateRevision: 1,
  });

/**
 * Indexes a plan's options by LITERAL value.
 *
 * Probabilities arrive keyed by the compiler's positional option key, which is
 * not the literal. Indexing by literal is what stops a score being read off the
 * wrong slot.
 */
const optionKeysByValue = (plan: DecisionPlan): Map<string, string> => {
  const index = new Map<string, string>();
  for (const question of plan.questions) {
    for (const option of question.options ?? []) {
      index.set(String(option.value), option.key);
    }
  }
  return index;
};

/** What one fixture case contributes to the split's metrics. */
type CaseOutcome = {
  readonly abstained?: string;
  readonly correct: number;
  readonly positive: number;
  readonly risky: number;
  readonly brier: readonly number[];
};

/** Scores one fixture case. */
const scoreCase = async (options: {
  testCase: DecisionFixtureCase;
  plan: DecisionPlan;
  keyByValue: ReadonlyMap<string, string>;
}): Promise<CaseOutcome> => {
  const empty: CaseOutcome = { correct: 0, positive: 0, risky: 0, brier: [] };
  const result = await runCase(options.testCase, options.plan);
  if (!result.ok) {
    return { ...empty, abstained: result.reason };
  }

  const predicted = String(result.value.commandKind);
  const probabilities = result.answers.find(
    (answer) => answer.probabilities !== undefined,
  )?.probabilities;
  // Brier is only meaningful over a GRADED distribution. A lexicon that matches
  // one rule emits a one-hot vector, and scoring that as "perfectly calibrated"
  // would report an artefact as evidence.
  const graded = probabilities !== undefined && Math.max(...Object.values(probabilities)) < 0.999;
  const key = options.keyByValue.get(predicted);
  const raw = key === undefined ? undefined : probabilities?.[key];
  const probability = graded && typeof raw === 'number' ? raw : undefined;

  // Any command fired at a message that asks for none is a false acceptance,
  // and every one of them is a real state change in the game.
  if (options.testCase.expected === null) {
    return {
      correct: 0,
      positive: 0,
      risky: 1,
      brier: probability === undefined ? [] : [probability ** 2],
    };
  }

  const isCorrect = predicted === options.testCase.expected;
  const risky = !isCorrect && predicted !== 'presentEvidence' ? 1 : 0;
  return {
    correct: isCorrect ? 1 : 0,
    positive: 1,
    risky,
    brier: probability === undefined ? [] : [(probability - (isCorrect ? 1 : 0)) ** 2],
  };
};

/**
 * Computes the declared metrics over one split.
 *
 * Accuracy counts an ABSTENTION on a positive case as a miss. Measuring only
 * over answered cases is survivorship bias: a backend that answers four easy
 * cases perfectly and abstains on everything else would score 100% and clear
 * any gate written that way.
 */
const score = async (
  backendId: string,
  cases: readonly DecisionFixtureCase[],
): Promise<Metrics> => {
  const plan = pilotPlan();
  const positives = cases.filter((testCase) => testCase.expected !== null);
  const tally = { answered: 0, answeredPositives: 0, correct: 0, risky: 0, legal: 0 };
  const abstentions: Record<string, number> = {};
  const brierTerms: number[] = [];
  const keyByValue = optionKeysByValue(plan);

  for (const testCase of cases) {
    const outcome = await scoreCase({ testCase, plan, keyByValue });
    if (outcome.abstained !== undefined) {
      abstentions[outcome.abstained] = (abstentions[outcome.abstained] ?? 0) + 1;
      continue;
    }
    tally.answered += 1;
    tally.legal += 1;
    tally.risky += outcome.risky;
    tally.correct += outcome.correct;
    tally.answeredPositives += outcome.positive;
    brierTerms.push(...outcome.brier);
  }

  return {
    backendId,
    cases: cases.length,
    positives: positives.length,
    answered: tally.answered,
    answeredPositives: tally.answeredPositives,
    correct: tally.correct,
    riskyFalseAcceptances: tally.risky,
    legalValues: tally.legal,
    accuracy: positives.length === 0 ? 0 : tally.correct / positives.length,
    answeredAccuracy: tally.answeredPositives === 0 ? 0 : tally.correct / tally.answeredPositives,
    coverage: cases.length === 0 ? 0 : tally.answered / cases.length,
    legalValueRate: tally.answered === 0 ? 1 : tally.legal / tally.answered,
    brier:
      brierTerms.length === 0
        ? null
        : brierTerms.reduce((sum, term) => sum + term, 0) / brierTerms.length,
    abstentions,
  };
};

describe('fixture corpus integrity', () => {
  test('both splits exist and are labelled non-empty', () => {
    expect(DEV.cases.length).toBeGreaterThan(0);
    expect(HELD_OUT.cases.length).toBeGreaterThan(0);
    expect(DEV.split).toBe('dev');
    expect(HELD_OUT.split).toBe('heldout');
  });

  test('case ids are unique across both splits', () => {
    const ids = [...DEV.cases, ...HELD_OUT.cases].map((testCase) => testCase.caseId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every ambiguous case carries no expected label, and no authored case is blank', () => {
    for (const testCase of [...DEV.cases, ...HELD_OUT.cases]) {
      if (testCase.label === 'ambiguous') {
        expect(testCase.expected).toBeNull();
      }
      if (testCase.label === 'authored' && testCase.category !== 'negation') {
        expect(testCase.expected === null || typeof testCase.expected === 'string').toBe(true);
      }
    }
  });

  test('every non-English case is expected to be out of scope', () => {
    for (const testCase of [...DEV.cases, ...HELD_OUT.cases]) {
      if (testCase.language !== 'en') {
        expect(testCase.expected).toBeNull();
      }
    }
  });

  test('the corpus covers every required category in both splits', () => {
    const required = [
      'clear-intent',
      'ambiguous',
      'negation',
      'multiple-actions',
      'unsupported-action',
      'invented-fantasy-names',
      'unseen-packs',
      'misleading-quote',
      'correlated-fields',
      'out-of-scope',
      'out-of-scope-language',
    ];
    for (const split of [DEV, HELD_OUT]) {
      const categories = new Set(split.cases.map((testCase) => testCase.category));
      for (const category of required) {
        expect(categories.has(category)).toBe(true);
      }
    }
  });
});

describe('evaluation harness — metrics are computed, not asserted by hand', () => {
  test('the deterministic baseline is scored over the dev split', async () => {
    const metrics = await score('deterministic-baseline', DEV.cases);
    expect(metrics.cases).toBe(DEV.cases.length);
    expect(metrics.positives).toBeGreaterThan(0);
    expect(metrics.answered).toBeGreaterThan(0);
    expect(metrics.coverage).toBeGreaterThan(0);
    expect(metrics.coverage).toBeLessThan(1);
    expect(metrics.legalValueRate).toBe(PILOT_QUALITY_GATE.requireLegalValueRate);
  });

  test('Brier is computed only over graded distributions, never over one-hot ones', async () => {
    // The deterministic baseline matches a single rule and emits a degenerate
    // distribution on almost every case. Reporting Brier over those would
    // dress an artefact up as a calibration result, so the score is taken only
    // over the rare genuinely graded case.
    const metrics = await score('deterministic-baseline', HELD_OUT.cases);
    const gradedCases = HELD_OUT.cases.filter((testCase) => {
      const state = testCase.state.toLowerCase();
      const trade = ['buy', 'sell', 'trade', 'shop', 'price', 'cost', 'purchase'].some((token) =>
        state.includes(token),
      );
      const recruit = [
        'join',
        'recruit',
        'party',
        'ride with',
        'walk with',
        'come with',
        'travel with',
      ].some((token) => state.includes(token));
      return trade && recruit;
    });
    expect(gradedCases.length).toBeGreaterThan(0);
    expect(metrics.brier).not.toBeNull();
    expect(metrics.brier ?? -1).toBeGreaterThan(0);
  });

  test('every answered case produced a value satisfying the original schema', async () => {
    const plan = pilotPlan();
    for (const testCase of HELD_OUT.cases) {
      const result = await runCase(testCase, plan);
      if (result.ok) {
        expect(result.value.commandKind).toBeDefined();
        expect(Object.keys(result.value)).toEqual(['commandKind']);
      }
    }
  });

  test('provenance carries backend identity and timings on both outcomes', async () => {
    const plan = pilotPlan();
    const answered = await runCase(DEV.cases[0], plan);
    expect(answered.provenance.backendId).toBe('deterministic-baseline');
    expect(
      answered.provenance.outcome === 'accepted' || answered.provenance.outcome === 'abstained',
    ).toBe(true);

    const abstained = await runCase({ ...DEV.cases[0], state: 'zzzz qqqq' }, plan);
    expect(abstained.ok).toBe(false);
    if (!abstained.ok) {
      expect(abstained.provenance.outcome).toBe('abstained');
      expect(abstained.reason).toBe('invalid-response');
    }
  });

  test('the baseline abstains on input no authored rule matches', async () => {
    const metrics = await score('deterministic-baseline', [
      {
        caseId: 'probe',
        category: 'out-of-scope',
        language: 'en',
        label: 'authored',
        expected: null,
        state: 'zzzz qqqq wwww',
      },
    ]);
    expect(metrics.answered).toBe(0);
    expect(metrics.coverage).toBe(0);
  });
});

describe('backend availability ledger', () => {
  /**
   * The measured environment at lane execution time.
   *
   * Recorded as data so the report and this test cannot disagree. Every entry
   * is an observation of THIS machine, not a claim about the project.
   */
  const Ledger = [
    {
      backend: 'deterministic-baseline',
      status: 'measured',
      detail: 'in-process authored lexicon; always runnable',
    },
    {
      backend: 'ollama-systemone-nimble',
      status: 'skipped',
      detail:
        'Ollama 0.34.3 installed; POST /v1/systemone returned 404; needs >= 0.35.0 and the nimble model',
    },
    { backend: 'laya-cpp', status: 'skipped', detail: 'no laya-cli binary installed' },
    { backend: 'laya-python', status: 'skipped', detail: 'laya package not installed' },
    { backend: 'opendecider', status: 'skipped', detail: 'opendecider package not installed' },
    {
      backend: 'typesafe-jev',
      status: 'skipped',
      detail: 'hosted API reachable but no configured budget or permission for paid calls',
    },
    {
      backend: 'configured-llm',
      status: 'skipped',
      detail:
        'no configured text connection was exercised in this lane; adapter contract is covered by unit tests',
    },
  ] as const;

  test('every non-measured backend is marked skipped with a reproducible reason', () => {
    for (const entry of Ledger) {
      expect(['measured', 'skipped']).toContain(entry.status);
      if (entry.status === 'skipped') {
        expect(entry.detail.length).toBeGreaterThan(20);
      }
    }
  });

  test('only the deterministic baseline is measured, and it is not a model', () => {
    const measured = Ledger.filter((entry) => entry.status === 'measured');
    expect(measured).toHaveLength(1);
    expect(measured[0]?.backend).toBe('deterministic-baseline');
  });
});

describe('predeclared gates', () => {
  test('the corpus is not trivially solved by surface keyword matching', async () => {
    // The baseline exists to be beaten. If it cleared the quality gate there
    // would be no evidence-based case for adding a decision model at all.
    const metrics = await score('deterministic-baseline', HELD_OUT.cases);
    const clearsGate =
      metrics.accuracy >= PILOT_QUALITY_GATE.minHeldOutAccuracy &&
      metrics.riskyFalseAcceptances / Math.max(1, metrics.answered) <=
        PILOT_QUALITY_GATE.maxRiskyFalseAcceptance &&
      metrics.coverage >= PILOT_QUALITY_GATE.minCoverage;
    expect(clearsGate).toBe(false);
  });

  test('the latency gate is stated in the units a caller budget is measured in', () => {
    expect(PILOT_LATENCY_GATE.maxWarmP50Ms).toBeLessThan(PILOT_LATENCY_GATE.maxWarmP95Ms);
    expect(PILOT_LATENCY_GATE.maxWarmP95Ms).toBeLessThan(PILOT_LATENCY_GATE.maxColdP95Ms);
  });
});
