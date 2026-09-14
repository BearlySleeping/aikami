// packages/frontend/engine/src/__tests__/combat_environment_adapter.test.ts
//
// C-531 AC-1: authored environmental state survives the ECS projection /
// application round trip, and the kernel remains the only mechanical authority
// for it (the adapter re-derives nothing).
//
// Contract: C-531 AC-1, AC-2

import { describe, expect, it } from 'bun:test';
import type {
  CombatEnvironmentBundle,
  CombatState,
  EnvironmentalState,
} from '@aikami/types';
import { resolveCombatCommand as resolveCombat } from '@aikami/utils';
import { addComponent, addEntity, createWorld, type World } from 'bitecs';
import {
  applyCombatResult,
  getCombatIdentityRegistry,
  registerCombatantIdentity,
  resetCombatApplyGuard,
  snapshotCombatState,
} from '../combat/combat_state_adapter.ts';
import { toKernelCombatCommand } from '../combat/combat_v2_resolver.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../components/combat_identity.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Enemy } from '../components/enemy.ts';
import { GridPosition } from '../components/grid_position.ts';
import { TurnOrder } from '../components/turn_order.ts';

const ENCOUNTER_ID = 'emberwatch-env-1';
const RULES_VERSION = 'combat-2.0.0';
const PLAYER_ID = 'campaign:hero-1';
const BRAZIER = 'emberwatch/brazier-1';

const BATTLEFIELD = { width: 8, height: 8, blockedCells: [] };

const BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: 1,
  rulesVersion: 'combat-environment-1.0.0',
  objectDefinitions: {
    'emberwatch/brazier': {
      definitionId: 'emberwatch/brazier',
      name: 'Brazier',
      durability: 4,
      blocksMovement: false,
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
      check: { category: 'athletics', dc: 5, modifierSource: 'athletics' },
      successEffects: [{ kind: 'setObjectState', objectSelector: 'source', state: 'broken' }],
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
      position: { x: 1, y: 0 },
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

const spawn = (options: {
  world: World;
  combatantId: string;
  hp: number;
  initiative: number;
  x: number;
  y: number;
  isEnemy?: boolean;
}): number => {
  const eid = addEntity(options.world);
  addComponent(options.world, eid, CombatIdentity);
  addComponent(options.world, eid, CombatStats);
  addComponent(options.world, eid, GridPosition);
  addComponent(options.world, eid, TurnOrder);
  CombatStats.health[eid] = options.hp;
  CombatStats.maxHealth[eid] = options.hp;
  CombatStats.evasion[eid] = 12;
  CombatStats.accuracy[eid] = 3;
  CombatStats.initiative[eid] = options.initiative;
  GridPosition.x[eid] = options.x;
  GridPosition.y[eid] = options.y;
  TurnOrder.isActive[eid] = true;
  if (options.isEnemy === true) {
    Enemy.isActive[eid] = true;
  }
  registerCombatantIdentity({
    entityId: eid,
    encounterId: ENCOUNTER_ID,
    playerCombatantId: PLAYER_ID,
    playerEntityId: options.combatantId === PLAYER_ID ? eid : null,
    spawnIndex: 0,
  });
  CombatIdentity.combatantId[eid] = options.combatantId;
  return eid;
};

const snapshot = (world: World): CombatState =>
  snapshotCombatState(world, {
    encounterId: ENCOUNTER_ID,
    rulesVersion: RULES_VERSION,
    seed: 1337,
    abilityCatalog: {},
    battlefield: BATTLEFIELD,
    playerCombatantId: PLAYER_ID,
    playerEntityId: 1,
    environment: ENVIRONMENT,
    environmentBundle: BUNDLE,
    checkModifiersByCombatant: { [PLAYER_ID]: { athletics: 4 } },
  });

describe('C-531 environmental projection round trip', () => {
  it('projects the authored environment and pinned bundle into the snapshot', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    spawn({ world, combatantId: PLAYER_ID, hp: 20, initiative: 14, x: 2, y: 0 });
    spawn({ world, combatantId: 'emberwatch:goblin-1', hp: 12, initiative: 5, x: 7, y: 7, isEnemy: true });

    const state = snapshot(world);
    expect(state.environment).toEqual(ENVIRONMENT);
    expect(state.environmentBundle).toEqual(BUNDLE);
    expect(state.combatants[PLAYER_ID].checkModifiers).toEqual({ athletics: 4 });
  });

  it('keeps the committed object change authoritative across apply + re-projection', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    const playerEid = spawn({ world, combatantId: PLAYER_ID, hp: 20, initiative: 14, x: 2, y: 0 });
    spawn({ world, combatantId: 'emberwatch:goblin-1', hp: 12, initiative: 5, x: 7, y: 7, isEnemy: true });

    const state = snapshot(world);
    const registry = getCombatIdentityRegistry(world);
    registry.sync(world);
    expect(registry.toEntityId(PLAYER_ID)).toBe(playerEid);

    const result = resolveCombat({
      state,
      command: {
        kind: 'interactWithObject',
        combatantId: PLAYER_ID,
        objectId: BRAZIER,
        affordanceId: 'tip_over',
        targetObjectId: null,
      },
      basedOnRevision: state.stateRevision,
    });
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.state.environment.objects[BRAZIER].state).toBe('broken');

    applyCombatResult(world, state, result);
    resetCombatApplyGuard(world);

    // Re-projecting from the live world with the committed environment is
    // lossless: identity, durability and affordances are preserved, and no
    // object is duplicated.
    const reprojected = snapshotCombatState(world, {
      encounterId: ENCOUNTER_ID,
      rulesVersion: RULES_VERSION,
      seed: 1337,
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      playerCombatantId: PLAYER_ID,
      environment: result.state.environment,
      environmentBundle: result.state.environmentBundle,
      checkModifiersByCombatant: { [PLAYER_ID]: { athletics: 4 } },
    });
    expect(Object.keys(reprojected.environment.objects)).toEqual([BRAZIER]);
    expect(reprojected.environment.objects[BRAZIER].state).toBe('broken');
    expect(reprojected.environment.objects[BRAZIER].durability).toBe(0);
    expect(reprojected.environmentBundle).toEqual(BUNDLE);
  });

  it('rejects an environmental command for an unprojected check modifier', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    spawn({ world, combatantId: PLAYER_ID, hp: 20, initiative: 14, x: 2, y: 0 });
    spawn({ world, combatantId: 'emberwatch:goblin-1', hp: 12, initiative: 5, x: 7, y: 7, isEnemy: true });

    const state = snapshotCombatState(world, {
      encounterId: ENCOUNTER_ID,
      rulesVersion: RULES_VERSION,
      seed: 1337,
      abilityCatalog: {},
      battlefield: BATTLEFIELD,
      playerCombatantId: PLAYER_ID,
      environment: ENVIRONMENT,
      environmentBundle: BUNDLE,
    });
    const result = resolveCombat({
      state,
      command: {
        kind: 'interactWithObject',
        combatantId: PLAYER_ID,
        objectId: BRAZIER,
        affordanceId: 'tip_over',
        targetObjectId: null,
      },
    });
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.reasonCode).toBe('checkModifierUnavailable');
  });
});

describe('C-531 bridge command mapping', () => {
  it('maps a COMBAT_INTERACT bridge command onto the kernel environmental command', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    spawn({ world, combatantId: PLAYER_ID, hp: 20, initiative: 14, x: 2, y: 0 });
    const state = snapshot(world);
    const mapped = toKernelCombatCommand({
      state,
      combatantId: PLAYER_ID,
      command: { type: 'COMBAT_INTERACT', objectId: BRAZIER, affordanceId: 'tip_over' },
      abilityCatalog: {},
      basicAttackAbilityId: 'basic_melee',
    });
    expect(mapped).toEqual({
      kind: 'interactWithObject',
      combatantId: PLAYER_ID,
      objectId: BRAZIER,
      affordanceId: 'tip_over',
      targetObjectId: null,
    });
  });

  it('maps an explicit target object through unchanged', () => {
    const world = createWorld();
    registerCombatIdentityObservers(world);
    spawn({ world, combatantId: PLAYER_ID, hp: 20, initiative: 14, x: 2, y: 0 });
    const state = snapshot(world);
    const mapped = toKernelCombatCommand({
      state,
      combatantId: PLAYER_ID,
      command: {
        type: 'COMBAT_INTERACT',
        objectId: BRAZIER,
        affordanceId: 'tip_over',
        targetObjectId: 'emberwatch/oil-1',
      },
      abilityCatalog: {},
      basicAttackAbilityId: 'basic_melee',
    });
    expect(mapped).toMatchObject({ targetObjectId: 'emberwatch/oil-1' });
  });
});
