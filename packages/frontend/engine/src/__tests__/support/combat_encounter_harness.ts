// packages/frontend/engine/src/__tests__/support/combat_encounter_harness.ts
//
// Shared v2 encounter harness for the review-repair regression suites.
//
// Drives the PRODUCTION dispatch entry point (`dispatchCombatCommand`) against a
// real bitECS world, so the routing, the command-admission boundary, the kernel
// commit, the ECS apply and the event mapping are all exercised together. No
// Worker is spun up — the main-thread forwarder has its own seam test.

import { BASIC_COMBAT_ABILITIES } from '@aikami/constants';
import type { EncounterDepth } from '../../combat/combat_encounter_depth.ts';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { dispatchCombatCommand } from '../../combat/combat_command_dispatch.ts';
import type {
  CombatEncounterParticipant,
  CombatEncounterRoster,
} from '../../combat/combat_encounter_start.ts';
import { startProductionEncounter } from '../../combat/combat_encounter_start.ts';
import { CombatIdentity, registerCombatIdentityObservers } from '../../components/combat_identity.ts';
import { CombatMovement, registerCombatMovementObservers } from '../../components/combat_movement.ts';
import { CombatStats, registerCombatStatsObservers } from '../../components/combat_stats.ts';
import { Companion, registerCompanionObservers } from '../../components/companion.ts';
import { Enemy, registerEnemyObservers } from '../../components/enemy.ts';
import { registerGridPositionObservers } from '../../components/grid_position.ts';
import { registerTurnOrderObservers, TurnOrder } from '../../components/turn_order.ts';
import { MockEngineBridge } from '../../engine_bridge.ts';
import { resetCollisionGrid, setTerrainGrid } from '../../systems/collision_system.ts';
import { TERRAIN_COST_SCALE } from '../../systems/terrain_grid.ts';
import { withLiveIdentity } from './combat_command_identity.ts';

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;
const TILE_SIZE = 32;

/** The authored encounter id every harness fixture uses. */
export const HARNESS_ENCOUNTER_ID = 'review-2-harness-encounter';
/** The player's authored combatant id. */
export const HARNESS_PLAYER_ID = 'player';
/** The enemy's authored combatant id. */
export const HARNESS_ENEMY_ID = 'emberwatch/harness_hound';

export type HarnessEvent = Record<string, unknown>;

export type CombatEncounterHarness = {
  world: World;
  bridge: MockEngineBridge;
  playerEid: number;
  enemyEid: number;
  accepted: Array<{ commandId: string; stateRevision: number; duplicate?: boolean }>;
  rejected: Array<{ reasonCode: string; detail?: string }>;
  /** Dispatch a bridge command with the live admission envelope merged in. */
  dispatch(command: { type: string } & Record<string, unknown>): void;
  /** Dispatch a bridge command EXACTLY as given — no envelope minted. */
  dispatchRaw(command: Parameters<typeof dispatchCombatCommand>[0]): void;
  /** Reset the module-level combat SoA slots this harness touches. */
  dispose(): void;
};

export const installHarnessTerrain = (): void => {
  const cellCount = MAP_WIDTH * MAP_HEIGHT;
  const cost = new Uint8Array(cellCount);
  const blocksSight = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index++) {
    cost[index] = TERRAIN_COST_SCALE;
  }
  setTerrainGrid({ width: MAP_WIDTH, height: MAP_HEIGHT, tileSize: TILE_SIZE, cost, blocksSight });
};

const playerParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: HARNESS_PLAYER_ID,
  team: 'player',
  cell,
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 10, initiative: 30 },
  classIds: ['wizard'],
});

const enemyParticipant = (cell: { x: number; y: number }): CombatEncounterParticipant => ({
  combatantId: HARNESS_ENEMY_ID,
  team: 'enemy',
  cell,
  npcId: 'harness_hound',
  stats: { hitPoints: 40, armorClass: 10, attackBonus: 2, initiative: 5 },
});

/** Builds a live v2 encounter at revision 0 with one player and one enemy. */
export const buildCombatEncounterHarness = (options?: {
  enemyCell?: { x: number; y: number };
  seed?: number;
  encounterId?: string;
  depth?: EncounterDepth;
}): CombatEncounterHarness => {
  const encounterId = options?.encounterId ?? HARNESS_ENCOUNTER_ID;
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  registerCombatIdentityObservers(world);
  registerGridPositionObservers(world);
  registerCombatMovementObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  installHarnessTerrain();

  const bridge = new MockEngineBridge();
  const playerEid = addEntity(world);
  addComponent(world, playerEid, CombatStats);
  addComponent(
    world,
    playerEid,
    set(CombatStats, {
      health: 40,
      maxHealth: 40,
      initiative: 30,
      attack: 5,
      defense: 0,
      accuracy: 10,
      evasion: 10,
    }),
  );
  addComponent(world, playerEid, TurnOrder);
  addComponent(
    world,
    playerEid,
    set(TurnOrder, { currentTurn: false, initiativeValue: 30, isActive: true }),
  );

  const roster: CombatEncounterRoster = {
    encounterId,
    seed: options?.seed ?? 4242,
    engine: 'v2',
    participants: [
      playerParticipant({ x: 1, y: 1 }),
      enemyParticipant(options?.enemyCell ?? { x: 2, y: 1 }),
    ],
    ...(options?.depth === undefined ? {} : { depth: options.depth }),
  };
  const started = startProductionEncounter({
    world,
    bridge,
    roster,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
    hooks: { runAiTurn: () => {}, emitStateUpdate: () => {} },
  });
  if (!started.ok) {
    throw new Error(`harness encounter failed to start: ${started.reasonCode}`);
  }

  const accepted: CombatEncounterHarness['accepted'] = [];
  const rejected: CombatEncounterHarness['rejected'] = [];
  bridge.on('COMBAT_COMMAND_ACCEPTED', (event) => {
    accepted.push({
      commandId: event.commandId,
      stateRevision: event.stateRevision,
      ...(event.duplicate === true ? { duplicate: true } : {}),
    });
  });
  bridge.on('COMBAT_COMMAND_REJECTED', (event) => {
    rejected.push({
      reasonCode: event.reasonCode,
      ...(event.detail === undefined ? {} : { detail: event.detail }),
    });
  });

  const context = {
    world,
    bridge,
    playerEntityId: playerEid,
    abilityCatalog: BASIC_COMBAT_ABILITIES,
  };

  return {
    world,
    bridge,
    playerEid,
    enemyEid: started.participantIds[1] ?? 0,
    accepted,
    rejected,
    dispatch: (command) => {
      dispatchCombatCommand(
        withLiveIdentity(
          { world, abilityCatalog: BASIC_COMBAT_ABILITIES },
          command,
        ) as Parameters<typeof dispatchCombatCommand>[0],
        context,
      );
    },
    dispatchRaw: (command) => {
      dispatchCombatCommand(command, context);
    },
    dispose: () => {
      resetCollisionGrid();
      for (let eid = 0; eid < 64; eid++) {
        Companion.recruited[eid] = false;
        Companion.npcId[eid] = '';
        Companion.approval[eid] = 0;
        Enemy.isActive[eid] = false;
        Enemy.spawnId[eid] = '';
        Enemy.encounterId[eid] = '';
        delete CombatMovement.movementPerTurn[eid];
        CombatIdentity.combatantId[eid] = '';
      }
    },
  };
};
