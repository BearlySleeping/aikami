// packages/shared/utils/src/lib/rules/__tests__/combat_environment_persistence.test.ts
//
// C-531 AC-7: environmental consequences survive the SAVE FORMAT and a replay.
//
// The save path persists a `CombatState` as JSON, so this suite exercises
// exactly that boundary:
//
//   1. a committed environmental state survives a JSON round trip byte-for-byte
//      (identity, position, durability, affordances, surfaces, hazard stamps,
//      RNG position and revision);
//   2. replaying the accepted inputs from the SERIALIZED initial state
//      reproduces the same state, the same events and the same future outcomes
//      without a model;
//   3. a pre-C-531 (v2) snapshot is migrated on load to empty environmental
//      state and then resolves the same command deterministically.
//
// Contract: C-531 AC-7

import { describe, expect, it } from 'bun:test';
import { CombatStateSchema, migrateCombatStateToCurrentVersion } from '@aikami/schemas';
import type { CombatEnvironmentBundle, CombatState, EnvironmentalState } from '@aikami/types';
import { Value } from 'typebox/value';
import { canonicalCombatJson } from '../combat_canonical_json';
import { COMBAT_RULES_VERSION, createCombatState, resolveCombatCommand } from '../combat_kernel';
import { replayCombat } from '../combat_replay';

const ENCOUNTER_ID = 'emberwatch/proof_encounter';
const PLAYER_ID = 'player-hero';
const BRAZIER = 'emberwatch/brazier-1';

const BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: 1,
  rulesVersion: 'combat-environment-1.0.0',
  objectDefinitions: {
    'emberwatch/brazier': {
      definitionId: 'emberwatch/brazier',
      name: 'Brazier',
      durability: 4,
      blocksMovement: true,
      blocksSight: false,
      cover: 'none',
      affordanceIds: ['tip_over'],
    },
  },
  affordances: {
    tip_over: {
      affordanceId: 'tip_over',
      name: 'Tip over',
      actionCost: 'action',
      requirements: [{ kind: 'adjacent', value: true }],
      check: { category: 'athletics', dc: 12, modifierSource: 'athletics' },
      successEffects: [
        {
          kind: 'createSurface',
          surfaceKind: 'fire',
          cellSelector: 'sourceFootprint',
          expiresAfterRound: null,
        },
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
      ],
      failureEffects: [],
    },
  },
  impactZones: {},
};

const ENVIRONMENT: EnvironmentalState = {
  objects: {
    [BRAZIER]: {
      objectId: BRAZIER,
      definitionId: 'emberwatch/brazier',
      position: { x: 1, y: 2 },
      footprint: [{ x: 0, y: 0 }],
      durability: 4,
      state: 'intact',
      ignited: false,
      cover: 'none',
      affordanceIds: ['tip_over'],
      attachedToObjectId: null,
    },
  },
  surfaces: [],
  hazardTickStamps: [],
};

const state = (): CombatState =>
  createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 20260914,
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Mara',
        team: 'player',
        position: { x: 2, y: 2 },
        hp: 20,
        maxHp: 20,
        armorClass: 12,
        attackBonus: 3,
        initiative: 10,
        abilityIds: [],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
        checkModifiers: { athletics: 3 },
      },
    ],
    abilityCatalog: {},
    battlefield: { width: 10, height: 10, blockedCells: [] },
    environment: ENVIRONMENT,
    environmentBundle: BUNDLE,
  });

const interactCommand = {
  kind: 'interactWithObject' as const,
  combatantId: PLAYER_ID,
  objectId: BRAZIER,
  affordanceId: 'tip_over',
  targetObjectId: null,
};

/** The save path's own boundary: a `CombatState` written as JSON and read back. */
const saveAndReload = (value: CombatState): CombatState => {
  const serialized = JSON.stringify(value);
  const parsed: unknown = JSON.parse(serialized);
  expect(Value.Check(CombatStateSchema, parsed)).toBe(true);
  if (!Value.Check(CombatStateSchema, parsed)) {
    throw new Error('a saved combat state must still satisfy the current schema');
  }
  return parsed;
};

describe('C-531 AC-7 environmental state survives the save format', () => {
  it('round-trips a committed environmental state byte-for-byte', () => {
    const initial = state();
    const committed = resolveCombatCommand({ state: initial, command: interactCommand });
    expect(committed.valid).toBe(true);
    if (!committed.valid) {
      return;
    }

    const reloaded = saveAndReload(committed.state);
    // Identity, position, durability, affordances, surfaces, hazard stamps, RNG
    // position and revision all survive — canonical JSON is the comparison so
    // key order cannot hide a difference.
    expect(canonicalCombatJson(reloaded)).toBe(canonicalCombatJson(committed.state));
    expect(reloaded.environment.objects[BRAZIER].objectId).toBe(BRAZIER);
    // Whatever the committed consequence was (the check may have failed), it is
    // the SAME after a save/reload — identity, durability and state included.
    expect(reloaded.environment.objects[BRAZIER]).toEqual(
      committed.state.environment.objects[BRAZIER],
    );
    expect(reloaded.environment.surfaces).toEqual(committed.state.environment.surfaces);
    expect(reloaded.environment.hazardTickStamps).toEqual(
      committed.state.environment.hazardTickStamps,
    );
    expect(reloaded.rng).toEqual(committed.state.rng);
    expect(reloaded.stateRevision).toBe(committed.state.stateRevision);
  });

  it('replays the accepted inputs from the SERIALIZED state without a model', () => {
    const initial = state();
    const first = resolveCombatCommand({ state: initial, command: interactCommand });
    expect(first.valid).toBe(true);
    if (!first.valid) {
      return;
    }

    // The recorded save: the opening state exactly as it would be persisted.
    const savedInitial = saveAndReload(initial);
    const replayed = replayCombat({
      initialState: savedInitial,
      rulesVersion: COMBAT_RULES_VERSION,
      commands: [interactCommand],
    });

    expect(replayed.finalState).not.toBeNull();
    expect(canonicalCombatJson(replayed.finalState)).toBe(canonicalCombatJson(first.state));
    expect(canonicalCombatJson(replayed.replay.events)).toBe(canonicalCombatJson(first.events));
    // The RNG position is part of the reproduced state, so the NEXT command is
    // also reproducible rather than merely the first.
    expect(replayed.finalState?.rng).toEqual(first.state.rng);
  });

  it('migrates a pre-C-531 snapshot on load and then resolves deterministically', () => {
    const current = state();
    const loaded = migrateCombatStateToCurrentVersion({
      ...structuredClone(current),
      schemaVersion: 2,
    });
    expect(Value.Check(CombatStateSchema, loaded)).toBe(true);
    if (!Value.Check(CombatStateSchema, loaded)) {
      return;
    }
    // Migration never infers destroyed/intact state from scenery.
    expect(loaded.environment).toEqual({ objects: {}, surfaces: [], hazardTickStamps: [] });

    // A migrated snapshot is a valid, playable state: an environmental command
    // against it is rejected for the honest reason (the object is unknown), and
    // the rejection mutates nothing.
    const before = structuredClone(loaded);
    const rejected = resolveCombatCommand({ state: loaded, command: interactCommand });
    expect(rejected.valid).toBe(false);
    if (rejected.valid) {
      return;
    }
    expect(rejected.reasonCode).toBe('objectUnknown');
    expect(canonicalCombatJson(loaded)).toBe(canonicalCombatJson(before));
  });

  it('rejects a save whose environmental references no longer resolve', () => {
    const corrupted = structuredClone(state());
    // A save written by an older pack can reference an object whose definition
    // no longer exists. That must be a typed rejection, never a silent skip.
    corrupted.environmentBundle = { ...BUNDLE, objectDefinitions: {} };
    const rejected = resolveCombatCommand({ state: corrupted, command: interactCommand });
    expect(rejected.valid).toBe(false);
    if (rejected.valid) {
      return;
    }
    expect(rejected.reasonCode).toBe('objectUnknown');
  });
});
