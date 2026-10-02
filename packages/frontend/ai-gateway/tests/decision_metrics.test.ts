// packages/frontend/ai-gateway/tests/decision_metrics.test.ts
//
// The ONE metric implementation, and the regressions that pin the correction.
//
// The first group is the reason this file exists. The shipped live scorer
// counted a command fired on a case labelled "no command is warranted" as
// COVERAGE and returned early, so two correct positives plus one out-of-scope
// command reported accuracy 1, coverage 1, risky acceptance 0 and a passing
// safety gate. The test that pinned that behaviour asserted the wrong contract
// and had to be replaced, not adjusted.

import { describe, expect, test } from 'bun:test';
import {
  analyzeDecisionSchema,
  assertCaseIntegrity,
  bindDecisionPolicy,
  type DecisionAdapter,
  type DecisionCapability,
  type DecisionRequest,
  type EvaluationCase,
  type EvaluationQualityGate,
  evaluateQualityGates,
  evaluateSplit,
  measureSplit,
  MIN_REPETITIONS_FOR_PERCENTILE,
  runLiveDecisionMeasurement,
  runDecision,
} from '../src/lib/decision/index.ts';
import {
  NPC_COMMAND_KIND_COMPARATOR,
  NPC_COMMAND_KIND_POLICY,
  NPC_COMMAND_KIND_SCHEMA,
} from '../src/lib/decision/tasks/index.ts';

/** Compiled once; the plan is immutable and cached by the compiler contract. */
const plan = (() => {
  const analysis = analyzeDecisionSchema({ schema: NPC_COMMAND_KIND_SCHEMA });
  if (!analysis.ok) {
    throw new Error('the frozen task schema must compile');
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: NPC_COMMAND_KIND_POLICY });
  if (!binding.ok) {
    throw new Error('the frozen task policy must bind');
  }
  return binding.plan;
})();

/** Schema shape the runner re-validates against. */
const schema = NPC_COMMAND_KIND_SCHEMA as Record<string, unknown>;

/**
 * An adapter that answers a scripted sequence of literals.
 *
 * Resolves a literal to the compiler's positional option key the same way a real
 * backend resolves a criteria key, so the test never depends on option ordering
 * and a change to the enum cannot silently relabel the question.
 */
const scriptedAdapter = (options: {
  /** Literals to answer in order; `'abstain'` refuses. */
  readonly script: readonly (string | 'abstain')[];
  readonly languages?: DecisionCapability['languages'];
  readonly ready?: boolean;
  readonly notReadyState?: DecisionCapability['notReadyState'];
  readonly notReadyReason?: string;
}): DecisionAdapter & { calls: number } => {
  let calls = 0;
  const adapter: DecisionAdapter & { calls: number } = {
    backendId: 'scripted:test',
    dialect: 'jev-v1',
    get calls() {
      return calls;
    },
    capability: async (): Promise<DecisionCapability> => ({
      backendId: 'scripted:test',
      dialect: 'jev-v1',
      ready: options.ready ?? true,
      primitives: ['boolean', 'choice', 'combination'],
      maxOptions: 64,
      maxQuestions: 16,
      maxContextBytes: 64 * 1024,
      languages: options.languages ?? ['en'],
      checkpoint: 'scripted',
      ...(options.ready === false
        ? {
            notReadyReason: options.notReadyReason ?? 'scripted as not ready',
            ...(options.notReadyState === undefined
              ? {}
              : { notReadyState: options.notReadyState }),
          }
        : {}),
    }),
    run: async (request: DecisionRequest) => {
      const literal = options.script[Math.min(calls, options.script.length - 1)];
      calls += 1;
      if (literal === 'abstain') {
        return {
          ok: false as const,
          reason: 'below-accept-threshold' as const,
          detail: 'scripted abstention',
          queueMs: 0,
          inferenceMs: 1,
        };
      }
      const answers = [];
      for (const question of request.unit.questions) {
        const index = (question.options ?? []).findIndex(
          (option) => String(option.value) === literal,
        );
        if (index < 0) {
          return {
            ok: false as const,
            reason: 'invalid-response' as const,
            detail: `script asked for "${literal}", which is not on offer`,
            queueMs: 0,
            inferenceMs: 1,
          };
        }
        answers.push({ questionKey: question.key, optionKey: `o${index}` });
      }
      return { ok: true, answers, queueMs: 0, inferenceMs: 1, checkpoint: 'scripted' };
    },
  };
  return adapter;
};

/** A case with a known positive label. */
const positive = (caseId: string, expected: string, state = `ask ${caseId}`): EvaluationCase => ({
  caseId,
  category: 'clear-intent',
  language: 'en',
  kind: 'positive',
  expected,
  state,
});

/** A case where no command is warranted. */
const abstain = (caseId: string, state = `smalltalk ${caseId}`): EvaluationCase => ({
  caseId,
  category: 'out-of-scope',
  language: 'en',
  kind: 'required-abstain',
  expected: null,
  state,
});

/** A case with two defensible readings and no single right answer. */
const excluded = (caseId: string, state = `ambiguous ${caseId}`): EvaluationCase => ({
  caseId,
  category: 'ambiguous',
  language: 'en',
  kind: 'excluded',
  expected: null,
  state,
});

/** The frozen safety gate shape, tightened so a single failure is visible. */
const GATE: EvaluationQualityGate = {
  minPositiveRecall: 0.85,
  maxFalseAcceptanceRate: 0.05,
  maxFalseAcceptances: 0,
  minCoverage: 0.5,
  minLegalValueRate: 1,
};

const run = (
  cases: readonly EvaluationCase[],
  script: readonly (string | 'abstain')[],
  overrides?: Partial<Parameters<typeof evaluateSplit>[0]>,
): ReturnType<typeof evaluateSplit> =>
  evaluateSplit({
    split: 'heldout',
    cases,
    adapter: scriptedAdapter({ script }),
    plan,
    schema,
    policy: NPC_COMMAND_KIND_POLICY,
    timeoutMs: 1_000,
    compareValue: NPC_COMMAND_KIND_COMPARATOR,
    safeLiteral: 'none',
    ...overrides,
  });

describe('the false-pass regression — an out-of-scope command is a false acceptance', () => {
  test('two correct positives plus one accepted out-of-scope input cannot report zero risk', async () => {
    const report = await run(
      [positive('p1', 'trade'), positive('p2', 'recruit'), abstain('a1')],
      ['trade', 'recruit', 'trade'],
    );

    // The two positives are correct...
    expect(report.overall.positives).toBe(2);
    expect(report.overall.correct).toBe(2);
    expect(report.overall.positiveRecall).toBe(1);

    // ...and the command fired where none was warranted is counted, not hidden.
    expect(report.overall.requiredAbstention).toBe(1);
    expect(report.overall.falseAcceptances).toBe(1);
    expect(report.overall.falseAcceptanceRate).toBe(1);
  });

  test('the same run FAILS the declared safety gate', async () => {
    const report = await run(
      [positive('p1', 'trade'), positive('p2', 'recruit'), abstain('a1')],
      ['trade', 'recruit', 'trade'],
    );
    const failures = evaluateQualityGates(report, GATE);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toContain('false acceptance');
    expect(failures.join('\n')).toContain('warranted');
  });

  test('coverage does not reward the unsafe answer', async () => {
    const unsafe = await run([positive('p1', 'trade'), abstain('a1')], ['trade', 'trade']);
    const honest = await run([positive('p1', 'trade'), abstain('a1')], ['trade', 'none']);
    // Both answered both cases, so coverage is the same: answering an
    // out-of-scope case must not be rewarded as extra reach.
    expect(unsafe.overall.coverage).toBe(honest.overall.coverage);
    expect(unsafe.overall.coverage).toBe(1);
    expect(unsafe.overall.falseAcceptances).toBe(1);
    expect(honest.overall.falseAcceptances).toBe(0);
    // Answering the task's safe literal is credited as safe, not as coverage.
    expect(honest.overall.safeAnswers).toBe(1);
    expect(honest.overall.correct).toBe(1);
  });

  test('abstaining on a required-abstain case is the safe outcome and is not penalised', async () => {
    const report = await run([positive('p1', 'trade'), abstain('a1')], ['trade', 'abstain']);
    expect(report.overall.falseAcceptances).toBe(0);
    expect(report.overall.abstentions['below-accept-threshold']).toBe(1);
  });
});

describe('all-abstain cannot pass', () => {
  test('an all-abstain backend scores zero positive recall and fails', async () => {
    const report = await run(
      [positive('p1', 'trade'), positive('p2', 'recruit'), positive('p3', 'skillCheck')],
      ['abstain'],
    );
    expect(report.overall.positiveRecall).toBe(0);
    expect(report.overall.answeredPositiveAccuracy).toBe(0);
    expect(report.overall.coverage).toBe(0);
    const failures = evaluateQualityGates(report, GATE);
    expect(failures.join('\n')).toContain('positive recall');
  });

  test('answered-positive accuracy can exceed recall without making the scorer inconsistent', async () => {
    // Survivorship-bias guard: answering only the easy positives and abstaining
    // on the rest reads 1.000 on the diagnostic and must not clear the gate.
    const report = await run(
      [positive('p1', 'trade'), positive('p2', 'recruit'), positive('p3', 'skillCheck')],
      ['trade', 'abstain', 'abstain'],
    );
    expect(report.overall.answeredPositiveAccuracy).toBe(1);
    expect(report.overall.positiveRecall).toBeCloseTo(1 / 3, 5);
    const failures = evaluateQualityGates(report, GATE).join('\n');
    expect(failures).toContain('positive recall');
    expect(failures).not.toContain('inconsistent');
    expect(
      evaluateQualityGates(
        {
          ...report,
          overall: {
            ...report.overall,
            positiveRecall: 1,
            answeredPositiveAccuracy: 0,
            positivesAnswered: 0,
          },
        },
        GATE,
      ).join('\n'),
    ).toContain('exceeds answered-positive accuracy');
  });
});

describe('case languages are dispatched, never inherited from the policy', () => {
  test('a fixture whose language the checkpoint does not declare ABSTAINS', async () => {
    const french: EvaluationCase = {
      caseId: 'fr-1',
      category: 'out-of-scope-language',
      language: 'fr',
      kind: 'required-abstain',
      expected: null,
      state: 'Je voudrais acheter une lanterne.',
    };
    const report = await run([french], ['trade'], {
      adapter: scriptedAdapter({ script: ['trade'], languages: ['en'] }),
    });
    expect(report.overall.successful).toBe(0);
    expect(report.overall.abstentions['language-unsupported']).toBe(1);
    expect(report.overall.falseAcceptances).toBe(0);
  });

  test('the runner reports language-unsupported rather than answering in English', async () => {
    const result = await runDecision({
      plan,
      schema,
      policy: NPC_COMMAND_KIND_POLICY,
      adapter: scriptedAdapter({ script: ['trade'], languages: ['en'] }),
      context: 'Je voudrais acheter une lanterne.',
      language: 'fr',
      deadlineAt: Date.now() + 1_000,
      signal: new AbortController().signal,
      requestId: 'lang',
      stateRevision: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('language-unsupported');
    }
  });
});

describe('coverage is bounded by the graded cases', () => {
  test('answering an excluded case cannot push coverage above 100%', async () => {
    const report = await run(
      [positive('p1', 'trade'), abstain('a1'), excluded('x1')],
      ['trade', 'none', 'none'],
    );
    // `none` is legal on an excluded case but is not graded coverage.
    expect(report.overall.successful).toBe(3);
    expect(report.overall.gradedAnswered).toBe(2);
    expect(report.overall.coverage).toBe(1);
    expect(report.overall.coverage).toBeLessThanOrEqual(1);
  });
});

describe('excluded cases are excluded, not scored as negatives', () => {
  test('an excluded case never enters any denominator', async () => {
    const report = await run([positive('p1', 'trade'), excluded('x1')], ['trade', 'trade']);
    expect(report.overall.graded).toBe(1);
    expect(report.overall.excluded).toBe(1);
    expect(report.overall.requiredAbstention).toBe(0);
    // Answering it is recorded, but it is neither rewarded nor a false acceptance.
    expect(report.overall.unexplainedAcceptances).toBe(1);
    expect(report.overall.falseAcceptances).toBe(0);
    expect(report.overall.positiveRecall).toBe(1);
  });

  test('a contradictory corpus is refused rather than reinterpreted', () => {
    const problems = assertCaseIntegrity([
      positive('p1', 'trade'),
      { ...abstain('a1'), expected: 'trade' } as EvaluationCase,
      { ...positive('p2', 'recruit'), expected: null } as EvaluationCase,
      positive('p1', 'skillCheck'),
    ]);
    expect(problems.join('\n')).toContain("kind 'required-abstain' must carry expected: null");
    expect(problems.join('\n')).toContain("kind 'positive' requires a label");
    expect(problems.join('\n')).toContain('duplicate case id p1');
  });
});

describe('language and category slices', () => {
  test('every language in the corpus gets its own row', async () => {
    const report = await run(
      [
        positive('p1', 'trade'),
        { ...abstain('a1'), language: 'multi' },
        { ...positive('p2', 'recruit'), language: 'multi' },
      ],
      ['trade', 'trade', 'recruit'],
      {
        adapter: scriptedAdapter({
          script: ['trade', 'trade', 'recruit'],
          languages: ['en', 'multi'],
        }),
      },
    );
    const keys = report.byLanguage.map((entry) => entry.key);
    expect(keys).toEqual(['en', 'multi']);
    expect(report.byLanguage.find((entry) => entry.key === 'multi')?.positiveRecall).toBe(1);
  });

  test('a per-language recall floor is enforced and named', async () => {
    const report = await run(
      [positive('p1', 'trade'), { ...positive('p2', 'recruit'), language: 'multi' }],
      ['trade', 'none'],
      { adapter: scriptedAdapter({ script: ['trade', 'none'], languages: ['en', 'multi'] }) },
    );
    const failures = evaluateQualityGates(report, { ...GATE, minLanguageRecall: { multi: 0.9 } });
    expect(failures.join('\n')).toContain('language multi positive recall');
  });
});

describe('latency conditions are established, not asserted', () => {
  test('cold and warm are separated by dispatch order, and the method is reported', async () => {
    const cases = Array.from({ length: 25 }, (_, index) => positive(`p${index}`, 'trade'));
    const report = await run(cases, ['trade'], { coldSamples: MIN_REPETITIONS_FOR_PERCENTILE });
    expect(report.latencyConditionMethod).toBe('cold-then-warm');
    expect(report.overall.coldLatenciesMs).toHaveLength(MIN_REPETITIONS_FOR_PERCENTILE);
    expect(report.overall.warmLatenciesMs).toHaveLength(5);
    // A cold p95 is only reportable once the cold condition was established.
    expect(report.overall.coldP95Ms).toBeDefined();
    expect(report.overall.warmP95Ms).toBeUndefined();
    expect(report.overall.warmMedianMs).toBeDefined();
    const failures = evaluateQualityGates(report, GATE, {
      maxWarmP50Ms: 1000,
      maxWarmP95Ms: 1000,
      maxColdP95Ms: 1000,
    });
    expect(
      failures.some((failure) =>
        failure.startsWith('warm p95 latency gate could not be evaluated'),
      ),
    ).toBe(true);
    expect(
      failures.some((failure) =>
        failure.startsWith('cold p95 latency gate could not be evaluated'),
      ),
    ).toBe(false);
  });

  test('an unestablished condition withholds the percentile rather than rounding the max', async () => {
    const cases = Array.from({ length: 4 }, (_, index) => positive(`p${index}`, 'trade'));
    const report = await run(cases, ['trade']);
    expect(report.overall.warmP95Ms).toBeUndefined();
    expect(report.overall.percentileUnavailable).toContain(
      `a percentile needs ${MIN_REPETITIONS_FOR_PERCENTILE}`,
    );
    expect(
      evaluateQualityGates(report, GATE, {
        maxWarmP50Ms: 1_000,
        maxWarmP95Ms: 1_000,
        maxColdP95Ms: 1_000,
      }).join('\n'),
    ).toContain('could not be evaluated');
  });
});

describe('live measurement compatibility', () => {
  test('an empty split record is skipped without dispatching', async () => {
    const adapter = scriptedAdapter({ script: ['trade'] });
    const result = await runLiveDecisionMeasurement({
      adapter,
      schema,
      policy: NPC_COMMAND_KIND_POLICY,
      splits: {},
      qualityGate: GATE,
    });
    expect(result.status).toBe('skipped');
    expect(adapter.calls).toBe(0);
  });

  test('the public measureSplit export returns flat metrics from the shared scorer', async () => {
    const result = await measureSplit({
      split: 'heldout',
      cases: [positive('p1', 'trade'), abstain('a1')],
      adapter: scriptedAdapter({ script: ['trade', 'none'] }),
      plan,
      schema,
      policy: NPC_COMMAND_KIND_POLICY,
      timeoutMs: 1000,
      coldSamples: 0,
      warmupRequests: 0,
      safeLiteral: 'none',
    });
    expect(result.split).toBe('heldout');
    expect(result.accuracy).toBe(1);
    expect(result.cases).toBe(2);
    expect(result.answered).toBe(2);
    expect(result.safeAnswers).toBe(1);
    expect(result.riskyFalseAcceptance).toBe(0);
  });
});
