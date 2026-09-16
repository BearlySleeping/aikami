// packages/shared/utils/src/lib/rules/__tests__/combat_depth_kernel.test.ts
//
// AC-1 / AC-2 / AC-3 / AC-5 / AC-6 at the kernel boundary.
//
// This suite drives the ORDERED RESOLUTION path through `resolveCombatCommand`
// — the production entry point — rather than the pure helpers, so the declared
// ordering (validate → commit prefix → open/resolve windows → resume →
// participation/morale → objectives → one settlement) is exercised as a whole.
//
// Contract: C-532

import { describe, expect, it } from 'bun:test';
import {
  COMBAT_SCHEMA_VERSION,
  COMBAT_SCHEMA_VERSION_V3,
  CombatStateSchema,
  migrateCombatStateToCurrentVersion,
} from '@aikami/schemas';
import type { CombatState, ObjectiveRules } from '@aikami/types';
import { Value } from 'typebox/value';
import { createCombatState, resolveCombatCommand, validateCombatCommand } from '../combat_kernel';
import {
  BASE_MORALE_RULES,
  createDepthInput,
  GUARD_ID,
  HOUND_ID,
  makeDepthCombatants,
  PLAYER_ID,
  REACTION_REGISTRY,
  RITUAL_AFFORDANCE,
  RITUAL_ID,
  WARDEN_ID,
} from './combat_depth_fixtures';

/** Hero at (1,0) is adjacent to the hound at (2,0) — inside its threat range. */
const inRangeCombatants = () =>
  makeDepthCombatants().map((combatant) =>
    combatant.combatantId === PLAYER_ID ? { ...combatant, position: { x: 1, y: 0 } } : combatant,
  );

const depthState = (): CombatState =>
  createCombatState({
    ...createDepthInput({
      combatants: inRangeCombatants(),
      reactionRegistry: REACTION_REGISTRY,
    }),
  });

const moveAway = () =>
  resolveCombatCommand({
    state: depthState(),
    command: { kind: 'move', combatantId: PLAYER_ID, path: [{ x: 0, y: 0 }] },
  });

const resolve = (
  state: CombatState,
  command: Parameters<typeof resolveCombatCommand>[0]['command'],
) => resolveCombatCommand({ state, command });

describe('AC-3 a move that leaves a threat range suspends itself', () => {
  it('opens a window, commits only the prefix, and charges only the prefix', () => {
    const result = moveAway();
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.phase).toBe('reaction');
    expect(result.state.reaction.windows).toHaveLength(1);
    const window = result.state.reaction.windows[0];
    expect(window.moverId).toBe(PLAYER_ID);
    expect(window.currentReactorId).toBe(HOUND_ID);
    expect(window.continuation.committedCells).toEqual([]);
    expect(window.continuation.remainingPath).toEqual([{ x: 0, y: 0 }]);

    const movement = result.events.filter((event) => event.kind === 'movementCommitted');
    expect(movement).toEqual([]);
    expect(result.state.combatants[PLAYER_ID].position).toEqual({ x: 1, y: 0 });
    expect(result.state.combatants[PLAYER_ID].budget.movementRemaining).toBe(6);
    expect(result.events.some((event) => event.kind === 'reactionWindowOpened')).toBe(true);
  });

  it('rejects every other command while the window owns the encounter', () => {
    const result = moveAway();
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    const blocked = validateCombatCommand({
      state: result.state,
      command: { kind: 'endTurn', combatantId: PLAYER_ID },
    });
    expect(blocked.valid).toBe(false);
    if (!blocked.valid) {
      expect(blocked.reasonCode).toBe('reactionPending');
    }
  });

  it('does not suspend a move that triggers nothing', () => {
    const state = createCombatState({
      ...createDepthInput({ reactionRegistry: REACTION_REGISTRY }),
    });
    const result = resolve(state, {
      kind: 'move',
      combatantId: PLAYER_ID,
      path: [{ x: 1, y: 0 }],
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.phase).toBe('active');
    expect(result.state.reaction.windows).toEqual([]);
  });
});

describe('AC-3 declining resumes the command without spending anything', () => {
  it('commits the whole path, charges it once, and keeps the reaction available', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const window = opened.state.reaction.windows[0];
    const resolved = resolve(opened.state, {
      kind: 'resolveReaction',
      combatantId: HOUND_ID,
      encounterRunId: opened.state.encounterRunId,
      windowId: window.windowId,
      windowVersion: window.version,
      choice: 'decline',
      source: 'player',
    });
    expect(resolved.valid).toBe(true);
    if (!resolved.valid) {
      return;
    }
    expect(resolved.state.phase).toBe('active');
    expect(resolved.state.reaction.windows).toEqual([]);
    expect(resolved.state.combatants[PLAYER_ID].position).toEqual({ x: 0, y: 0 });
    // Exactly one cell of movement was charged in total.
    expect(resolved.state.combatants[PLAYER_ID].budget.movementRemaining).toBe(5);
    expect(resolved.state.combatants[HOUND_ID].budget.reactionAvailable).toBe(true);
    expect(resolved.events.filter((event) => event.kind === 'movementCommitted')).toHaveLength(1);
    expect(resolved.events.at(-1)?.kind).toBe('movementContinuationResumed');
    expect(resolved.events.find((event) => event.kind === 'reactionResolved')).toMatchObject({
      choice: 'decline',
      spentReaction: false,
      targetId: null,
    });
  });

  it('rejects a duplicate decline of the same window as stale', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const window = opened.state.reaction.windows[0];
    const resolved = resolve(opened.state, {
      kind: 'resolveReaction',
      combatantId: HOUND_ID,
      encounterRunId: opened.state.encounterRunId,
      windowId: window.windowId,
      windowVersion: window.version,
      choice: 'decline',
      source: 'player',
    });
    expect(resolved.valid).toBe(true);
    if (!resolved.valid) {
      return;
    }
    const duplicate = validateCombatCommand({
      state: resolved.state,
      command: {
        kind: 'resolveReaction',
        combatantId: HOUND_ID,
        encounterRunId: resolved.state.encounterRunId,
        windowId: window.windowId,
        windowVersion: window.version,
        choice: 'decline',
        source: 'player',
      },
    });
    expect(duplicate.valid).toBe(false);
    if (!duplicate.valid) {
      expect(duplicate.reasonCode).toBe('reactionNotPending');
    }
  });

  it('rejects a choice from a stale encounter run', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const window = opened.state.reaction.windows[0];
    const stale = validateCombatCommand({
      state: opened.state,
      command: {
        kind: 'resolveReaction',
        combatantId: HOUND_ID,
        encounterRunId: 'run:some-other-attempt:9',
        windowId: window.windowId,
        windowVersion: window.version,
        choice: 'accept',
        source: 'player',
      },
    });
    expect(stale.valid).toBe(false);
    if (!stale.valid) {
      expect(stale.reasonCode).toBe('encounterRunMismatch');
    }
  });

  it('rejects a choice from a reactor that is not the current one', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const window = opened.state.reaction.windows[0];
    const wrongActor = validateCombatCommand({
      state: opened.state,
      command: {
        kind: 'resolveReaction',
        combatantId: WARDEN_ID,
        encounterRunId: opened.state.encounterRunId,
        windowId: window.windowId,
        windowVersion: window.version,
        choice: 'accept',
        source: 'player',
      },
    });
    expect(wrongActor.valid).toBe(false);
    if (!wrongActor.valid) {
      expect(wrongActor.reasonCode).toBe('reactionStale');
    }
  });
});

describe('AC-3 accepting consumes one reaction and rolls once', () => {
  it('spends the reaction whether the attack hits or misses, and resumes the move', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const window = opened.state.reaction.windows[0];
    const resolved = resolve(opened.state, {
      kind: 'resolveReaction',
      combatantId: HOUND_ID,
      encounterRunId: opened.state.encounterRunId,
      windowId: window.windowId,
      windowVersion: window.version,
      choice: 'accept',
      source: 'player',
    });
    expect(resolved.valid).toBe(true);
    if (!resolved.valid) {
      return;
    }

    const attacks = resolved.events.filter((event) => event.kind === 'attackRolled');
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ attackerId: HOUND_ID, targetId: PLAYER_ID });
    expect(resolved.state.combatants[HOUND_ID].budget.reactionAvailable).toBe(false);
    expect(resolved.state.combatants[PLAYER_ID].budget.movementRemaining).toBe(5);
    expect(resolved.events.find((event) => event.kind === 'reactionResolved')).toMatchObject({
      choice: 'accept',
      spentReaction: true,
      targetId: PLAYER_ID,
    });
    expect(resolved.state.rng.streams.actions).not.toEqual(opened.state.rng.streams.actions);
  });

  it('cancels the remainder when the reaction downs the mover', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    // Make the mover trivially killable so the reaction downs it.
    const fragile: CombatState = {
      ...opened.state,
      combatants: {
        ...opened.state.combatants,
        [PLAYER_ID]: { ...opened.state.combatants[PLAYER_ID], hp: 1, armorClass: 0 },
        [GUARD_ID]: { ...opened.state.combatants[GUARD_ID], defeated: true, hp: 0, downed: true },
      },
    };
    const window = fragile.reaction.windows[0];
    const resolved = resolve(fragile, {
      kind: 'resolveReaction',
      combatantId: HOUND_ID,
      encounterRunId: fragile.encounterRunId,
      windowId: window.windowId,
      windowVersion: window.version,
      choice: 'accept',
      source: 'player',
    });
    expect(resolved.valid).toBe(true);
    if (!resolved.valid) {
      return;
    }
    expect(resolved.state.combatants[PLAYER_ID].defeated).toBe(true);
    expect(
      resolved.events.find((event) => event.kind === 'movementContinuationResumed'),
    ).toMatchObject({ cancelled: true });
    // The mover never reached the trigger cell.
    expect(resolved.state.combatants[PLAYER_ID].position).toEqual({ x: 1, y: 0 });
    expect(resolved.state.phase).toBe('ended');
    expect(resolved.state.settlement?.reasonCode).toBe('party_defeated');
  });
});

describe('AC-1 objectives through the production command path', () => {
  it('completes a reach_zone objective from a committed move and settles once', () => {
    const rules: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.escape',
          kind: 'reach_zone',
          required: true,
          hidden: false,
          rule: {
            kind: 'reach_zone',
            zoneId: 'emberwatch:south_gate',
            cells: [{ x: 0, y: 1 }],
            requiredActorIds: [PLAYER_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    const state = createCombatState({ ...createDepthInput({ objectiveRules: rules }) });
    const result = resolve(state, {
      kind: 'move',
      combatantId: PLAYER_ID,
      path: [{ x: 0, y: 1 }],
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.objectives[0].status).toBe('complete');
    expect(result.state.settlement).toMatchObject({
      result: 'victory',
      reasonCode: 'objective_completed',
    });
    expect(result.events.at(-1)?.kind).toBe('encounterSettled');
  });

  it('does not settle the elimination default while a required objective is unmet', () => {
    const rules: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.stop_ritual',
          kind: 'interact_before_deadline',
          required: true,
          hidden: false,
          rule: {
            kind: 'interact_before_deadline',
            objectId: RITUAL_ID,
            affordanceId: RITUAL_AFFORDANCE,
            deadlineRound: 3,
            requiredActorIds: [PLAYER_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    const state = createCombatState({ ...createDepthInput({ objectiveRules: rules }) });
    const combatants = { ...state.combatants };
    for (const id of [HOUND_ID, WARDEN_ID]) {
      combatants[id] = { ...combatants[id], defeated: true, hp: 0, downed: true };
    }
    const wounded: CombatState = { ...state, combatants };
    const result = resolve(wounded, { kind: 'defend', combatantId: PLAYER_ID });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.settlement).toBeNull();
    expect(result.state.phase).not.toBe('ended');
  });

  it('runs the objective evaluation after a round boundary and fails the deadline', () => {
    const rules: ObjectiveRules = {
      definitions: [
        {
          objectiveId: 'objective.stop_ritual',
          kind: 'interact_before_deadline',
          required: true,
          hidden: false,
          rule: {
            kind: 'interact_before_deadline',
            objectId: RITUAL_ID,
            affordanceId: RITUAL_AFFORDANCE,
            deadlineRound: 3,
            requiredActorIds: [PLAYER_ID],
          },
        },
      ],
      protectedActorIds: [],
    };
    let current = createCombatState({ ...createDepthInput({ objectiveRules: rules }) });
    for (let step = 0; step < 40 && current.phase !== 'ended'; step++) {
      const actorId = current.initiative.order[current.initiative.activeIndex];
      const result = resolve(current, { kind: 'endTurn', combatantId: actorId });
      if (!result.valid) {
        throw new Error(`endTurn rejected: ${result.reasonCode}`);
      }
      current = result.state;
    }
    expect(current.round).toBeGreaterThanOrEqual(4);
    const objective = current.objectives.find(
      (entry) => entry.objectiveId === 'objective.stop_ritual',
    );
    expect(objective?.status).toBe('failed');
    expect(current.settlement?.reasonCode).toBe('deadline_expired');
    expect(current.phase).toBe('ended');
  });
});

describe('AC-6 save/reload and replay preserve pending and terminal state', () => {
  it('a state saved mid-window is schema-valid and restores the same continuation', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    expect(Value.Check(CombatStateSchema, opened.state)).toBe(true);

    // Round-trip through JSON, as a real save does.
    const reloaded = JSON.parse(JSON.stringify(opened.state)) as CombatState;
    expect(Value.Check(CombatStateSchema, reloaded)).toBe(true);
    expect(reloaded.phase).toBe('reaction');
    expect(reloaded.reaction.windows[0].continuation).toEqual(
      opened.state.reaction.windows[0].continuation,
    );
    expect(reloaded.reaction.windows[0].version).toBe(opened.state.reaction.windows[0].version);

    // The restored window resolves identically.
    const window = reloaded.reaction.windows[0];
    const resolved = resolve(reloaded, {
      kind: 'resolveReaction',
      combatantId: HOUND_ID,
      encounterRunId: reloaded.encounterRunId,
      windowId: window.windowId,
      windowVersion: window.version,
      choice: 'accept',
      source: 'player',
    });
    expect(resolved.valid).toBe(true);
  });

  it('replaying the same accepted input reproduces state, events and RNG', () => {
    const run = () => {
      const opened = moveAway();
      if (!opened.valid) {
        throw new Error('expected the window to open');
      }
      const window = opened.state.reaction.windows[0];
      return resolve(opened.state, {
        kind: 'resolveReaction',
        combatantId: HOUND_ID,
        encounterRunId: opened.state.encounterRunId,
        windowId: window.windowId,
        windowVersion: window.version,
        choice: 'accept',
        source: 'player',
      });
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });

  it('a pending reaction does not consume a choice on reload', () => {
    const opened = moveAway();
    expect(opened.valid).toBe(true);
    if (!opened.valid) {
      return;
    }
    const reloaded = JSON.parse(JSON.stringify(opened.state)) as CombatState;
    expect(reloaded.combatants[HOUND_ID].budget.reactionAvailable).toBe(true);
    expect(reloaded.reaction.windows[0].status).toBe('open');
    expect(reloaded.reaction.windows[0].currentReactorId).toBe(HOUND_ID);
  });
});

describe('AC-6 migration from the C-531 wire version', () => {
  const legacyV3 = () => {
    const current = createCombatState({ ...createDepthInput() });
    const {
      objectiveRules: _rules,
      participation: _participation,
      moraleRules: _morale,
      reactionRegistry: _registry,
      reaction: _reaction,
      settlement: _settlement,
      encounterRunId: _run,
      ...rest
    } = current;
    return {
      ...rest,
      schemaVersion: COMBAT_SCHEMA_VERSION_V3,
      objectives: [{ objectiveId: 'legacy.survival', kind: 'survival', status: 'pending' }],
    };
  };

  it('migrates v3 → current and validates', () => {
    const migrated = migrateCombatStateToCurrentVersion(legacyV3());
    expect(Value.Check(CombatStateSchema, migrated)).toBe(true);
    const state = migrated as CombatState;
    expect(state.schemaVersion).toBe(COMBAT_SCHEMA_VERSION);
  });

  it('gives a migrated encounter EMPTY authored rules — no injected ritual deadline', () => {
    const state = migrateCombatStateToCurrentVersion(legacyV3()) as CombatState;
    expect(state.objectiveRules).toEqual({ definitions: [], protectedActorIds: [] });
    expect(state.moraleRules.triggers).toEqual([]);
    expect(state.reactionRegistry.definitions).toEqual([]);
    expect(state.reaction.windows).toEqual([]);
    expect(state.settlement).toBeNull();
  });

  it('adds progress 0 to legacy objective records without reinterpreting them', () => {
    const state = migrateCombatStateToCurrentVersion(legacyV3()) as CombatState;
    expect(state.objectives).toEqual([
      { objectiveId: 'legacy.survival', kind: 'survival', status: 'pending', progress: 0 },
    ]);
  });

  it('preserves malformed non-array objectives for schema rejection', () => {
    const malformed = { ...legacyV3(), objectives: { unexpected: true } };
    const migrated = migrateCombatStateToCurrentVersion(malformed) as Record<string, unknown>;
    expect(migrated.objectives).toEqual({ unexpected: true });
    expect(Value.Check(CombatStateSchema, migrated)).toBe(false);
  });

  it('defaults older actors to active participation with no invented morale history', () => {
    const state = migrateCombatStateToCurrentVersion(legacyV3()) as CombatState;
    for (const combatantId of [PLAYER_ID, GUARD_ID, HOUND_ID, WARDEN_ID]) {
      expect(state.participation[combatantId]).toEqual({
        status: 'active',
        morale: 100,
        appliedTriggerIds: [],
        reactionPolicy: 'ask',
      });
    }
  });

  it('maps existing defeated state explicitly onto participation', () => {
    const legacy = legacyV3() as Record<string, unknown>;
    const combatants = { ...(legacy.combatants as Record<string, Record<string, unknown>>) };
    combatants[HOUND_ID] = { ...combatants[HOUND_ID], defeated: true, downed: true, hp: 0 };
    const state = migrateCombatStateToCurrentVersion({
      ...legacy,
      combatants,
    }) as CombatState;
    expect(state.participation[HOUND_ID].status).toBe('defeated');
    expect(state.participation[PLAYER_ID].status).toBe('active');
  });

  it('derives a deterministic encounter-run identity for a migrated snapshot', () => {
    const first = migrateCombatStateToCurrentVersion(legacyV3()) as CombatState;
    const second = migrateCombatStateToCurrentVersion(legacyV3()) as CombatState;
    expect(first.encounterRunId).toBe(second.encounterRunId);
  });

  it('leaves a current-version snapshot untouched', () => {
    const current = createCombatState({ ...createDepthInput() });
    expect(migrateCombatStateToCurrentVersion(current)).toBe(current);
  });

  it('migrates a v2 snapshot straight through to the current version', () => {
    const v3 = legacyV3() as Record<string, unknown>;
    const { environment: _env, environmentBundle: _bundle, ...v2 } = v3;
    const migrated = migrateCombatStateToCurrentVersion({
      ...v2,
      schemaVersion: 2,
    }) as CombatState;
    expect(Value.Check(CombatStateSchema, migrated)).toBe(true);
    expect(migrated.environment.objects).toEqual({});
    expect(migrated.participation[PLAYER_ID].status).toBe('active');
  });

  it('leaves a non-object and an unknown version untouched for the caller to reject', () => {
    expect(migrateCombatStateToCurrentVersion(null)).toBeNull();
    expect(migrateCombatStateToCurrentVersion({ schemaVersion: 99 })).toEqual({
      schemaVersion: 99,
    });
  });
});

describe('AC-2 morale is wired into the production resolution path', () => {
  it('applies an authored ally-removed trigger once when a companion falls', () => {
    const combatants = makeDepthCombatants().map((combatant) => {
      if (combatant.combatantId === WARDEN_ID) {
        return { ...combatant, position: { x: 0, y: 2 } };
      }
      if (combatant.combatantId === GUARD_ID) {
        return { ...combatant, hp: 1, armorClass: 1 };
      }
      if (combatant.combatantId === PLAYER_ID) {
        return { ...combatant, team: 'ally' as const };
      }
      return combatant;
    });
    const created = createCombatState({
      ...createDepthInput({ combatants, moraleRules: BASE_MORALE_RULES }),
    });
    const state: CombatState = {
      ...created,
      initiative: { order: [WARDEN_ID, PLAYER_ID, GUARD_ID, HOUND_ID], activeIndex: 0 },
      turnId: `r1:${WARDEN_ID}`,
    };
    const defeated = resolve(state, {
      kind: 'useAbility',
      combatantId: WARDEN_ID,
      abilityId: 'basic_melee',
      targetIds: [GUARD_ID],
    });
    expect(defeated.valid).toBe(true);
    if (!defeated.valid) {
      return;
    }
    expect(defeated.state.combatants[GUARD_ID].defeated).toBe(true);
    expect(defeated.state.participation[PLAYER_ID].morale).toBe(50);
    expect(defeated.state.participation[PLAYER_ID].appliedTriggerIds).toContain(
      `ally_removed:${GUARD_ID}`,
    );

    const repeated = resolve(defeated.state, { kind: 'endTurn', combatantId: WARDEN_ID });
    expect(repeated.valid).toBe(true);
    if (!repeated.valid) {
      return;
    }
    expect(repeated.state.participation[PLAYER_ID].morale).toBe(50);
    expect(
      repeated.state.participation[PLAYER_ID].appliedTriggerIds.filter(
        (triggerId) => triggerId === `ally_removed:${GUARD_ID}`,
      ),
    ).toHaveLength(1);
  });
});
