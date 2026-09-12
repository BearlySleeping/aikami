// packages/shared/utils/src/lib/rules/__tests__/combat_replay.test.ts
//
// AC-5: replay equivalence, immutability and divergence reporting.
// Contract: C-509 AC-5

import { describe, expect, it } from 'bun:test';
import type { CombatCommand, CombatState } from '@aikami/types';
import {
  COMBAT_RULES_VERSION,
  canonicalCombatJson,
  createCombatState,
  findFirstCombatDivergence,
  replayCombat,
  resolveCombatCommand,
} from '../combat_kernel';
import { createInput, GOBLIN_1, GOBLIN_2, PLAYER_ID } from './combat_fixtures';

// ── Command logs ───────────────────────────────────────────────────────

const attack = (targetId: string): CombatCommand => ({
  kind: 'useAbility',
  combatantId: PLAYER_ID,
  abilityId: 'basic_melee',
  targetIds: [targetId],
});

/** One full round: player attacks, then every combatant ends its turn. */
const buildRound = (): CombatCommand[] => [
  attack(GOBLIN_1),
  { kind: 'endTurn', combatantId: PLAYER_ID },
  { kind: 'endTurn', combatantId: GOBLIN_1 },
  { kind: 'endTurn', combatantId: GOBLIN_2 },
];

/** A 50-command log that never depends on dice outcomes. */
const buildLongLog = (): CombatCommand[] => {
  const commands: CombatCommand[] = [];
  for (let round = 0; round < 12; round++) {
    commands.push({ kind: 'defend', combatantId: PLAYER_ID });
    commands.push({ kind: 'endTurn', combatantId: PLAYER_ID });
    commands.push({ kind: 'endTurn', combatantId: GOBLIN_1 });
    commands.push({ kind: 'endTurn', combatantId: GOBLIN_2 });
  }
  commands.push({ kind: 'defend', combatantId: PLAYER_ID });
  commands.push({ kind: 'endTurn', combatantId: PLAYER_ID });
  return commands;
};

const initialState = (): CombatState => createCombatState(createInput({ seed: 4242 }));

// ── AC-5 ───────────────────────────────────────────────────────────────

describe('replayCombat (C-509 AC-5)', () => {
  it('reconstructs byte-equivalent events and final state across two runs', () => {
    const state = initialState();
    const commands = buildLongLog();
    const first = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    const second = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    expect(canonicalCombatJson(first.replay)).toBe(canonicalCombatJson(second.replay));
    expect(canonicalCombatJson(first.finalState)).toBe(canonicalCombatJson(second.finalState));
    expect(first.finalState).not.toBeNull();
    expect(findFirstCombatDivergence(first.replay, second.replay)).toBeNull();
  });

  it('replays dice-bearing logs byte-identically', () => {
    const state = initialState();
    const commands = buildRound();
    const first = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    const second = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    expect(canonicalCombatJson(first.replay.events)).toBe(
      canonicalCombatJson(second.replay.events),
    );
    expect(first.replay.events.some((event) => event.kind === 'attackRolled')).toBe(true);
  });

  it('does not share mutable state between the two replays', () => {
    const state = initialState();
    const commands = buildRound();
    const first = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    const second = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    const snapshot = canonicalCombatJson(second.replay);
    const mutable = first.replay as unknown as {
      events: unknown[];
      finalState: CombatState | null;
    };
    mutable.events.length = 0;
    if (mutable.finalState !== null) {
      mutable.finalState.stateRevision = 999;
      mutable.finalState.phase = 'ended';
    }
    expect(canonicalCombatJson(second.replay)).toBe(snapshot);
  });

  it('does not mutate the initial state it is handed', () => {
    const state = initialState();
    const before = canonicalCombatJson(state);
    replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: buildRound(),
    });
    expect(canonicalCombatJson(state)).toBe(before);
  });

  it('records replayVersion, rulesVersion and the full command log', () => {
    const state = initialState();
    const commands = buildRound();
    const { replay } = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    expect(replay.replayVersion).toBe(1);
    expect(replay.rulesVersion).toBe(COMBAT_RULES_VERSION);
    expect(replay.commands).toEqual(commands);
    expect(replay.initialState).toEqual(state);
  });

  it('aborts at the first invalid command and reports no final state', () => {
    const state = initialState();
    const commands: CombatCommand[] = [
      attack(GOBLIN_1),
      { kind: 'endTurn', combatantId: GOBLIN_1 },
      { kind: 'endTurn', combatantId: PLAYER_ID },
    ];
    const { replay, finalState } = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands,
    });
    expect(finalState).toBeNull();
    expect(replay.finalState).toBeNull();
    // Only the first command resolved — the second is out of turn.
    expect(replay.events.every((event) => event.stateRevision === 1)).toBe(true);
    expect(replay.events.length).toBeGreaterThan(0);
  });

  it('never throws on a hostile command log', () => {
    const state = initialState();
    expect(() =>
      replayCombat({
        initialState: state,
        rulesVersion: COMBAT_RULES_VERSION,
        commands: [null, 'nope', 7] as unknown as CombatCommand[],
      }),
    ).not.toThrow();
    const { finalState } = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: [null] as unknown as CombatCommand[],
    });
    expect(finalState).toBeNull();
  });

  it('aborts when the supplied rulesVersion does not match the initial state', () => {
    const state = initialState();
    const { replay, finalState } = replayCombat({
      initialState: state,
      rulesVersion: 'combat-9.9.9',
      commands: buildRound(),
    });
    expect(finalState).toBeNull();
    expect(replay.events).toEqual([]);
    expect(replay.rulesVersion).toBe('combat-9.9.9');
  });

  it('replays a 50-command log inside the §18 budget', () => {
    const state = initialState();
    const commands = buildLongLog();
    expect(commands).toHaveLength(50);
    replayCombat({ initialState: state, rulesVersion: COMBAT_RULES_VERSION, commands });
    const started = performance.now();
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      replayCombat({ initialState: state, rulesVersion: COMBAT_RULES_VERSION, commands });
    }
    const perReplayMs = (performance.now() - started) / iterations;
    // 5× tolerance for CI noise; the raw measurement is recorded in the Execution Report.
    expect(perReplayMs).toBeLessThan(50 * 5);
  });
});

describe('findFirstCombatDivergence (C-509 AC-5)', () => {
  it('reports the first divergent event index for an appended command', () => {
    const state = initialState();
    const base = buildRound();
    const a = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: base,
    });
    const b = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: [...base, { kind: 'move', combatantId: PLAYER_ID, path: [{ x: 0, y: 1 }] }],
    });
    const divergence = findFirstCombatDivergence(a.replay, b.replay);
    expect(divergence).not.toBeNull();
    expect(divergence?.eventIndex).toBe(a.replay.events.length);
    expect(divergence?.stateRevision).toBeGreaterThan(0);
  });

  it('reports the end of the shorter log for an omitted command', () => {
    const state = initialState();
    const base = buildLongLog();
    const a = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: base,
    });
    const b = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: base.slice(0, base.length - 1),
    });
    const divergence = findFirstCombatDivergence(a.replay, b.replay);
    expect(divergence).not.toBeNull();
    expect(divergence?.eventIndex).toBe(b.replay.events.length);
  });

  it('reports the first differing event for a substituted command', () => {
    const state = initialState();
    const base = buildRound();
    const mutated: CombatCommand[] = [{ kind: 'wait', combatantId: PLAYER_ID }, ...base.slice(1)];
    const a = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: base,
    });
    const b = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: mutated,
    });
    const divergence = findFirstCombatDivergence(a.replay, b.replay);
    expect(divergence).not.toBeNull();
    expect(divergence?.eventIndex).toBe(0);
  });

  it('returns null for identical replays', () => {
    const state = initialState();
    const commands = buildRound();
    const a = replayCombat({ initialState: state, rulesVersion: COMBAT_RULES_VERSION, commands });
    const b = replayCombat({ initialState: state, rulesVersion: COMBAT_RULES_VERSION, commands });
    expect(findFirstCombatDivergence(a.replay, b.replay)).toBeNull();
  });

  it('reports the end of a zero-event replay pair when only the final state differs', () => {
    const state = initialState();
    const a = replayCombat({
      initialState: state,
      rulesVersion: 'combat-unsupported',
      commands: [],
    });
    const b = replayCombat({
      initialState: state,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: [],
    });
    expect(a.finalState).toBeNull();
    expect(b.finalState).not.toBeNull();
    expect(findFirstCombatDivergence(a.replay, b.replay)).toEqual({
      stateRevision: 0,
      eventIndex: 0,
    });
  });
});

describe('canonicalCombatJson (C-509 AC-5)', () => {
  it('is key-order independent', () => {
    expect(canonicalCombatJson({ b: 1, a: 2 })).toBe(canonicalCombatJson({ a: 2, b: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalCombatJson([1, 2])).not.toBe(canonicalCombatJson([2, 1]));
  });

  it('matches the kernel output of two structurally equal states', () => {
    const state = initialState();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const shuffled: CombatState = {
      objectives: result.state.objectives,
      outcome: result.state.outcome,
      battlefield: result.state.battlefield,
      abilityCatalog: result.state.abilityCatalog,
      combatants: result.state.combatants,
      initiative: result.state.initiative,
      rng: result.state.rng,
      turnId: result.state.turnId,
      phase: result.state.phase,
      round: result.state.round,
      stateRevision: result.state.stateRevision,
      encounterId: result.state.encounterId,
      rulesVersion: result.state.rulesVersion,
      schemaVersion: result.state.schemaVersion,
    };
    expect(canonicalCombatJson(shuffled)).toBe(canonicalCombatJson(result.state));
  });
});
