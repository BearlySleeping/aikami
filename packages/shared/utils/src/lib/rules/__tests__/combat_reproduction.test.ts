// packages/shared/utils/src/lib/rules/__tests__/combat_reproduction.test.ts
//
// Reproduction import validation and replay: schema/version/limit/incompleteness
// rejection, oversized/invalid JSON rejection, deterministic replay against the
// recorded final hash, and a stable hash function.
//
// Contract: combat debug workspace (execution prompt §8)
import { describe, expect, it } from 'bun:test';
import {
  COMBAT_REPRODUCTION_MAX_BYTES,
  COMBAT_REPRODUCTION_MAX_COMMANDS,
  COMBAT_REPRODUCTION_VERSION,
} from '@aikami/schemas';
import type { CombatCommand, CombatReproduction, CombatState } from '@aikami/types';
import { createCombatState } from '../combat_kernel';
import {
  hashFinalState,
  parseCombatReproduction,
  parseCombatReproductionJson,
  replayCombatReproduction,
} from '../combat_reproduction';
import { createInput, GOBLIN_1, PLAYER_ID } from './combat_fixtures';

const initialState = (): CombatState => createCombatState(createInput({ seed: 4242 }));

/** Exactly two commands: player attack, then end the player's turn. */
const twoCommands = (): CombatCommand[] => [
  {
    kind: 'useAbility',
    combatantId: PLAYER_ID,
    abilityId: 'basic_melee',
    targetIds: [GOBLIN_1],
  },
  { kind: 'endTurn', combatantId: PLAYER_ID },
];

const buildReproduction = (overrides: Partial<CombatReproduction> = {}): CombatReproduction => ({
  reproductionVersion: COMBAT_REPRODUCTION_VERSION,
  rulesVersion: initialState().rulesVersion,
  scenarioId: 'basic-direct-turn',
  scenarioVersion: 1,
  encounterRunId: initialState().encounterRunId,
  seed: '4242',
  recordedInitialState: initialState(),
  commands: twoCommands(),
  checkpoints: [],
  expectedEvents: [],
  controllerRecords: [],
  complete: true,
  droppedTraceEntries: 0,
  ...overrides,
});

describe('parseCombatReproduction', () => {
  it('accepts a valid reproduction', () => {
    const reproduction = buildReproduction();
    const result = parseCombatReproduction(reproduction);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reproduction).toEqual(reproduction);
    }
  });

  it('rejects a schema mismatch', () => {
    const result = parseCombatReproduction({ nope: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('schema');
    }
  });

  it('rejects a non-object input', () => {
    expect(parseCombatReproduction(null).ok).toBe(false);
    expect(parseCombatReproduction('not-an-object').ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    const result = parseCombatReproduction(
      buildReproduction({ reproductionVersion: COMBAT_REPRODUCTION_VERSION + 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Unsupported reproduction version');
    }
  });

  it('rejects a command count over the limit', () => {
    const tooMany = Array.from({ length: COMBAT_REPRODUCTION_MAX_COMMANDS + 1 }, () => ({
      kind: 'endTurn' as const,
      combatantId: PLAYER_ID,
    }));
    const result = parseCombatReproduction(buildReproduction({ commands: tooMany }));
    expect(result.ok).toBe(false);
    // The schema's `maxItems` bound rejects the oversized array before the
    // explicit command-limit branch is reached; either guard is a rejection.
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects an incomplete bundle', () => {
    const result = parseCombatReproduction(buildReproduction({ complete: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('incomplete');
    }
  });
});

describe('parseCombatReproductionJson', () => {
  it('rejects oversized input before parsing', () => {
    const raw = 'x'.repeat(COMBAT_REPRODUCTION_MAX_BYTES + 1);
    const result = parseCombatReproductionJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('maximum size');
    }
  });

  it('measures the import limit in UTF-8 bytes rather than UTF-16 code units', () => {
    const raw = 'é'.repeat(Math.floor(COMBAT_REPRODUCTION_MAX_BYTES / 2) + 1);
    expect(raw.length).toBeLessThan(COMBAT_REPRODUCTION_MAX_BYTES);
    const result = parseCombatReproductionJson(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('maximum size');
    }
  });

  it('rejects invalid JSON', () => {
    const result = parseCombatReproductionJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not valid JSON');
    }
  });

  it('accepts a valid serialized reproduction', () => {
    const result = parseCombatReproductionJson(JSON.stringify(buildReproduction()));
    expect(result.ok).toBe(true);
  });
});

describe('replayCombatReproduction', () => {
  it('replays a 2-command sequence to a final state', () => {
    const reproduction = buildReproduction();
    const result = replayCombatReproduction(reproduction);
    expect(result.finalState).not.toBeNull();
    expect(result.replay.commands).toHaveLength(2);
    expect(result.replay.events.length).toBeGreaterThan(0);
    expect(result.scenarioId).toBe('basic-direct-turn');
    expect(result.encounterRunId).toBe(reproduction.encounterRunId);
  });

  it('reports matchedExpected against a recorded hashFinalState', () => {
    const reproduction = buildReproduction();
    const first = replayCombatReproduction(reproduction);
    expect(first.finalState).not.toBeNull();
    if (first.finalState === null) {
      return;
    }
    const expectedFinalHash = hashFinalState(first.finalState);

    const matched = replayCombatReproduction({ ...reproduction, expectedFinalHash });
    expect(matched.matchedExpected).toBe(true);

    const mismatched = replayCombatReproduction({
      ...reproduction,
      expectedFinalHash: 'cjs1-deadbeef',
    });
    expect(mismatched.matchedExpected).toBe(false);
  });

  it('reports null matchedExpected when no hash is recorded', () => {
    const reproduction = buildReproduction();
    const replayed = replayCombatReproduction(reproduction);
    const result = replayCombatReproduction({
      ...reproduction,
      expectedEvents: replayed.replay.events,
    });
    expect(result.matchedExpected).toBeNull();
    expect(result.divergence).toBeNull();
  });

  it('reports an event mismatch at its command boundary when no hash is recorded', () => {
    const reproduction = buildReproduction();
    const replayed = replayCombatReproduction(reproduction);
    const expectedEvents = replayed.replay.events.filter(
      (event) => event.stateRevision !== reproduction.recordedInitialState.stateRevision + 2,
    );
    const result = replayCombatReproduction({ ...reproduction, expectedEvents });
    expect(result.divergence).toBe(1);
  });
});

describe('hashFinalState', () => {
  it('is stable for the same state', () => {
    const state = initialState();
    expect(hashFinalState(state)).toBe(hashFinalState(state));
  });

  it('is key-order independent', () => {
    expect(hashFinalState({ b: 1, a: 2 })).toBe(hashFinalState({ a: 2, b: 1 }));
  });

  it('differs when a value changes', () => {
    const state = initialState();
    const mutated = { ...state, stateRevision: state.stateRevision + 1 };
    expect(hashFinalState(state)).not.toBe(hashFinalState(mutated));
  });

  it('produces a cjs1-prefixed hash', () => {
    expect(hashFinalState(initialState()).startsWith('cjs1-')).toBe(true);
  });
});
