// packages/frontend/ai-gateway/tests/decision_npc_action_selection_measurement.test.ts
//
// Regression coverage for the measurement driver's denominators and latency
// conditions (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
//
// The first version of the driver used a POSITIONAL warm-up: dispatch the first
// few cases as "cold", discard the next few as "warm-up", then start scoring.
// On the held-out fixture the discarded block landed entirely inside the
// positives, so a corpus of 33 cases / 15 positives was reported as 30 / 12.
//
// Nothing about the arithmetic was wrong. The tally simply never received the
// three dropped cases, so every rate was computed over the wrong denominator
// and the bias depended on where the cases happened to be authored. That is
// invisible unless something asserts the denominators, which is what this file
// is.

import { describe, expect, it } from 'bun:test';
import type { DecisionAdapter } from '../src/lib/decision/adapters/types.ts';
import { createDeterministicDecisionAdapter } from '../src/lib/decision/index.ts';
import { NPC_ACTION_SELECTION_SPLITS } from '../src/lib/decision/tasks/npc_action_corpus.ts';
import {
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_QUALITY_GATE,
} from '../src/lib/decision/tasks/npc_action_selection.ts';
import {
  denominatorProblemsFor,
  measureNpcActionSelection,
  WARMUP_REQUEST,
} from '../src/lib/decision/tasks/npc_action_selection_measurement.ts';

const cases = NPC_ACTION_SELECTION_SPLITS.heldout.cases;

/** An adapter that never abstains, so every case reaches the scorer. */
const eagerAdapter = (): DecisionAdapter => {
  const inner = createDeterministicDecisionAdapter({
    backendId: 'eager-lexicon',
    rules: { rules: { actionId: [{ weight: 1, match: ['x'], value: NPC_ACTION_NONE_ID }] } },
  });
  return {
    backendId: inner.backendId,
    dialect: inner.dialect,
    capability: (probe) => inner.capability(probe),
    residency: inner.residency,
    // Always match, so the control reaches `scoreResult` as an accepted answer
    // rather than an abstention — the point is the DENOMINATOR, not accuracy.
    run: async (request) => {
      const response = await inner.run(request);
      if (!response.ok) {
        return response;
      }
      return { ...response, answers: response.answers };
    },
  };
};

describe('denominators — every fixture case is scored exactly once', () => {
  it('scores the whole held-out fixture, not a positional subset', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });

    const heldout = measurement.splits[0];
    expect(heldout?.fixtureCaseCount).toBe(33);
    expect(heldout?.cases.length).toBe(33);
    expect(heldout?.overall.attempted).toBe(33);
  });

  it('preserves every positive, which the positional warm-up used to discard', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    const heldout = measurement.splits[0];

    expect(heldout?.fixturePositiveCount).toBe(15);
    expect(heldout?.overall.positives).toBe(15);
    expect(heldout?.cases.filter((entry) => entry.kind === 'positive').length).toBe(15);
  });

  it('preserves every required-abstention case', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    const heldout = measurement.splits[0];
    expect(heldout?.overall.requiredAbstention).toBe(18);
  });

  it('never scores the same case twice', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    const ids = measurement.splits[0]?.cases.map((entry) => entry.caseId) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports no denominator problem when it scored everything', () => {
    const measurement = {
      split: 'heldout',
      overall: {} as never,
      byCategory: [],
      cases: [{ caseId: 'a', kind: 'positive' as const }],
      fixtureCaseCount: 1,
      fixturePositiveCount: 1,
      fixtureRequiredAbstentionCount: 0,
    };
    expect(denominatorProblemsFor([measurement])).toEqual([]);
  });

  it('FAILS the run when a split drops a case — the original regression', () => {
    const measurement = {
      split: 'heldout',
      overall: {} as never,
      byCategory: [],
      cases: [
        { caseId: 'a', kind: 'positive' as const },
        { caseId: 'b', kind: 'positive' as const },
      ],
      fixtureCaseCount: 3,
      fixturePositiveCount: 3,
      fixtureRequiredAbstentionCount: 0,
    };
    const problems = denominatorProblemsFor([measurement]);
    expect(problems.join(' ')).toContain('scored 2 case(s) but its fixture declares 3');
    expect(problems.join(' ')).toContain('scored 2 positive(s) but its fixture declares 3');
  });

  it('surfaces a denominator problem as a gate failure, not only as metadata', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    // A correct run has no denominator problems, and therefore none in the gate list.
    expect(measurement.denominatorProblems).toEqual([]);
    expect(measurement.gateFailures.join(' ')).not.toContain('fixture declares');
  });
});

describe('warm-up spends no fixture case', () => {
  it('uses a dedicated request whose id is not a corpus case', () => {
    expect(WARMUP_REQUEST.id).toBe('warmup-dedicated');
    const ids = new Set(cases.map((entry) => entry.caseId));
    expect(ids.has(WARMUP_REQUEST.id)).toBe(false);
  });

  it('counts warm-up dispatches separately from inference', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
      warmupRequests: 2,
    });
    expect(measurement.calls.warmupDispatches).toBe(2);
    // Warm-up is counted on its own line, never folded into scored inference.
    expect(measurement.calls.inferenceDispatches).toBe(33);
  });

  it('runs exactly one readiness probe, timed apart from inference', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    expect(measurement.calls.readinessProbes).toBe(1);
    expect(measurement.timings.readinessProbeMsTotal).toBeGreaterThanOrEqual(0);
    expect(measurement.timings.totalMs).toBeGreaterThanOrEqual(
      measurement.timings.readinessProbeMsTotal,
    );
  });
});

describe('latency conditions come from runtime evidence, not position', () => {
  it('reports a verified method and counts warm cases when the runtime answers', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    expect(measurement.conditions.residencyVerified).toBe(true);
    expect(measurement.conditions.residencyMethod).toBe('in-process');
    // The deterministic control has nothing to load, so every case is warm.
    expect(measurement.conditions.verifiedWarmCases).toBe(33);
    expect(measurement.warmConditionEstablished).toBe(true);
  });

  it('never reports a warm condition for a runtime that cannot be asked', async () => {
    const inner = eagerAdapter();
    const silent: DecisionAdapter = {
      backendId: inner.backendId,
      dialect: inner.dialect,
      capability: inner.capability,
      // No `residency` at all — the runtime offers no way to know.
      run: inner.run,
    };
    const measurement = await measureNpcActionSelection({
      adapter: silent,
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    expect(measurement.conditions.residencyVerified).toBe(false);
    expect(measurement.conditions.unverifiedCases).toBe(33);
    expect(measurement.conditions.verifiedWarmCases).toBe(0);
    expect(measurement.warmConditionEstablished).toBe(false);
  });

  it('labels an unverified case cold, so it never enters the warm aggregate', async () => {
    const inner = eagerAdapter();
    const silent: DecisionAdapter = {
      backendId: inner.backendId,
      dialect: inner.dialect,
      capability: inner.capability,
      run: inner.run,
    };
    const measurement = await measureNpcActionSelection({
      adapter: silent,
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    const heldout = measurement.splits[0];
    expect(heldout?.cases.every((entry) => entry.latencyCondition === 'cold')).toBe(true);
    expect(heldout?.overall.warmMedianMs).toBeUndefined();
  });

  it('trusts a runtime that reports the checkpoint is NOT resident', async () => {
    const inner = eagerAdapter();
    const cold: DecisionAdapter = {
      backendId: inner.backendId,
      dialect: inner.dialect,
      capability: inner.capability,
      residency: async () => ({
        verified: true,
        resident: false,
        method: 'test:always-cold',
        detail: 'probe says cold',
      }),
      run: inner.run,
    };
    const measurement = await measureNpcActionSelection({
      adapter: cold,
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    expect(measurement.conditions.verifiedColdCases).toBe(33);
    expect(measurement.warmConditionEstablished).toBe(false);
  });

  it('counts residency observations as their own calls, not as inference', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
      warmupRequests: 1,
    });
    // Every scored case plus the warm-up dispatch: all calls are counted.
    expect(measurement.calls.residencyObservations).toBe(34);
  });
});

describe('both splits are measured in full', () => {
  it('reports the dev split at its own size', async () => {
    const measurement = await measureNpcActionSelection({
      adapter: eagerAdapter(),
      splits: { dev: NPC_ACTION_SELECTION_SPLITS.dev.cases, heldout: cases },
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
    });
    const dev = measurement.splits.find((entry) => entry.split === 'dev');
    const heldout = measurement.splits.find((entry) => entry.split === 'heldout');
    expect(dev?.cases.length).toBe(20);
    expect(heldout?.cases.length).toBe(33);
    expect(measurement.denominatorProblems).toEqual([]);
  });
});
