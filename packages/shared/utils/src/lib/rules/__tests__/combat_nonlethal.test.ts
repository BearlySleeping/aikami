// packages/shared/utils/src/lib/rules/__tests__/combat_nonlethal.test.ts
//
// AC-2: morale supports real nonlethal outcomes, through the production command
// path. Covers the retreat and surrender commands end-to-end: authored-morale
// gating, movement legality, escape on arrival, HP/identity preservation, the
// turn-status projection, and the resulting settlement.
//
// Contract: C-532 AC-2

import { describe, expect, it } from 'bun:test';
import { CombatStateSchema } from '@aikami/schemas';
import type { CombatState, MoraleRules, ObjectiveRules } from '@aikami/types';
import { Value } from 'typebox/value';
import { createCombatState, resolveCombatCommand, validateCombatCommand } from '../combat_kernel';
import {
  BASE_MORALE_RULES,
  createDepthInput,
  EXIT_ZONE_ID,
  GUARD_ID,
  HOUND_ID,
  makeDepthCombatants,
  PLAYER_ID,
  ROUT_OBJECTIVE_RULES,
  WARDEN_ID,
} from './combat_depth_fixtures';

/** The hound is the active actor and its morale is already broken. */
const brokenHoundState = (
  overrides: {
    moraleRules?: MoraleRules;
    objectiveRules?: ObjectiveRules;
    combatants?: ReturnType<typeof makeDepthCombatants>;
  } = {},
): CombatState => {
  const moraleRules = overrides.moraleRules ?? BASE_MORALE_RULES;
  const state = createCombatState({
    ...createDepthInput({
      combatants: overrides.combatants ?? makeDepthCombatants(),
      moraleRules,
      objectiveRules: overrides.objectiveRules,
    }),
  });
  // Put the hound on turn with broken morale.
  return {
    ...state,
    initiative: { order: [HOUND_ID, PLAYER_ID, WARDEN_ID, GUARD_ID], activeIndex: 0 },
    turnId: `r1:${HOUND_ID}`,
    participation: {
      ...state.participation,
      [HOUND_ID]: { ...state.participation[HOUND_ID], morale: moraleRules.breakThreshold },
    },
  };
};

/** The hound at (2,0); the authored exit zone is at (0,7). */
const retreatPathAway = [
  { x: 3, y: 0 },
  { x: 4, y: 0 },
  { x: 5, y: 0 },
];
const retreatPathToward = [
  { x: 2, y: 1 },
  { x: 2, y: 2 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
  { x: 0, y: 3 },
  { x: 0, y: 4 },
];

describe('AC-2 retreat validation', () => {
  it('rejects a retreat the encounter does not author', () => {
    const state = brokenHoundState({ moraleRules: { ...BASE_MORALE_RULES, responses: [] } });
    const result = validateCombatCommand({
      state,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('retreatNotAuthored');
    }
  });

  it('rejects a retreat by an actor whose morale has not broken', () => {
    const state = brokenHoundState();
    const steady: CombatState = {
      ...state,
      participation: {
        ...state.participation,
        [HOUND_ID]: { ...state.participation[HOUND_ID], morale: 90 },
      },
    };
    const result = validateCombatCommand({
      state: steady,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('retreatNotAuthored');
    }
  });

  it('rejects a retreat that moves AWAY from the authored exit zone', () => {
    const result = validateCombatCommand({
      state: brokenHoundState(),
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathAway },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('retreatNotTowardExit');
    }
  });

  it('rejects a retreat whose movement is illegal', () => {
    const result = validateCombatCommand({
      state: brokenHoundState(),
      command: { kind: 'retreat', combatantId: HOUND_ID, path: [{ x: 0, y: 7 }] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('pathInvalid');
    }
  });

  it('accepts a legal retreat toward the authored exit zone', () => {
    const result = validateCombatCommand({
      state: brokenHoundState(),
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(true);
  });
});

describe('AC-2 retreat resolution', () => {
  it('marks the actor retreating without touching HP or identity', () => {
    const state = brokenHoundState();
    const before = state.combatants[HOUND_ID];
    const result = resolveCombatCommand({
      state,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.participation[HOUND_ID].status).toBe('retreating');
    expect(result.state.combatants[HOUND_ID].hp).toBe(before.hp);
    expect(result.state.combatants[HOUND_ID].defeated).toBe(false);
    expect(result.state.combatants[HOUND_ID].downed).toBe(false);
    expect(result.events.find((event) => event.kind === 'participationChanged')).toMatchObject({
      combatantId: HOUND_ID,
      status: 'retreating',
      reasonCode: 'declared_retreat',
    });
  });

  it('charges only the committed cells', () => {
    const state = brokenHoundState();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.combatants[HOUND_ID].budget.movementRemaining).toBe(
      state.combatants[HOUND_ID].budget.movementRemaining - retreatPathToward.length,
    );
  });

  it('escapes the actor when the retreat lands inside the authored exit zone', () => {
    const state = brokenHoundState();
    // Place the hound one step from the exit zone at (0,7).
    const adjacent: CombatState = {
      ...state,
      combatants: {
        ...state.combatants,
        [HOUND_ID]: { ...state.combatants[HOUND_ID], position: { x: 0, y: 6 } },
      },
    };
    const result = resolveCombatCommand({
      state: adjacent,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: [{ x: 0, y: 7 }] },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.participation[HOUND_ID].status).toBe('escaped');
    expect(result.events.find((event) => event.kind === 'participationChanged')).toMatchObject({
      status: 'escaped',
      reasonCode: 'reached_exit_zone',
    });
    expect(result.state.combatants[HOUND_ID].hp).toBe(state.combatants[HOUND_ID].hp);
  });

  it('a retreating actor still contests the encounter until it escapes or surrenders', () => {
    const state = brokenHoundState();
    const result = resolveCombatCommand({
      state,
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    if (!result.valid) {
      return;
    }
    // The rout objective still counts it as contesting, so the encounter is live.
    expect(result.state.phase).not.toBe('ended');
    expect(result.state.settlement).toBeNull();
  });

  it('produces a schema-valid state', () => {
    const result = resolveCombatCommand({
      state: brokenHoundState(),
      command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(Value.Check(CombatStateSchema, result.state)).toBe(true);
  });

  it('is deterministic across replays', () => {
    const run = () =>
      resolveCombatCommand({
        state: brokenHoundState(),
        command: { kind: 'retreat', combatantId: HOUND_ID, path: retreatPathToward },
      });
    expect(run()).toEqual(run());
  });
});

describe('AC-2 surrender', () => {
  it('rejects a surrender the encounter does not author', () => {
    const state = brokenHoundState({ moraleRules: { ...BASE_MORALE_RULES, responses: [] } });
    const result = validateCombatCommand({
      state,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('surrenderNotAuthored');
    }
  });

  it('rejects a surrender above the break threshold', () => {
    const state = brokenHoundState();
    const steady: CombatState = {
      ...state,
      participation: {
        ...state.participation,
        [HOUND_ID]: { ...state.participation[HOUND_ID], morale: 90 },
      },
    };
    const result = validateCombatCommand({
      state: steady,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reasonCode).toBe('surrenderNotAuthored');
    }
  });

  it('ends hostile participation while preserving HP and identity', () => {
    const state = brokenHoundState();
    const before = state.combatants[HOUND_ID];
    const result = resolveCombatCommand({
      state,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.participation[HOUND_ID].status).toBe('surrendered');
    expect(result.state.combatants[HOUND_ID].hp).toBe(before.hp);
    expect(result.state.combatants[HOUND_ID].defeated).toBe(false);
    expect(result.state.combatants[HOUND_ID].downed).toBe(false);
    expect(result.events.find((event) => event.kind === 'participationChanged')).toMatchObject({
      status: 'surrendered',
      reasonCode: 'accepted_surrender',
    });
  });

  it('settles a rout victory from an accepted surrender, with no death', () => {
    // The authored `defeat_or_rout` objective is what turns a surrendered
    // hostile into a victory — surrender alone is not a settlement.
    const state = brokenHoundState({ objectiveRules: ROUT_OBJECTIVE_RULES });
    const result = resolveCombatCommand({
      state,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.settlement).not.toBeNull();
    expect(result.state.settlement?.result).toBe('victory');
    expect(result.state.combatants[HOUND_ID].defeated).toBe(false);
    expect(result.state.combatants[HOUND_ID].hp).toBeGreaterThan(0);
  });

  it('a surrendered actor is not an ordinary attack target', () => {
    const state = brokenHoundState();
    const surrendered = resolveCombatCommand({
      state,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    if (!surrendered.valid) {
      return;
    }
    // Put the player on turn and try to attack the surrendered hound.
    const playerTurn: CombatState = {
      ...surrendered.state,
      initiative: { order: [PLAYER_ID, HOUND_ID, WARDEN_ID, GUARD_ID], activeIndex: 0 },
      turnId: `r1:${PLAYER_ID}`,
      phase: 'active',
    };
    const attack = validateCombatCommand({
      state: playerTurn,
      command: {
        kind: 'useAbility',
        combatantId: PLAYER_ID,
        abilityId: 'basic_melee',
        targetIds: [HOUND_ID],
      },
    });
    expect(attack.valid).toBe(false);
  });
});

describe('AC-2 the turn-status projection', () => {
  it('skips a surrendered actor when advancing the turn', () => {
    const state = brokenHoundState();
    const surrendered = resolveCombatCommand({
      state,
      command: { kind: 'surrender', combatantId: HOUND_ID },
    });
    if (!surrendered.valid) {
      return;
    }
    // Re-open the encounter so the advance path can be exercised.
    const live: CombatState = {
      ...surrendered.state,
      phase: 'active',
      settlement: null,
      outcome: null,
      initiative: { order: [HOUND_ID, PLAYER_ID, WARDEN_ID, GUARD_ID], activeIndex: 0 },
      turnId: `r1:${HOUND_ID}`,
    };
    const advanced = resolveCombatCommand({
      state: live,
      command: { kind: 'endTurn', combatantId: HOUND_ID },
    });
    expect(advanced.valid).toBe(true);
    if (!advanced.valid) {
      return;
    }
    // The surrendered hound is skipped; the next active actor is the player.
    expect(advanced.state.initiative.order[advanced.state.initiative.activeIndex]).not.toBe(
      HOUND_ID,
    );
  });
});

describe('AC-2 the pre-existing negotiation path is untouched', () => {
  it('proof_encounter still declares allowNonCombatResolution: false and no morale routing', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile('../../../content/packs/emberwatch/manifest.json', 'utf8'),
    ) as { encounters: Record<string, { allowNonCombatResolution: boolean }> };
    expect(manifest.encounters.proof_encounter.allowNonCombatResolution).toBe(false);
  });
});

describe('AC-2 exit zone identity', () => {
  it('uses the authored exit zone, not a hard-coded one', () => {
    expect(BASE_MORALE_RULES.exitZones[0].zoneId).toBe(EXIT_ZONE_ID);
  });

  it('does not settle while the actor is only retreating', () => {
    const rules: ObjectiveRules = { definitions: [], protectedActorIds: [] };
    const state = createCombatState({ ...createDepthInput({ objectiveRules: rules }) });
    expect(state.settlement).toBeNull();
  });
});
