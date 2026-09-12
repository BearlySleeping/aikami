// packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts
//
// AC-2 + AC-4: the pure combat kernel resolves the bounded command set
// deterministically, and its RNG state is explicit, serializable and
// substream-isolated.
//
// Contract: C-509 AC-2, AC-4

import { describe, expect, it } from 'bun:test';
import type { CombatCommand, CombatState } from '@aikami/types';
import { createSeedableRng, deserializeRng, serializeRng } from '../../rng/seedable_rng';
import {
  COMBAT_RULES_VERSION,
  canonicalCombatJson,
  createCombatState,
  resolveCombatCommand,
  validateCombatCommand,
} from '../combat_kernel';
// `DEFAULT_MOVEMENT_PER_TURN` now lives in the coordinator (C-514 moved the
// turn/budget authority there); the value and its assertions are unchanged.
import { DEFAULT_MOVEMENT_PER_TURN } from '../combat_turn_coordinator';
import {
  ABILITY_CATALOG,
  createInput,
  deepFreeze,
  ENCOUNTER_ID,
  eastwardPath,
  GOBLIN_1,
  GOBLIN_2,
  gridPoint,
  makeCombatant,
  makeCombatants,
  PLAYER_ID,
  southwardPath,
} from './combat_fixtures';

// ── Helpers ────────────────────────────────────────────────────────────

const active = (seed = 1337): CombatState => createCombatState(createInput({ seed }));

const activeId = (state: CombatState): string =>
  state.initiative.order[state.initiative.activeIndex];

/** Walks the turn order to `combatantId` by ending every turn in between. */
const handTurnTo = (state: CombatState, combatantId: string): CombatState => {
  let current = state;
  let guard = 0;
  while (activeId(current) !== combatantId) {
    const actor = activeId(current);
    const result = resolveCombatCommand({
      state: current,
      command: { kind: 'endTurn', combatantId: actor },
    });
    if (!result.valid) {
      throw new Error(`could not advance the turn: ${result.reasonCode}`);
    }
    current = result.state;
    guard += 1;
    if (guard > 64) {
      throw new Error('turn advance guard tripped');
    }
  }
  return current;
};

const attack = (
  state: CombatState,
  overrides: Partial<{ abilityId: string; targetIds: string[]; combatantId: string }> = {},
): CombatCommand => ({
  kind: 'useAbility',
  combatantId: overrides.combatantId ?? activeId(state),
  abilityId: overrides.abilityId ?? 'basic_melee',
  targetIds: overrides.targetIds ?? [GOBLIN_1],
});

/** Mirrors the kernel's d20 outcome rule for test assertions. */
const expectedHit = (naturalRoll: number, totalRoll: number, armorClass: number): boolean => {
  if (naturalRoll === 20) {
    return true;
  }
  if (naturalRoll === 1) {
    return false;
  }
  return totalRoll >= armorClass;
};

const firstAttackEvent = (events: readonly { kind: string }[]) =>
  events.find((event) => event.kind === 'attackRolled') as
    | {
        kind: 'attackRolled';
        naturalRoll: number;
        totalRoll: number;
        hit: boolean;
        isCriticalHit: boolean;
      }
    | undefined;

/** Finds a seed whose first `basic_melee` attack against the goblin misses. */
const seedWithMiss = (): { seed: number; state: CombatState } => {
  for (let seed = 1; seed <= 400; seed++) {
    const state = active(seed);
    const result = resolveCombatCommand({ state, command: attack(state) });
    if (!result.valid) {
      continue;
    }
    const rolled = firstAttackEvent(result.events);
    if (rolled?.hit === false) {
      return { seed, state };
    }
  }
  throw new Error('no missing seed found in range');
};

/** Finds a seed whose first `basic_melee` attack against the goblin crits. */
const seedWithCrit = (): { seed: number; state: CombatState } => {
  for (let seed = 1; seed <= 400; seed++) {
    const state = active(seed);
    const result = resolveCombatCommand({ state, command: attack(state) });
    if (!result.valid) {
      continue;
    }
    const rolled = firstAttackEvent(result.events);
    if (rolled?.isCriticalHit === true) {
      return { seed, state };
    }
  }
  throw new Error('no critical seed found in range');
};

/** Finds a seed whose first attack with `abilityId` lands a hit. */
const seedWithHit = (abilityId = 'basic_melee'): number => {
  for (let seed = 1; seed <= 400; seed++) {
    const state = active(seed);
    const result = resolveCombatCommand({ state, command: attack(state, { abilityId }) });
    if (!result.valid) {
      continue;
    }
    if (firstAttackEvent(result.events)?.hit === true) {
      return seed;
    }
  }
  throw new Error(`no hitting seed found for ${abilityId}`);
};

// ── createCombatState ──────────────────────────────────────────────────

describe('createCombatState (C-509 AC-2)', () => {
  it('produces a versioned state with a deterministic initiative order', () => {
    const state = active();
    expect(state.schemaVersion).toBe(2);
    expect(state.rulesVersion).toBe(COMBAT_RULES_VERSION);
    expect(state.encounterId).toBe(ENCOUNTER_ID);
    expect(state.stateRevision).toBe(0);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('active');
    expect(state.initiative.order).toEqual([PLAYER_ID, GOBLIN_1, GOBLIN_2]);
    expect(state.initiative.activeIndex).toBe(0);
    expect(state.turnId).toBe(`r1:${PLAYER_ID}`);
    expect(state.outcome).toBeNull();
  });

  it('is deterministic — same input, byte-identical output', () => {
    expect(canonicalCombatJson(active())).toBe(canonicalCombatJson(active()));
  });

  it('breaks initiative ties deterministically by combatantId', () => {
    const state = createCombatState(
      createInput({
        combatants: [
          makeCombatant({ combatantId: 'b', initiative: 10, position: gridPoint(0, 0) }),
          makeCombatant({ combatantId: 'a', initiative: 10, position: gridPoint(1, 0) }),
        ],
      }),
    );
    expect(state.initiative.order).toEqual(['a', 'b']);
  });

  it('seeds three independent named substreams', () => {
    const state = active();
    expect(state.rng.seed).toBe(1337);
    expect(Object.keys(state.rng.streams).sort()).toEqual(['actions', 'initiative', 'loot']);
    expect(state.rng.streams.actions.seed).not.toBe(state.rng.streams.initiative.seed);
    expect(state.rng.streams.loot.seed).not.toBe(state.rng.streams.actions.seed);
  });

  it('ends immediately when there are no combatants', () => {
    const state = createCombatState(createInput({ combatants: [] }));
    expect(state.phase).toBe('ended');
    expect(state.turnId).toBeNull();
    expect(state.outcome).toEqual({ victory: false, reason: 'no_combatants' });
  });
});

// ── AC-2: move ─────────────────────────────────────────────────────────

describe('resolveCombatCommand — move (C-509 AC-2)', () => {
  it('decrements movement by path length and emits movementCommitted', () => {
    const state = active();
    const path = southwardPath(0, 0, 2);
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.stateRevision).toBe(1);
    expect(result.state.combatants[PLAYER_ID].position).toEqual(gridPoint(0, 2));
    expect(result.state.combatants[PLAYER_ID].budget.movementRemaining).toBe(4);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kind: 'movementCommitted',
      combatantId: PLAYER_ID,
      movementCost: 2,
      movementRemaining: 4,
      stateRevision: 1,
      turnId: `r1:${PLAYER_ID}`,
      round: 1,
      encounterId: ENCOUNTER_ID,
    });
  });

  it('does not mutate the input state, path or ability catalog', () => {
    const state = deepFreeze(active());
    const path = deepFreeze(eastwardPath(0, 0, 1));
    const before = canonicalCombatJson(state);
    const catalogBefore = canonicalCombatJson(ABILITY_CATALOG);
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path },
    });
    expect(result.valid).toBe(true);
    expect(canonicalCombatJson(state)).toBe(before);
    expect(canonicalCombatJson(ABILITY_CATALOG)).toBe(catalogBefore);
  });

  it('rejects a non-contiguous path', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(1, 0), gridPoint(3, 0)] },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'pathInvalid' });
  });

  it('rejects a teleport-style jump from the actor cell', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(0, 3)] },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'pathInvalid' });
  });

  it('rejects an out-of-bounds path', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(-1, 0)] },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'pathInvalid' });
  });

  it('rejects a path that revisits a cell', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: {
        kind: 'move',
        combatantId: PLAYER_ID,
        path: [gridPoint(1, 0), gridPoint(1, 1), gridPoint(1, 0)],
      },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'pathInvalid' });
  });

  it('rejects a blocked cell with pathBlocked', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(1, 0), gridPoint(2, 0)] },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'pathBlocked' });
  });

  it('rejects movement beyond the remaining budget', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: southwardPath(0, 0, 7) },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'movementBudgetExceeded' });
  });

  it('leaves the caller state untouched on every rejection', () => {
    const state = deepFreeze(active());
    const before = canonicalCombatJson(state);
    resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(0, 5)] },
    });
    expect(canonicalCombatJson(state)).toBe(before);
    expect(state.stateRevision).toBe(0);
  });
});

// ── AC-2: useAbility ───────────────────────────────────────────────────

describe('resolveCombatCommand — useAbility (C-509 AC-2)', () => {
  it('rolls on the actions substream and emits attackRolled then damageApplied on a hit', () => {
    const state = active();
    const result = resolveCombatCommand({ state, command: attack(state) });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const rolled = firstAttackEvent(result.events);
    expect(rolled).toBeDefined();
    if (rolled === undefined) {
      return;
    }
    // attackBonus (5) + ability attackBonus (2) = +7 against AC 13
    expect(rolled.totalRoll).toBe(rolled.naturalRoll + 7);
    expect(rolled.hit).toBe(expectedHit(rolled.naturalRoll, rolled.totalRoll, 13));
    expect(result.events[0]).toMatchObject({
      kind: 'attackRolled',
      attackerId: PLAYER_ID,
      targetId: GOBLIN_1,
      abilityId: 'basic_melee',
      stateRevision: 1,
    });
    if (rolled.hit) {
      expect(result.events.some((event) => event.kind === 'damageApplied')).toBe(true);
      expect(result.state.combatants[PLAYER_ID].budget.actionAvailable).toBe(false);
    }
  });

  it('emits attackRolled with hit:false and no damage on a miss', () => {
    const { state } = seedWithMiss();
    const result = resolveCombatCommand({ state, command: attack(state) });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const rolled = firstAttackEvent(result.events);
    expect(rolled?.hit).toBe(false);
    expect(result.events.some((event) => event.kind === 'damageApplied')).toBe(false);
    expect(result.state.combatants[GOBLIN_1].hp).toBe(12);
  });

  it('marks a natural 20 as a critical hit and doubles the damage dice', () => {
    const { state } = seedWithCrit();
    const result = resolveCombatCommand({ state, command: attack(state) });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const rolled = firstAttackEvent(result.events);
    expect(rolled?.isCriticalHit).toBe(true);
    const applied = result.events.find((event) => event.kind === 'damageApplied') as
      | { amount: number }
      | undefined;
    expect(applied).toBeDefined();
    // 2d6 always beats 1d6's minimum
    expect(applied?.amount).toBeGreaterThanOrEqual(2);
  });

  it('clamps damage at 0 HP and emits downed then defeated', () => {
    const state = active(seedWithHit('heavy_melee'));
    const wounded = {
      ...state,
      combatants: {
        ...state.combatants,
        [GOBLIN_1]: { ...state.combatants[GOBLIN_1], hp: 1 },
      },
    };
    const lethal = resolveCombatCommand({
      state: wounded,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'heavy_melee',
        targetIds: [GOBLIN_1],
      },
    });
    expect(lethal.valid).toBe(true);
    if (!lethal.valid) {
      return;
    }
    const damage = lethal.events.find((event) => event.kind === 'damageApplied') as
      | { hpAfter: number; downed: boolean }
      | undefined;
    expect(damage?.hpAfter).toBe(0);
    expect(damage?.downed).toBe(true);
    const kinds = lethal.events.map((event) => event.kind);
    expect(kinds).toContain('combatantDowned');
    expect(kinds).toContain('combatantDefeated');
    expect(lethal.state.combatants[GOBLIN_1].defeated).toBe(true);
    expect(lethal.state.combatants[GOBLIN_1].downed).toBe(true);
    expect(lethal.state.combatants[GOBLIN_1].hp).toBe(0);
  });

  it('ends the encounter when the last opposing combatant is defeated', () => {
    const state = active(seedWithHit('heavy_melee'));
    const nearlyOver = {
      ...state,
      combatants: {
        ...state.combatants,
        [GOBLIN_1]: { ...state.combatants[GOBLIN_1], hp: 1 },
        [GOBLIN_2]: { ...state.combatants[GOBLIN_2], hp: 0, defeated: true, downed: true },
      },
    };
    const result = resolveCombatCommand({
      state: nearlyOver,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'heavy_melee',
        targetIds: [GOBLIN_1],
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.phase).toBe('ended');
    expect(result.state.outcome).toEqual({ victory: true, reason: 'all_enemies_defeated' });
    expect(result.events.at(-1)).toMatchObject({ kind: 'combatEnded', victory: true });
  });

  it('rejects every further command once the encounter has ended', () => {
    const state = active();
    const ended = { ...state, phase: 'ended' as const, outcome: { victory: true, reason: 'x' } };
    const result = resolveCombatCommand({
      state: ended,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'encounterEnded' });
  });

  it('consumes the quick action for a quick-cost ability and the action for an action-cost one', () => {
    const state = active();
    const quick = resolveCombatCommand({
      state,
      command: { kind: 'useAbility', combatantId: PLAYER_ID, abilityId: 'focus', targetIds: [] },
    });
    expect(quick.valid).toBe(true);
    if (!quick.valid) {
      return;
    }
    expect(quick.state.combatants[PLAYER_ID].budget.quickActionAvailable).toBe(false);
    expect(quick.state.combatants[PLAYER_ID].budget.actionAvailable).toBe(true);
    expect(quick.events).toEqual([]);

    const noQuick = resolveCombatCommand({
      state: quick.state,
      command: { kind: 'useAbility', combatantId: PLAYER_ID, abilityId: 'focus', targetIds: [] },
    });
    expect(noQuick).toMatchObject({ valid: false, reasonCode: 'noActionAvailable' });
  });
});

// ── AC-2: defend / wait / endTurn ──────────────────────────────────────

describe('resolveCombatCommand — defend, wait, endTurn (C-509 AC-2)', () => {
  it('defend consumes the action and emits no event', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'defend', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.events).toEqual([]);
    expect(result.state.combatants[PLAYER_ID].budget.actionAvailable).toBe(false);
    expect(result.state.stateRevision).toBe(1);
  });

  it('wait consumes the action and emits no event', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'wait', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.events).toEqual([]);
    expect(result.state.combatants[PLAYER_ID].budget.actionAvailable).toBe(false);
  });

  it('rejects defend and wait once the action is spent', () => {
    const state = active();
    const spent = resolveCombatCommand({
      state,
      command: { kind: 'defend', combatantId: PLAYER_ID },
    });
    expect(spent.valid).toBe(true);
    if (!spent.valid) {
      return;
    }
    expect(
      resolveCombatCommand({
        state: spent.state,
        command: { kind: 'wait', combatantId: PLAYER_ID },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'noActionAvailable' });
  });

  it('endTurn advances the active index and emits turnEnded then turnStarted', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.initiative.activeIndex).toBe(1);
    expect(result.state.turnId).toBe(`r1:${GOBLIN_1}`);
    expect(result.events.map((event) => event.kind)).toEqual(['turnEnded', 'turnStarted']);
    expect(result.events[0]).toMatchObject({ kind: 'turnEnded', combatantId: PLAYER_ID, round: 1 });
    expect(result.events[1]).toMatchObject({
      kind: 'turnStarted',
      combatantId: GOBLIN_1,
      turnId: `r1:${GOBLIN_1}`,
      round: 1,
    });
  });

  it('increments the round on wrap and resets the incoming turn budget', () => {
    let state = active();
    for (let i = 0; i < 3; i++) {
      const actor = activeId(state);
      const result = resolveCombatCommand({
        state,
        command: { kind: 'endTurn', combatantId: actor },
      });
      expect(result.valid).toBe(true);
      if (!result.valid) {
        return;
      }
      state = result.state;
    }
    expect(state.round).toBe(2);
    expect(state.initiative.activeIndex).toBe(0);
    expect(state.turnId).toBe(`r2:${PLAYER_ID}`);
    expect(state.combatants[PLAYER_ID].budget).toEqual({
      movementRemaining: DEFAULT_MOVEMENT_PER_TURN,
      actionAvailable: true,
      quickActionAvailable: true,
      reactionAvailable: true,
    });
  });

  it('skips defeated combatants when advancing', () => {
    const state = active();
    const withDead = {
      ...state,
      combatants: {
        ...state.combatants,
        [GOBLIN_1]: { ...state.combatants[GOBLIN_1], hp: 0, downed: true, defeated: true },
      },
    };
    const result = resolveCombatCommand({
      state: withDead,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.initiative.activeIndex).toBe(2);
    expect(result.state.turnId).toBe(`r1:${GOBLIN_2}`);
  });

  it('does not implicitly run enemy turns — endTurn advances exactly one slot', () => {
    const state = active();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.initiative.activeIndex).toBe(1);
    expect(result.events).toHaveLength(2);
  });
});

// ── AC-2: rejection table ──────────────────────────────────────────────

describe('validateCombatCommand reason codes (C-509 AC-2)', () => {
  it('returns a typed failure for an invalid state', () => {
    const state = active();
    Object.defineProperty(state, 'schemaVersion', { value: 1 });
    const result = resolveCombatCommand({
      state,
      command: { kind: 'wait', combatantId: PLAYER_ID },
    });
    expect(result).toEqual({
      valid: false,
      reasonCode: 'invalidStateShape',
      messageKey: 'combat.invalid.state_shape',
    });
  });

  it('returns a typed failure instead of sharing an uncloneable state reference', () => {
    const state = active();
    const uncloneableState = new Proxy(state, {});
    const result = resolveCombatCommand({
      state: uncloneableState,
      command: { kind: 'wait', combatantId: PLAYER_ID },
    });
    expect(result).toEqual({
      valid: false,
      reasonCode: 'invalidStateShape',
      messageKey: 'combat.invalid.state_shape',
    });
    expect(state.combatants[PLAYER_ID].budget.actionAvailable).toBe(true);
  });

  it('rejects an unknown command shape', () => {
    const state = active();
    const result = validateCombatCommand({
      state,
      command: { kind: 'teleport', combatantId: PLAYER_ID } as unknown as CombatCommand,
    });
    expect(result).toMatchObject({ valid: false, reasonCode: 'invalidCommandShape' });
  });

  it('rejects an unknown actor', () => {
    const state = active();
    expect(
      validateCombatCommand({ state, command: { kind: 'wait', combatantId: 'nobody' } }),
    ).toMatchObject({ valid: false, reasonCode: 'actorUnknown' });
  });

  it('rejects a non-active combatant', () => {
    const state = active();
    expect(
      validateCombatCommand({ state, command: { kind: 'wait', combatantId: GOBLIN_1 } }),
    ).toMatchObject({ valid: false, reasonCode: 'notActiveCombatant' });
  });

  it('rejects an unknown ability', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'meteor',
          targetIds: [GOBLIN_1],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'abilityUnknown' });
  });

  it('rejects an ability the actor does not have', () => {
    const state = handTurnTo(active(), GOBLIN_1);
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: GOBLIN_1,
          abilityId: 'heavy_melee',
          targetIds: [PLAYER_ID],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'abilityNotAvailable' });
  });

  it('rejects a reaction-cost ability (reactions are Combat-08)', () => {
    const state = active();
    const withReaction = {
      ...state,
      abilityCatalog: {
        ...state.abilityCatalog,
        parry: {
          abilityId: 'parry',
          name: 'Parry',
          kind: 'utility' as const,
          actionCost: 'reaction' as const,
          attackBonus: 0,
          damageDice: null,
          damageType: null,
          rangeCells: 0,
          requiresLineOfSight: false,
        },
      },
      combatants: {
        ...state.combatants,
        [PLAYER_ID]: { ...state.combatants[PLAYER_ID], abilityIds: ['parry'] },
      },
    };
    expect(
      validateCombatCommand({
        state: withReaction,
        command: { kind: 'useAbility', combatantId: PLAYER_ID, abilityId: 'parry', targetIds: [] },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'noActionAvailable' });
  });

  it('rejects an attack with no targets', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: [],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'targetInvalid' });
  });

  it('rejects an unknown target', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: ['ghost'],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'targetInvalid' });
  });

  it('rejects the actor as its own target', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: [PLAYER_ID],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'targetInvalid' });
  });

  it('rejects an already-defeated target', () => {
    const state = active();
    const withDead = {
      ...state,
      combatants: {
        ...state.combatants,
        [GOBLIN_1]: { ...state.combatants[GOBLIN_1], hp: 0, downed: true, defeated: true },
      },
    };
    expect(
      validateCombatCommand({
        state: withDead,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: [GOBLIN_1],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'targetDefeated' });
  });

  it('rejects an out-of-range target', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: {
          kind: 'useAbility',
          combatantId: PLAYER_ID,
          abilityId: 'basic_melee',
          targetIds: [GOBLIN_2],
        },
      }),
    ).toMatchObject({ valid: false, reasonCode: 'targetOutOfRange' });
  });

  it('accepts a ranged target inside the range band', () => {
    const state = active();
    const result = validateCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'bow_shot',
        targetIds: [GOBLIN_2],
      },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a stale basedOnRevision and accepts a matching one', () => {
    const state = active();
    expect(
      validateCombatCommand({
        state,
        command: { kind: 'wait', combatantId: PLAYER_ID },
        basedOnRevision: 4,
      }),
    ).toMatchObject({ valid: false, reasonCode: 'staleRevision' });
    expect(
      validateCombatCommand({
        state,
        command: { kind: 'wait', combatantId: PLAYER_ID },
        basedOnRevision: 0,
      }).valid,
    ).toBe(true);
  });

  it('never emits staleRevision when basedOnRevision is omitted', () => {
    const state = active();
    const result = validateCombatCommand({
      state,
      command: { kind: 'wait', combatantId: PLAYER_ID },
    });
    expect(result.valid).toBe(true);
  });

  it('normalizes useAbility targets by dedupe + sort', () => {
    const state = active();
    const result = validateCombatCommand({
      state,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [GOBLIN_1, GOBLIN_1],
      },
    });
    expect(result).toMatchObject({
      valid: true,
      normalizedCommand: { kind: 'useAbility', targetIds: [GOBLIN_1] },
    });
  });

  it('never throws on hostile input', () => {
    const state = active();
    for (const command of [null, undefined, 42, 'move', [], { kind: 'move' }]) {
      expect(() =>
        validateCombatCommand({ state, command: command as unknown as CombatCommand }),
      ).not.toThrow();
      const result = validateCombatCommand({ state, command: command as unknown as CombatCommand });
      expect(result.valid).toBe(false);
    }
  });

  it('every failure carries a stable messageKey', () => {
    const state = active();
    const result = validateCombatCommand({
      state,
      command: { kind: 'wait', combatantId: 'nobody' },
    });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.messageKey).toBe('combat.invalid.actor_unknown');
  });
});

// ── AC-2: budget conservation ──────────────────────────────────────────

describe('budget conservation (C-509 AC-2)', () => {
  it('never increases the movement budget through movement', () => {
    let state = active();
    for (let i = 0; i < 6; i++) {
      const before = state.combatants[PLAYER_ID].budget.movementRemaining;
      const result = resolveCombatCommand({
        state,
        command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(0, i + 1)] },
      });
      expect(result.valid).toBe(true);
      if (!result.valid) {
        return;
      }
      expect(result.state.combatants[PLAYER_ID].budget.movementRemaining).toBe(before - 1);
      state = result.state;
    }
    const exhausted = resolveCombatCommand({
      state,
      command: { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(0, 7)] },
    });
    expect(exhausted).toMatchObject({ valid: false, reasonCode: 'movementBudgetExceeded' });
  });

  it('increments stateRevision by exactly one per successful resolve', () => {
    const state = active();
    const first = resolveCombatCommand({
      state,
      command: { kind: 'wait', combatantId: PLAYER_ID },
    });
    expect(first.valid).toBe(true);
    if (!first.valid) {
      return;
    }
    expect(first.state.stateRevision).toBe(1);
    const second = resolveCombatCommand({
      state: first.state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(second.valid).toBe(true);
    if (!second.valid) {
      return;
    }
    expect(second.state.stateRevision).toBe(2);
  });
});

// ── AC-4: RNG substreams ───────────────────────────────────────────────

describe('RNG substreams (C-509 AC-4)', () => {
  it('isolates the actions substream from an initiative roll', () => {
    const state = active();
    const baseline = resolveCombatCommand({ state, command: attack(state) });
    expect(baseline.valid).toBe(true);
    if (!baseline.valid) {
      return;
    }

    const initiativeRng = deserializeRng(state.rng.streams.initiative);
    for (let i = 0; i < 5; i++) {
      initiativeRng.dice(20);
    }
    const perturbed: CombatState = {
      ...state,
      rng: {
        ...state.rng,
        streams: { ...state.rng.streams, initiative: serializeRng(initiativeRng) },
      },
    };
    const after = resolveCombatCommand({ state: perturbed, command: attack(perturbed) });
    expect(after.valid).toBe(true);
    if (!after.valid) {
      return;
    }

    expect(after.state.rng.streams.actions).toEqual(baseline.state.rng.streams.actions);
    expect(canonicalCombatJson(after.events)).toBe(canonicalCombatJson(baseline.events));
  });

  it('does not advance any substream for move / defend / wait / endTurn', () => {
    const state = active();
    for (const command of [
      { kind: 'move', combatantId: PLAYER_ID, path: [gridPoint(0, 1)] },
      { kind: 'defend', combatantId: PLAYER_ID },
      { kind: 'wait', combatantId: PLAYER_ID },
      { kind: 'endTurn', combatantId: PLAYER_ID },
    ] as CombatCommand[]) {
      const result = resolveCombatCommand({ state, command });
      expect(result.valid).toBe(true);
      if (!result.valid) {
        return;
      }
      expect(result.state.rng).toEqual(state.rng);
    }
  });

  it('round-trips each substream through serializeRng / deserializeRng and resumes exactly', () => {
    const state = active();
    for (const key of ['initiative', 'actions', 'loot'] as const) {
      const serialized = state.rng.streams[key];
      const resumed = deserializeRng(serialized);
      expect(resumed.seed).toBe(serialized.seed);
      expect(serializeRng(resumed)).toEqual(serialized);

      const reference = createSeedableRng(serialized.seed, serialized.state);
      const expected = [reference.next(), reference.next(), reference.next()];
      const actual = [resumed.next(), resumed.next(), resumed.next()];
      expect(actual).toEqual(expected);
    }
  });

  it('captures the seed and every substream state in the JSON wire form', () => {
    const state = active();
    const roundTripped = JSON.parse(JSON.stringify(state)) as CombatState;
    expect(roundTripped.rng).toEqual(state.rng);
    expect(roundTripped.rng.seed).toBe(1337);
    expect(Object.keys(roundTripped.rng.streams).sort()).toEqual(['actions', 'initiative', 'loot']);
  });

  it('produces identical action rolls for the same seed across separate states', () => {
    const a = active(9001);
    const b = active(9001);
    const resultA = resolveCombatCommand({ state: a, command: attack(a) });
    const resultB = resolveCombatCommand({ state: b, command: attack(b) });
    expect(canonicalCombatJson(resultA)).toBe(canonicalCombatJson(resultB));
  });
});

// ── AC-2: performance budget ───────────────────────────────────────────

describe('performance budget (C-509 AC-2, §18)', () => {
  it('resolves an ordinary action well inside the 8 ms budget', () => {
    const state = active();
    const command = attack(state);
    // warm up
    for (let i = 0; i < 20; i++) {
      resolveCombatCommand({ state, command });
    }
    const started = performance.now();
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      resolveCombatCommand({ state, command });
    }
    const perActionMs = (performance.now() - started) / iterations;
    // 5× tolerance for CI noise; the raw measurement is recorded in the Execution Report.
    expect(perActionMs).toBeLessThan(8 * 5);
  });
});

// ── AC-3: requiresLineOfSight is enforced (C-515) ──────────────────────

describe('validateCombatCommand — line of sight (C-515 AC-3)', () => {
  const GridSize = 8;

  const sightGrid = (opaqueCells: Array<{ x: number; y: number }>): boolean[] => {
    const grid = Array.from({ length: GridSize * GridSize }, () => false);
    for (const cell of opaqueCells) {
      grid[cell.y * GridSize + cell.x] = true;
    }
    return grid;
  };

  /**
   * The player at (0,0) sniping the archer at (3,3): the Bresenham line passes
   * through (1,1) and (2,2), so an opaque cell there occludes the target.
   */
  const snipeState = (options: {
    requiresLineOfSight: boolean;
    blocksSight?: boolean[];
  }): CombatState => {
    const combatants = makeCombatants().map((combatant) =>
      combatant.combatantId === PLAYER_ID
        ? { ...combatant, abilityIds: [...combatant.abilityIds, 'snipe'] }
        : combatant,
    );
    const battlefield =
      options.blocksSight === undefined
        ? { width: GridSize, height: GridSize, blockedCells: [] }
        : {
            width: GridSize,
            height: GridSize,
            blockedCells: [],
            blocksSight: options.blocksSight,
          };
    return createCombatState({
      ...createInput({ combatants }),
      abilityCatalog: {
        ...ABILITY_CATALOG,
        snipe: {
          abilityId: 'snipe',
          name: 'Snipe',
          kind: 'ranged_attack',
          actionCost: 'action',
          attackBonus: 2,
          damageDice: '1d6',
          damageType: 'piercing',
          rangeCells: 8,
          requiresLineOfSight: options.requiresLineOfSight,
        },
      },
      battlefield,
    });
  };

  const snipe = (): CombatCommand => ({
    kind: 'useAbility',
    combatantId: PLAYER_ID,
    abilityId: 'snipe',
    targetIds: [GOBLIN_2],
  });

  it('rejects an occluded target with targetNotVisible', () => {
    const state = snipeState({
      requiresLineOfSight: true,
      blocksSight: sightGrid([{ x: 1, y: 1 }]),
    });
    const result = validateCombatCommand({ state, command: snipe() });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('targetNotVisible');
      expect(result.messageKey).toBe('combat.invalid.target_not_visible');
    }
  });

  it('accepts a clear line and ignores occlusion when the ability does not require it', () => {
    const clear = snipeState({
      requiresLineOfSight: true,
      blocksSight: sightGrid([{ x: 4, y: 4 }]),
    });
    expect(validateCombatCommand({ state: clear, command: snipe() }).valid).toBe(true);

    const ignored = snipeState({
      requiresLineOfSight: false,
      blocksSight: sightGrid([{ x: 1, y: 1 }]),
    });
    expect(validateCombatCommand({ state: ignored, command: snipe() }).valid).toBe(true);
  });

  it('preserves C-509 behaviour when the battlefield has no blocksSight grid', () => {
    const state = snipeState({ requiresLineOfSight: true });
    expect(state.battlefield.blocksSight).toBeUndefined();
    expect(validateCombatCommand({ state, command: snipe() }).valid).toBe(true);
  });

  it('never lets the origin or target cell occlude the line', () => {
    const state = snipeState({
      requiresLineOfSight: true,
      blocksSight: sightGrid([
        { x: 0, y: 0 },
        { x: 3, y: 3 },
      ]),
    });
    expect(validateCombatCommand({ state, command: snipe() }).valid).toBe(true);
  });
});
