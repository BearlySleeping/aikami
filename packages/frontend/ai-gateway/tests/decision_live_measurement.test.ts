// packages/frontend/ai-gateway/tests/decision_live_measurement.test.ts
//
// Contract C-567: the measurement consumer C-566 said did not exist.
//
// The most important test in this file is the first one: with no backend, the
// harness must SKIP and say why. A silent skip, or worse a skip reported as a
// pass, is how an unmeasured feature comes to be described as a validated one.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  createDeterministicDecisionAdapter,
  type MeasurementCase,
  type MeasurementQualityGate,
  MIN_REPETITIONS_FOR_PERCENTILE,
  runLiveDecisionMeasurement,
} from '../src/lib/decision/index.ts';

const SCHEMA = Type.Object(
  {
    commandKind: Type.Union([Type.Literal('trade'), Type.Literal('recruit')]),
  },
  { additionalProperties: false },
);

const POLICY = {
  task: 'npc-command-kind',
  enabled: true,
  instructions: 'Decide which bounded dialogue command the player message asks this NPC for.',
  fieldInstructions: { commandKind: 'Which command does the player ask for?' },
  optionDescriptions: {
    commandKind: {
      trade: 'The player wants to open the trade overlay.',
      recruit: 'The player asks this NPC to join the party.',
    },
  },
} as const;

/** The gate C-566 froze before scoring anything. */
const GATE: MeasurementQualityGate = {
  minHeldOutAccuracy: 0.85,
  maxRiskyFalseAcceptance: 0.05,
  minCoverage: 0.5,
  requireLegalValueRate: 1,
};

/** A case with a known expected literal. */
const known = (caseId: string, expected: string, state: string): MeasurementCase => ({
  caseId,
  category: 'clear-intent',
  language: 'en',
  label: 'authored',
  expected,
  state,
});

const heldOut = [
  known('h1', 'trade', 'I would like to see your wares.'),
  known('h2', 'recruit', 'Come with us, we need another pair of hands.'),
  // Ambiguous: no single right answer. Counts toward coverage, never accuracy.
  { ...known('h3', 'x', 'It was under your floorboards the whole time.'), expected: null },
];

describe('skipping', () => {
  test('no adapter means an explicit skip, never a pass', async () => {
    const result = await runLiveDecisionMeasurement({
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toContain('no decision backend');
      expect(result.reason).toContain('nothing was measured');
    }
    // The type has no `passed` on the skipped branch at all: there is no way
    // to read a skip as a success without constructing one.
    expect('passed' in result).toBe(false);
  });

  test('a schema that does not compile skips with the reason', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({ rules: { rules: {} } }),
      schema: Type.Object({ free: Type.String() }),
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });
    expect(result.status).toBe('skipped');
  });

  test('a policy that does not bind skips with the reason', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({ rules: { rules: {} } }),
      schema: SCHEMA,
      policy: { ...POLICY, enabled: false },
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toContain('policy');
    }
  });
});

describe('scoring, when a backend is supplied', () => {
  test('a backend that always abstains cannot pass by refusing to answer', async () => {
    // Rules that match nothing: every case abstains. Coverage and accuracy both
    // collapse, so this is a FAILURE, not a quiet success.
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({ rules: { rules: {} } }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    expect(result.passed).toBe(false);
    const held = result.splits[0];
    expect(held?.coverage).toBe(0);
    expect(held?.accuracy).toBe(0);
    expect(result.gateFailures.length).toBeGreaterThan(0);
  });

  test('accepted and abstained cases are reported separately', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({
        rules: { rules: { commandKind: [{ match: ['wares'], value: 'trade', weight: 1 }] } },
      }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    const held = result.splits[0];
    expect(held?.answered).toBeGreaterThan(0);
    expect(held?.coverage).toBeLessThan(1);
    // Answered-only accuracy must be readable beside the gated accuracy, so a
    // reader can see survivorship bias rather than being handed only the
    // flattering number.
    expect(held?.answeredAccuracy).toBeDefined();
    expect(held?.accuracy).toBeDefined();
  });

  test('every produced value must satisfy the original schema', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({
        rules: { rules: { commandKind: [{ match: ['wares'], value: 'trade', weight: 1 }] } },
      }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
      validateValue: (value) => {
        const kind = (value as { commandKind?: unknown }).commandKind;
        return kind === 'trade' || kind === 'recruit';
      },
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    expect(result.splits[0]?.legalValueRate).toBe(1);
  });

  test('an ambiguous case never counts toward correctness', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({
        rules: { rules: { commandKind: [{ match: ['floorboards'], value: 'trade', weight: 1 }] } },
      }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    // Two of the three cases carry an expected label; the ambiguous one must
    // not be scored as a miss or a hit.
    expect(result.splits[0]?.positives).toBe(2);
  });
});

describe('percentile honesty', () => {
  test('a p95 is withheld below the declared repetition count', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({
        rules: { rules: { commandKind: [{ match: ['wares'], value: 'trade', weight: 1 }] } },
      }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
      latencyGate: { maxWarmP50Ms: 250, maxWarmP95Ms: 750, maxColdP95Ms: 4_000 },
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    const held = result.splits[0];
    expect(held?.latenciesMs.length ?? 0).toBeLessThan(MIN_REPETITIONS_FOR_PERCENTILE);
    expect(held?.p95Ms).toBeUndefined();
    expect(held?.percentileUnavailable).toContain(String(MIN_REPETITIONS_FOR_PERCENTILE));
  });

  test('a latency gate that cannot be evaluated FAILS rather than passing', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({
        rules: { rules: { commandKind: [{ match: ['wares'], value: 'trade', weight: 1 }] } },
      }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
      latencyGate: { maxWarmP50Ms: 250, maxWarmP95Ms: 750, maxColdP95Ms: 4_000 },
    });

    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    // A gate that silently passes because it could not run is not a gate.
    expect(result.gateFailures.some((failure) => failure.includes('latency gate'))).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('every sample is timed, including abstentions', async () => {
    const result = await runLiveDecisionMeasurement({
      adapter: createDeterministicDecisionAdapter({ rules: { rules: {} } }),
      schema: SCHEMA,
      policy: POLICY,
      splits: { heldout: heldOut },
      qualityGate: GATE,
    });
    expect(result.status).toBe('measured');
    if (result.status !== 'measured') {
      return;
    }
    expect(result.splits[0]?.latenciesMs.length).toBe(heldOut.length);
  });
});
