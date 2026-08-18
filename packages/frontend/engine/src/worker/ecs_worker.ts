// packages/frontend/engine/src/worker/ecs_worker.ts
/// <reference lib="webworker" />

import { PackConfigSchema } from '@aikami/schemas';
import type { PackConfig } from '@aikami/types';
import type { World } from 'bitecs';
import {
  addComponent,
  createWorld,
  getAllEntities,
  getComponent,
  query,
  removeEntity,
  set,
} from 'bitecs';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import {
  buildTerrainGridForMap,
  djb2Hash,
  type SpawnPointEntity,
  type TransitionZone,
} from '../assets/map_loader.ts';
import {
  Appearance,
  DEFAULT_BODY_LAYER_ID,
  getAppearanceLayers,
  type LpcLayerRecipe,
  registerAppearanceObservers,
} from '../components/appearance.ts';
import { CameraFocus, registerCameraFocusObservers } from '../components/camera_focus.ts';
import { CollisionData, registerCollisionDataObservers } from '../components/collision_data.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { registerCompanionObservers } from '../components/companion.ts';
import { registerEnemyObservers } from '../components/enemy.ts';
import {
  createEngineStateEntity,
  registerEngineStateObservers,
  SimulationState,
  setSimulationState,
} from '../components/engine_state.ts';
import { registerGoapAgentObservers } from '../components/goap_agent.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerInteractableObservers } from '../components/interactable.ts';
import {
  type InteractableStateMap,
  registerInteractableStateObservers,
} from '../components/interactable_state.ts';
import { registerInventoryObservers } from '../components/inventory.ts';
import { registerMapLocationObservers } from '../components/map_location.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { registerPathFollowObservers } from '../components/path_follow.ts';
import type { PositionData } from '../components/position.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerResistancesObservers } from '../components/resistances.ts';
import { registerSpatialLinkObservers } from '../components/spatial_link.ts';
import { registerSpawnPointObservers } from '../components/spawn_point.ts';
import { registerStatusEffectsObservers } from '../components/status_effects.ts';
import { registerTransitionObservers } from '../components/transition.ts';
import { registerTurnOrderObservers } from '../components/turn_order.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { registerVisionObserverObservers } from '../components/vision_observer.ts';
import { registerVisionVisibleObservers, VisionVisible } from '../components/vision_visible.ts';
import { registerVisualObservers, Visual } from '../components/visual.ts';
import { registerZoneStatusObservers } from '../components/zone_status.ts';
import { COMPONENT_STRIDE, FALLBACK_BUFFER_COUNT, MAX_ENTITIES } from '../config/memory_config.ts';
import { incrementEntityGeneration } from '../core/entity_reference.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { createNPC } from '../entities/create_npc.ts';
import { createPlayer, type PlayerCreateOptions } from '../entities/create_player.ts';
import { createDefaultSandboxAvatar } from '../entities/create_sandbox_avatar.ts';
import { SpatialHashGrid } from '../math/spatial_hash_grid.ts';
import {
  DEFAULT_LPC_SLOT_FALLBACKS,
  type LpcSlotCatalog,
  resolveLpcAppearance,
} from '../rendering/lpc_appearance_resolver.ts';
import {
  deserializeWorld,
  serializePlayer,
  serializeWorld,
} from '../serialization/ecs_serializer.ts';
import { getEngineGameMode, setEngineGameMode } from '../state/game_mode.ts';
import {
  endDialogueZoom,
  getActiveNpcScreenPosition,
  getCameraPosition,
  getCameraZoom,
  getScreenSize,
  resetCameraTracking,
  setMapBounds,
  setScreenSize,
  updateCameraSystem,
} from '../systems/camera_system.ts';
import {
  type CollisionGrid,
  getMapPixelBounds,
  insertIntoSpatialGrid,
  isBlocksSight,
  isCellBlocked,
  removeFromSpatialGrid,
  resetCollisionGrid,
  setTerrainGrid,
} from '../systems/collision_system.ts';
import {
  isCombatStageActive,
  setupCombatStage,
  teardownCombatStage,
  triggerPlayerAttackAnimation,
} from '../systems/combat_stage_system.ts';
import { updateContextSystem } from '../systems/context_system.ts';
import { updateDialogTriggers } from '../systems/dialog_trigger_system.ts';
import { updateEncounterSystem } from '../systems/encounter_system.ts';
import {
  spawnEntities,
  spawnSpawnPointEntities,
  spawnTransitionEntities,
} from '../systems/entity_spawner.ts';
import { setEnvironmentConfig, stepEnvironment } from '../systems/environment_system.ts';
import { enqueueMacro, updateExpressions } from '../systems/expression_system.ts';
import { updateGoapCombatTactics } from '../systems/goap_combat_tactics_system.ts';
import { updateGoapMovement } from '../systems/goap_movement_executor.ts';
import { updateGoapScheduler } from '../systems/goap_scheduler_system.ts';
import { syncGridPositions } from '../systems/grid_position_sync_system.ts';
import { updateInteractionProximity } from '../systems/interaction_proximity_system.ts';
import { handleInteract } from '../systems/interaction_system.ts';
import {
  dehydrateZone,
  hydrateZone,
  startMacroSimulation,
} from '../systems/macro_simulation_system.ts';
import {
  clampSpawnToWalkable,
  isPlayerSpawnBlocked,
  updateMovement,
} from '../systems/movement_system.ts';
import { updatePartyFollow } from '../systems/party_follow_system.ts';
import { updatePathFollow } from '../systems/path_follow_system.ts';
import { updatePressurePlates } from '../systems/pressure_plate_system.ts';
import {
  animateEntitySystem,
  LpcBatchManager,
  syncAppearanceSystem,
} from '../systems/render_worker.ts';
import { setVisionGrid, updateSpatialVision } from '../systems/spatial_vision_system.ts';
import { buildTerrainGridFromBoolean } from '../systems/terrain_grid.ts';
import {
  handleCombatAction,
  initCombat,
  resetTurnTracking,
} from '../systems/turn_manager_system.ts';
import { updateZoningSystem } from '../systems/zoning_system.ts';
import type { GameCommand, GameEvent, NPCSpawnData } from '../types.ts';

// ---------------------------------------------------------------------------
// Worker: owns the full bitECS world and system ticking
// ---------------------------------------------------------------------------

// Startup sentinel — confirms the worker module loaded and executed.
//
// NOTE: This runs AFTER all 56 static imports have resolved. If any
// import throws during module evaluation, we never reach this line.
// That's why ecs_worker_bootstrap.ts exists — it registers error
// handlers FIRST (zero imports), then dynamic-imports this module.
// See: packages/frontend/engine/src/worker/ecs_worker_bootstrap.ts
logger.info('worker', 'Module loaded, ready for INITIALIZE_ENGINE');

// ── Confirm full import graph evaluated successfully ──
// Distinct from ecs_worker_bootstrap.ts's DIAGNOSTIC_MODULE_LOADED
// (phase 1: bootstrap alive) — this signals phase 2: all 56 imports OK.
try {
  postMessage({ type: 'DIAGNOSTIC_WORKER_EVALUATED', timestamp: Date.now() });
} catch {
  // silent
}

// ── Error handlers — registered after imports, so they only catch
// runtime errors (tick loop crashes, message handler errors, etc.).
// Module-level import errors are caught by ecs_worker_bootstrap.ts. ──
self.addEventListener('error', (event: ErrorEvent): void => {
  logger.error('worker:addEventListener-error', {
    message: event.message || String(event),
    filename: event.filename || '(unknown)',
    lineno: event.lineno,
    colno: event.colno,
    errorMessage:
      event.error instanceof Error ? event.error.message : String(event.error ?? 'no error obj'),
    errorStack: event.error instanceof Error ? event.error.stack : undefined,
    errorConstructor: event.error?.constructor?.name ?? 'none',
  });
  // Post ENGINE_ERROR so the main thread gets details
  try {
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker error: ${event.message || String(event)} @ ${event.filename}:${event.lineno}`,
    });
  } catch {
    // postMessage might fail too — nothing we can do
  }
});

// Also set onerror as a backup
self.onerror = (message, source, lineno, colno, error): boolean => {
  logger.error('worker:onerror', {
    message: String(message),
    source: String(source),
    lineno,
    colno,
    errorMessage: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    errorConstructor: error?.constructor?.name,
  });
  return false;
};

// ── Monkey-patch postMessage to catch serialization errors ──
const _originalPostMessage = self.postMessage.bind(self);
self.postMessage = ((message: unknown, transfer?: Transferable[]) => {
  try {
    _originalPostMessage(message, { transfer });
  } catch (err) {
    logger.error('worker:postMessage-error', {
      type: (message as Record<string, unknown>)?.type,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorConstructor: (err as Error)?.constructor?.name,
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}) as typeof self.postMessage;

// ── Catch unhandled rejections ──
self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  const reason = event.reason;
  logger.error('worker:unhandled-rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
};

// -- Worker-global state ----------------------------------------------------

/** The bitECS world — created once per INITIALIZE_ENGINE. */
let world: World | undefined;

/**
 * The resolved content-pack config for the current map (C-376 AC-2).
 *
 * Validated once on LOAD_MAP, then read by the spawner (`_spawnProp`) for
 * prop walkability/collision. Replaced on every LOAD_MAP — repeated loads
 * replace the previous config; there is no cross-map leak. `undefined`
 * (manifest resolution failed or malformed payload) degrades gracefully:
 * all props stay solid.
 */
let _packConfig: PackConfig | undefined;

/** The player entity ID, set during initialization. */
let playerEntityId = 0;

/** Last transition zones from LOAD_MAP — re-spawned after LOAD_GAME. */
let _lastTransitionZones: TransitionZone[] | undefined;

/** Whether the tick loop is currently running. */
let running = false;

/** Spatial hash grid for O(1) proximity queries. */
let spatialGrid: SpatialHashGrid | undefined;

/** Entity ID of the currently active zone (C-194). */
let _activeZoneEntityId = 0;

/** Timestamp of the last macro simulation tick (C-196 time-gate). */
let _lastMacroTickMs = 0;

/** Pre-allocated position buffer for grid population. */
let positionBuffer: Float32Array | undefined;

/**
 * Headless LPC batch manager for slot tracking and fingerprint evaluation.
 *
 * Operates without GPU Buffers (no `createBuffer` factory) so it runs
 * safely inside the Web Worker. Slot allocation, deregistration, and
 * structural fingerprint comparison happen here; the main thread
 * handles GPU uploads via a separate producer path.
 */
let lpcBatchManager: LpcBatchManager | undefined;

/** Cached query terms for context-bearing entities. */
const CONTEXT_QUERY_TERMS = [Position, NPCDialog];

// -- Buffer management ------------------------------------------------------

/** The pool of ArrayBuffers for the N-buffer transfer cycle. */
const bufferPool: ArrayBuffer[] = [];

/** The Float32Array view wrapping the currently active write buffer. */
let activeWriteView: Float32Array | undefined;

/** The pool index of the currently active write buffer. */
let activeBufferIndex = 0;

// -- Event proxy ------------------------------------------------------------

/** Events collected during the current tick, flushed on STATE_UPDATE. */
let pendingEvents: GameEvent[] = [];

/**
 * Worker-side proxy implementing the subset of EngineBridge needed by
 * game systems (movement, context, dialog triggers).
 *
 * Events queued via emit() are collected and sent via postMessage on the
 * next STATE_UPDATE. Other bridge methods are no-ops — the worker does
 * not send commands to the UI or listen for UI events.
 *
 * This object is NOT a full EngineBridge — it only satisfies the
 * structural requirements of the systems that receive it as a parameter.
 * Systems only call emit() on the bridge, so this proxy is sufficient.
 */
const workerBridge: EngineBridge = {
  emit(event: GameEvent): void {
    pendingEvents.push(event);
  },
  send(_command: GameCommand): void {
    // No-op: worker does not send commands to the UI
  },
  on<T extends GameEvent['type']>(
    _eventType: T,
    _handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    // No-op: worker does not listen for UI events
    return (): void => {};
  },
  isReady(): boolean {
    return running;
  },
  executeCommand(_cmd: string, _args: string[]): void {
    // No-op: commands are handled by the main thread
  },
  triggerMacro(_macro: string, _args: string[], _entityId?: number): void {
    // No-op: macros are handled by the main thread
  },
  async createSnapshot(): Promise<string> {
    throw new Error('createSnapshot is only available on the main-thread bridge');
  },
  async restoreSnapshot(_snapshot: string): Promise<void> {
    throw new Error('restoreSnapshot is only available on the main-thread bridge');
  },
};

// -- Command handling -------------------------------------------------------

/**
 * Applies a SET_ENTITY_VELOCITY command to a specific entity by its ECS entity ID.
 *
 * Sets the Velocity component on the entity so the movement_system processes
 * it on the next tick. The entity must have a Position component (checked).
 *
 * Contract: C-212 Party Follow System
 */
const handleSetEntityVelocity = (entityId: number, velocity: { x: number; y: number }): void => {
  if (!world || entityId === undefined) {
    return;
  }

  // Gate: only apply velocity in EXPLORE mode
  if (getEngineGameMode() !== 'EXPLORE') {
    return;
  }

  // Check the entity exists (has Position component)
  const positionStore = getComponent(world, entityId, Position);
  if (!positionStore) {
    return;
  }

  addComponent(world, entityId, set(Velocity, velocity));
};

/**
 * Applies a SET_PLAYER_VELOCITY command to the player entity's velocity.
 *
 * Gates on the current engine game mode — velocity is ignored when the
 * mode is not EXPLORE (e.g., during DIALOGUE or MENU overlays).
 */
const handleSetPlayerVelocity = (velocity: { x: number; y: number }): void => {
  if (!world) {
    return;
  }

  // Always apply velocity — the movement system (updateMovement) gates on
  // game mode separately. If we gate here, {0,0} stop commands sent while
  // in MENU/DIALOGUE are silently dropped, causing sticky movement when
  // returning to EXPLORE.
  addComponent(world, playerEntityId, set(Velocity, velocity));
};

/**
 * Handles a SPAWN_NPC command from the main thread.
 */
const handleSpawnNPC = (npcData: NPCSpawnData): void => {
  if (!world) {
    return;
  }

  const eid = createNPC(world, npcData);

  // Notify main thread with full NPC metadata for interaction tracking
  postMessage({
    type: 'ENTITY_CREATED',
    eid,
    tint: 0xffcc00, // gold tint for NPCs
    npcData: {
      npcId: npcData.npcId,
      npcName: npcData.npcName,
      personaId: npcData.personaId || 'default',
      interactionRadius: npcData.interactionRadius,
      relationshipValue: npcData.relationshipValue || 0,
      dialog: npcData.dialog || '',
    },
  });
};

/**
 * Dispatches an incoming GameCommand from the main thread.
 */
const handleBridgeCommand = (command: GameCommand): void => {
  // ── Track last processed input sequence for ACK ──
  const cmdWithSeq = command as GameCommand & { _seq?: number };
  if (typeof cmdWithSeq._seq === 'number') {
    _lastProcessedInputSequence = cmdWithSeq._seq;
  }

  switch (command.type) {
    case 'SET_PLAYER_VELOCITY': {
      handleSetPlayerVelocity(command.velocity);
      break;
    }
    case 'SET_ENTITY_VELOCITY': {
      handleSetEntityVelocity(command.entityId, command.velocity);
      break;
    }
    case 'SPAWN_NPC': {
      handleSpawnNPC(command.npcData);
      break;
    }
    case 'SET_GAME_MODE': {
      const previousMode = getEngineGameMode();
      setEngineGameMode(command.mode);

      // End cinematic dialogue zoom when transitioning away from DIALOGUE.
      // Covers both the "End Chat" button and proximity-leave flows.
      // Contract: C-161 Spatial UI Camera
      if (previousMode === 'DIALOGUE' && command.mode !== 'DIALOGUE') {
        endDialogueZoom();
      }
      break;
    }
    case 'INTERACT': {
      if (world) {
        handleInteract({ world, playerEntityId, bridge: workerBridge });
      }
      break;
    }
    case 'OPEN_MENU':
    case 'CLOSE_MENU':
    case 'LOAD_SCENE':
    case 'EXECUTE_COMMAND': {
      // These commands are not processed by the worker in the current MVP.
      break;
    }
    case 'PAUSE_ENGINE': {
      // ── C-332: Main thread requests worker tick loop pause ──
      // Clears the interval so no orphaned timer fires after unpause
      // with a stale lastTickTime. Also clears player velocity.
      logger.debug('[WorkerEngine] pauseEngine:requested');
      if (world && playerEntityId > 0) {
        addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));
      }
      stopTickLoop();
      break;
    }
    case 'UNPAUSE_ENGINE': {
      // ── C-332: Main thread requests worker tick loop resume ──
      // startTickLoop resets lastTickTime to performance.now() BEFORE
      // creating the interval, so the first frame after unpause has
      // delta ≈ 0ms instead of the entire pause duration.
      logger.debug('[WorkerEngine] unpauseEngine:requested');
      if (world && playerEntityId > 0) {
        addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));
      }
      startTickLoop();
      break;
    }
    case 'TRIGGER_MACRO': {
      enqueueMacro({
        name: command.macro,
        args: command.args,
        entityId: command.entityId ?? 0,
      });
      break;
    }
    case 'COMBAT_ACTION': {
      if (world) {
        handleCombatAction({
          world,
          playerEntityId,
          action: command.action,
          targetId: command.targetId,
          bridge: workerBridge,
          advantage: command.advantage,
          bonusDamage: command.bonusDamage,
        });
      }
      break;
    }
    case 'COMBAT_ACTION_ANIMATE': {
      // ── Trigger player attack animation during AI resolution (C-166) ──
      if (world) {
        triggerPlayerAttackAnimation(world);
      }
      break;
    }
    case 'RETRY_ENCOUNTER': {
      // ── Retry encounter with preserved seed (C-330 AC-5) ──
      // Resets turn tracking, reinitializes combat, and emits COMBAT_STARTED.
      // The bridge listener picks up COMBAT_STARTED and calls combatService.startCombat.
      if (world) {
        resetTurnTracking();
        initCombat(world, workerBridge, command.combatSeed);
      }
      break;
    }
    case 'UPDATE_PLAYER_APPEARANCE': {
      // ── Equipment → appearance refresh nudge (C-374) ──
      // Equipment no longer mutates the worker's base Appearance layers —
      // the main thread merges equipment recipes (item → LPC asset) on top
      // of the base recipe via the equipmentRecipeProvider option. This
      // handler simply re-emits APPEARANCE_CHANGED so the main thread
      // re-resolves and re-renders the player sprite with current gear.
      if (world && playerEntityId > 0) {
        _refreshPlayerAppearance(playerEntityId);
      }
      break;
    }
    case 'HEAL_PLAYER': {
      // ── Out-of-combat consumable heal (C-331 AC-4) ──
      // Clamps player HP at max and mirrors the change to the UI via
      // COMBAT_STATE_UPDATE (the existing player-stats bridge path).
      if (playerEntityId > 0) {
        const amount = Math.max(0, Math.floor((command as { amount: number }).amount ?? 0));
        const currentHp = CombatStats.health[playerEntityId] ?? 0;
        const maxHp = CombatStats.maxHealth[playerEntityId] ?? currentHp;
        const newHp = Math.min(maxHp, currentHp + amount);
        CombatStats.health[playerEntityId] = newHp;
        workerBridge.emit({
          type: 'COMBAT_STATE_UPDATE',
          entityHpMap: { [playerEntityId]: newHp },
          entityMaxHpMap: { [playerEntityId]: maxHp },
        });
      }
      break;
    }
    case 'SET_ENVIRONMENT_CONFIG': {
      // ── Dev sandbox: configure environment time/weather (C-213) ──
      setEnvironmentConfig({
        timeScale: (command as { timeScale?: number }).timeScale,
        windVelocity: (command as { windVelocity?: number }).windVelocity,
        rainIntensity: (command as { rainIntensity?: number }).rainIntensity,
        startHour: (command as { startHour?: number }).startHour,
      });
      break;
    }
    default: {
      break;
    }
  }
};

// -- Worker-side recipe resolver --------------------------------------------

/**
 * Re-emits APPEARANCE_CHANGED for the player entity with the current base
 * layers so the main thread re-resolves recipes and merges equipment.
 *
 * The base Appearance layers are untouched — equipment is resolved on the
 * main thread (item → LPC asset) via the `equipmentRecipeProvider` option.
 *
 * Contract: C-374 Equipment, Armour & Weapon Inventory UI
 */
const _refreshPlayerAppearance = (eid: number): void => {
  const currentLayers = getAppearanceLayers(eid);

  // C-370: enforce body layer invariant — if layer0 is non-positive or
  // undefined, inject the default body variant so the paperdoll always has
  // a base (the body fallback also applies in workerRecipeResolver, but
  // keeping the invariant here makes the emitted payload consistent).
  const layers = [...currentLayers];
  if ((layers[0] ?? 0) <= 0) {
    layers[0] = DEFAULT_BODY_LAYER_ID;
  }

  workerBridge.emit({
    type: 'APPEARANCE_CHANGED',
    eid,
    layerIds: layers as number[],
  });
};

/**
 * LPC slot catalog injected from the main thread (C-400) so the worker
 * resolves layer indices to real asset IDs — identical to the main-thread
 * resolver. Set once from INITIALIZE_ENGINE.
 */
let _workerLpcCatalog: readonly LpcSlotCatalog[] | undefined;

/**
 * Converts entity layer IDs to {@link LpcLayerRecipe} arrays using
 * empty palettes (zero-filled 1024-byte LUTs).
 *
 * The structural fingerprint computed by {@link recipeStructuralFingerprint}
 * only compares slot names and asset IDs — palette data is ignored.
 * This means fingerprint evaluation in the worker matches the main
 * thread even without access to the actual palette textures.
 *
 * **C-400**: Delegates to the shared {@link resolveLpcAppearance} resolver
 * with the injected catalog + fallback table, so the worker emits the same
 * slot/assetId sequences as the main-thread resolver. The hard-coded head
 * override and the numeric-string asset IDs are gone. If the catalog was
 * not injected (legacy callers), falls back to the declared per-slot
 * fallbacks via the shared resolver with an empty catalog.
 *
 * @param layerIds - Array of 6 layer asset IDs from the Appearance component.
 * @returns Layer recipes with empty palettes for structural tracking.
 */
const workerRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const result = resolveLpcAppearance({
    layerIds,
    catalog: _workerLpcCatalog ?? [],
    fallbacks: DEFAULT_LPC_SLOT_FALLBACKS,
  });
  // Shallow mutable copy — recipes are freshly built per call and the
  // elements are never shared, so spreading is safe and avoids re-mapping.
  return [...result.recipes];
};

// -- Initialization ---------------------------------------------------------

/**
 * Initializes the bitECS world and all its contents inside the worker.
 *
 * Called once when the main thread posts INITIALIZE_ENGINE.
 *
 * @param canvasWidth - Canvas width (unused when loadPayload is provided).
 * @param canvasHeight - Canvas height (unused when loadPayload is provided).
 * @param loadPayload - Optional ECS snapshot payload to hydrate (skips default entities).
 */
const initializeEngine = (
  canvasWidth: number,
  canvasHeight: number,
  loadPayload?: string,
  playerData?: PlayerCreateOptions,
  collisionGrid?: CollisionGrid,
): void => {
  // 1. Create the bitECS world FIRST — wall-entity creation from the
  //    collision grid (C-376 AC-3) needs a live world + registered
  //    observers, so the grid is populated after observer registration.
  world = createWorld();

  // 2. Register component observers (before grid population so wall
  //    entities written via set() land in the SoA arrays).
  registerPositionObservers(world);
  registerVelocityObservers(world);
  registerVisualObservers(world);
  registerNPCDialogObservers(world);
  registerAppearanceObservers(world);
  registerCombatStatsObservers(world);
  registerEnemyObservers(world);
  registerCompanionObservers(world);
  registerResistancesObservers(world);
  registerStatusEffectsObservers(world);
  registerInventoryObservers(world);
  registerInteractableObservers(world);
  registerInteractableStateObservers(world);
  registerTurnOrderObservers(world);
  registerCameraFocusObservers(world);
  registerTransitionObservers(world);
  registerEngineStateObservers(world);
  registerSpawnPointObservers(world);
  registerCollisionDataObservers(world);
  registerGridPositionObservers(world);
  registerSpatialLinkObservers(world);
  registerGoapAgentObservers(world);
  registerVisionObserverObservers(world);
  registerVisionVisibleObservers(world);
  registerPathFollowObservers(world);
  registerMapLocationObservers(world);
  registerZoneStatusObservers(world);

  // 3. Set the terrain grid before any entities or systems start.
  //    C-379 AC-4: the authoritative TerrainGrid replaces the boolean grid
  //    + wall entities. The vision grid is fed from blocksSight (AC-2).
  if (collisionGrid) {
    setTerrainGrid(buildTerrainGridFromBoolean(collisionGrid), world);

    const visionWallCheck = (gx: number, gy: number): boolean => isBlocksSight(gx, gy);
    setVisionGrid(visionWallCheck, collisionGrid.width, collisionGrid.height);
  }

  // 4. Initialize camera bounds from provided canvas dims + collision grid
  setScreenSize({ width: canvasWidth, height: canvasHeight });
  if (collisionGrid) {
    setMapBounds({
      width: collisionGrid.width * collisionGrid.tileSize,
      height: collisionGrid.height * collisionGrid.tileSize,
    });
  }

  // 4b. Create the EngineState singleton entity (C-172)
  createEngineStateEntity(world);

  // 5. Create headless LpcBatchManager for slot tracking + fingerprint eval
  //    No createBuffer factory → operates without GPU Buffers in the worker.
  lpcBatchManager = new LpcBatchManager({ maxInstances: 64 });

  // 6. Start the tick loop (~60fps = 16ms interval)
  startTickLoop();

  // 6a. Start the macro simulation tick loop (C-194)
  //     Runs at 500ms interval for offline agent stepping.
  startMacroSimulation();

  // 7. Initialize spatial hash grid (cellSize 50, capacity = MAX_ENTITIES * 2)
  spatialGrid = new SpatialHashGrid({
    cellSize: 50,
    capacity: MAX_ENTITIES * 2,
  });
  positionBuffer = new Float32Array(MAX_ENTITIES * 2);

  // 8. Spawn entities — from saved payload or defaults
  if (loadPayload) {
    const eidMap = deserializeWorld(world, loadPayload);

    // Notify main thread about all hydrated entities
    for (const [oldEid, newEid] of eidMap) {
      const tint = oldEid === 1 ? 0x00ff88 : 0xffcc00;
      // bitECS allocates sequential IDs — first entity is always the player
      if (playerEntityId === 0) {
        playerEntityId = newEid;
      }
      // Include Visual.frame for prop entities so they load the real texture
      const frame = Visual.frame[newEid] ? (Visual.frame[newEid] as string) : undefined;
      postMessage({
        type: 'ENTITY_CREATED',
        eid: newEid,
        tint,
        ...(frame ? { frame } : {}),
      });
    }
  } else {
    playerEntityId = createPlayer(world, playerData);

    // ── C-198: Override player Appearance with full 6-layer sandbox recipe ──
    // createPlayer sets [1, 1, 1, 1, 1, 95] — replace with body, hair,
    // torso, legs, feet, head so all layers render without gaps.
    createDefaultSandboxAvatar(world, playerEntityId);

    // Player (green tint)
    postMessage({
      type: 'ENTITY_CREATED',
      eid: playerEntityId,
      tint: 0x00ff88,
    });
  }

  queueMicrotask(() => {
    postMessage({
      type: 'ENGINE_READY',
    });
  });

  // C-329: Hardcoded dummy quests removed — quest state is now owned by
  // QuestStateService in the frontend and emitted via QUESTS_UPDATED from
  // the service layer, not the ECS worker.

  // Diagnostic: verify worker event loop survives init
  setTimeout(() => {
    logger.info('worker', 'init-setTimeout-fired — event loop alive');
    try {
      postMessage({ type: 'DIAGNOSTIC_PING' });
    } catch (err) {
      logger.error('worker:diag-ping-failed', err);
    }
  }, 100);
};

// -- Tick loop --------------------------------------------------------------

/** Timestamp of the previous tick for computing delta time. */
let lastTickTime = performance.now();

/**
 * Monotonic tick counter — incremented each time tickLoop completes
 * a full simulation frame. Used by the main-thread heartbeat to detect
 * simulation stalls (distinct from message-handler liveness).
 */
let tickCount = 0;

/**
 * Last input sequence number processed in handleBridgeCommand.
 * Echoed back in STATE_UPDATE so the main thread can measure input lag.
 */
let _lastProcessedInputSequence = 0;

/**
 * Handle for the active tick timer.
 *
 * Uses setTimeout + manual reschedule (not setInterval) so that
 * stopTickLoop/startTickLoop calls are safe even when a tick is
 * in-flight. The finally block checks _running and reschedules
 * automatically.
 */
let _tickTimerHandle: ReturnType<typeof setTimeout> | undefined;

/**
 * Single-instance guard — true while tickLoop() is executing.
 *
 * In single-threaded JS a timer callback cannot preempt a running
 * callback, but if any async boundary is ever introduced into the
 * tick pipeline this prevents concurrent world mutation.
 */
let isTicking = false;

/** Macro simulation tick interval in milliseconds (C-196). */
const MACRO_TICK_INTERVAL_MS = 500;

/**
 * Hard cap for frame delta time in milliseconds (100ms = 10fps floor).
 *
 * During tab backgrounding, WASM auto-saves, or heavy GC pauses the
 * browser timer may deliver a single callback with a massive delta.
 * Without clamping, velocity × delta propels entities off the map into
 * NaN/Infinity territory. 100ms is the smallest value that still allows
 * a visible frame-rate drop without causing physics tunneling.
 */
const MAX_FRAME_DELTA_MS = 100;

/**
 * Schedules the next tick via setTimeout.
 *
 * Only called when _running is true and no timer is pending.
 */
const _scheduleNextTick = (): void => {
  if (_tickTimerHandle !== undefined || !running) {
    return;
  }
  _tickTimerHandle = setTimeout(tickLoop, 16);
};

/**
 * Starts the tick loop.
 *
 * Sets _running = true so that the currently-in-flight tick (if any)
 * will reschedule itself in its finally block, or schedules the first
 * tick via setTimeout if nothing is executing.
 *
 * Safe to call while tickLoop() is executing — the finally block
 * will pick up the _running flag and auto-reschedule.
 */
const startTickLoop = (): void => {
  lastTickTime = performance.now();
  running = true;

  // If a tick is already executing, its finally block will auto-reschedule.
  if (isTicking) {
    return;
  }

  // Always clear any stale timer and schedule fresh.
  // Guard removed — if for any reason running was already true
  // but no timer is pending (zombie state from a race), this fixes it.
  if (_tickTimerHandle !== undefined) {
    clearTimeout(_tickTimerHandle);
    _tickTimerHandle = undefined;
  }
  _scheduleNextTick();
};

/**
 * Stops the tick loop.
 *
 * Sets _running = false so the currently-in-flight tick (if any) will
 * NOT reschedule itself. Clears any pending timer.
 */
const stopTickLoop = (): void => {
  running = false;
  if (_tickTimerHandle !== undefined) {
    clearTimeout(_tickTimerHandle);
    _tickTimerHandle = undefined;
  }
  logger.debug('[WorkerEngine] stopTickLoop:stopped');
};

/**
 * Runs one simulation frame following the Emergent World 6-step pipeline:
 *
 *   1. Ingestion  — process streaming payloads from tool orchestrator
 *   2. Macro Sim  — time-gated coarse simulation for inactive zones
 *   3. Perception — spatial hash visibility sweeps (vision cones/FOV)
 *   4. Cognition  — GOAP bitmask evaluations + crime event reactions
 *   5. Navigation — time-sliced JPS pathfinding under budget ceiling
 *   6. Resolution — movement + bitmask collision + kinematic settlement
 *
 * Post-resolution: camera, encounters, combat stage, dialog triggers,
 * zoning, context sniffing, animation, LPC sync, and state serialization.
 *
 * Contract: C-196 Emergent World Integration
 */
const tickLoop = (): void => {
  // If already ticking, return early — the in-flight tick's finally block
  // will handle clearing the handle and rescheduling.
  if (isTicking) {
    return;
  }

  // If other conditions prevent execution, clear the stale handle and
  // attempt self-healing reschedule (unless intentionally stopped).
  if (!world || !running || !activeWriteView) {
    if (_tickTimerHandle !== undefined) {
      clearTimeout(_tickTimerHandle);
      _tickTimerHandle = undefined;
    }
    // If still running (transient condition), reschedule to self-heal.
    // If stopped (!running), let the loop die as intended.
    if (running && world) {
      _scheduleNextTick();
    }
    return;
  }

  isTicking = true;

  try {
    // Compute delta time with hard clamp (C-332 — prevents dt explosion)
    const now = performance.now();
    const rawDeltaMs = now - lastTickTime;
    lastTickTime = now;

    // ── HARD CLAMP: never allow delta > 100ms ──
    // Protects against tab backgrounding, WASM save spikes, and GC pauses.
    // Minimum floor of 0.001ms prevents division-by-zero in derived rates.
    const deltaMs = Math.max(0.001, Math.min(rawDeltaMs, MAX_FRAME_DELTA_MS));

    // ── Environment: time-of-day, diurnal colours, weather ──
    // Contract C-213: Step environment before all other systems so
    // diurnal and weather UBO data is fresh for this frame.
    const environment = stepEnvironment({ deltaMs });

    // ────────────────────────────────────────────────────────────────────────
    // Step 1: Ingestion — process streaming payloads from tool orchestrator
    //
    // Drains the macro queue (expression changes, state mask updates) that
    // arrived via the bridge since the last tick. These must be applied
    // BEFORE perception so new expression states are visible this frame.
    // ────────────────────────────────────────────────────────────────────────
    updateExpressions(world, workerBridge);

    // ────────────────────────────────────────────────────────────────────────
    // Step 2: Macro Sim — time-gated coarse simulation for inactive zones
    //
    // Macro simulation runs independently on a 500ms setInterval (C-194).
    // This gate tracks the last macro tick for the pipeline sequence — the
    // actual macro stepping is handled by the interval timer to avoid
    // per-frame overhead (C-196 Watch Point: Step Multiplier Overlaps).
    // ────────────────────────────────────────────────────────────────────────
    if (now - _lastMacroTickMs >= MACRO_TICK_INTERVAL_MS) {
      _lastMacroTickMs = now;
      // Macro simulation ticks independently via startMacroSimulation() —
      // no per-frame call needed. The time-gate solely tracks alignment.
    }

    // ────────────────────────────────────────────────────────────────────────
    // Step 3: Perception — spatial hash visibility sweeps
    //
    // For each VisionObserver entity, casts DDA ray cones (idle/patrol)
    // or recursive shadowcasting (suspicious/alert) and writes visibility
    // bitmasks into VisionVisible.visibleByMask on target entities.
    // ────────────────────────────────────────────────────────────────────────
    updateSpatialVision(world);

    // ────────────────────────────────────────────────────────────────────────
    // Step 4: Cognition — GOAP bitmask evaluations + crime event reactions
    //
    // For each GoapAgent, validates/selects/applies actions toward goals
    // via bitwise precondition/effect evaluation. Processes CrimeEvent
    // entities for emergent reactions: witnesses go hostile, cache
    // perpetrator targets, and drop stale behavioral loops.
    //
    // C-197: Also runs tactical combat evaluations for enemy combatants —
    // scores targets and selects optimal tactical actions.
    // ────────────────────────────────────────────────────────────────────────
    updateGoapScheduler(world);
    updateGoapCombatTactics(world, playerEntityId);

    // ── C-379 AC-7: party-follow goal provider (Navigation slot) ──
    updatePartyFollow(world, playerEntityId);

    // ────────────────────────────────────────────────────────────────────────
    // Step 5: Navigation — path-follow locomotion
    //
    // GOAP movement executor requests paths (goal cell → A* waypoints);
    // the path-follow system writes Velocity toward the current waypoint.
    // Runs BEFORE updateMovement in Resolution so the velocity it writes
    // is resolved the same frame (C-379 AC-7 watch point).
    // ────────────────────────────────────────────────────────────────────────
    updateGoapMovement(world);
    // C-402: pass the player entity so the halt rule can stop NPCs at
    // their interaction radius (deadlock-class removal).
    updatePathFollow(world, deltaMs, playerEntityId);

    // ────────────────────────────────────────────────────────────────────────
    // Step 6: Resolution — movement + collision
    //
    // Axis-independent continuous movement with per-entity masks and the
    // terrain cost grid.
    // ────────────────────────────────────────────────────────────────────────
    updateMovement(world, deltaMs);

    // ── C-379 AC-1: GridPosition sync — derived from Position, change-gated.
    // Runs after movement so perception/cognition consumers on the NEXT
    // frame read the resolved cell. Occupancy updates happen only on cell
    // change. ──
    syncGridPositions(world);

    // ────────────────────────────────────────────────────────────────────────
    // Post-resolution systems (do not mutate core state)
    // ────────────────────────────────────────────────────────────────────────

    // Camera: track CameraFocus entity, lerp toward target
    updateCameraSystem(world, deltaMs);

    // Encounters: check proximity-based combat triggers
    updateEncounterSystem({ world, playerEntityId, bridge: workerBridge });

    // ── Combat stage setup / teardown (C-166) ──
    const screen = getScreenSize();
    if (getEngineGameMode() === 'COMBAT' && !isCombatStageActive()) {
      setupCombatStage(world, { screenWidth: screen.width, screenHeight: screen.height });
    } else if (getEngineGameMode() !== 'COMBAT' && isCombatStageActive()) {
      teardownCombatStage(world);
    }

    // Dialog triggers: proximity-based NPC dialogue activation
    updateDialogTriggers(world, playerEntityId, workerBridge);

    // Zoning: portal trigger overlap detection
    updateZoningSystem(world, playerEntityId, workerBridge);

    // Context: populate spatial hash grid for proximity queries
    if (spatialGrid && positionBuffer) {
      populateSpatialGrid(world, spatialGrid, positionBuffer);
    }
    if (spatialGrid) {
      updateContextSystem({
        world,
        playerEntityId,
        bridge: workerBridge,
        spatialGrid,
      });
    }

    // ── C-327 AC-2: Interaction proximity ──
    // Evaluates the nearest interactable and emits INTERACTION_TARGET_CHANGED
    // only when the target changes (dirty-checked).
    updateInteractionProximity({
      world,
      playerEntityId,
      bridge: workerBridge,
    });

    // ── C-342 AC-3: Pressure plate per-tick overlap detection ──
    updatePressurePlates({
      world,
      playerEntityId,
      bridge: workerBridge,
    });

    // Compute per-entity animation frame indices from velocity vectors.
    // Runs right before the uniform buffer flush so that the frame index
    // is available for any render-path consumers (UBO packing, texture
    // slicing via TextureManager.getFrameAt, etc.).
    animateEntitySystem(world);

    // Synchronize bitECS Appearance state into the LPC batch UBO pool.
    // Handles entity enter/exit lifecycle (slot allocation/free) and
    // structural fingerprint comparison to skip redundant UBO re-packs.
    // Uses a headless LpcBatchManager — no GPU Buffers in the worker.
    if (lpcBatchManager) {
      syncAppearanceSystem({
        world,
        batchManager: lpcBatchManager,
        recipeResolver: workerRecipeResolver,
        bridge: workerBridge,
      });
    }

    // Validate the writable buffer BEFORE draining events — if none is
    // available, skip this frame while keeping APPEARANCE_CHANGED,
    // CAMERA_ZOOM_UPDATE, zone and dialog events queued for the next tick
    // (they were previously drained before this check and lost on skipped
    // frames).
    const buffer = bufferPool[activeBufferIndex];
    if (!buffer || buffer.byteLength === 0) {
      return; // No writable buffer available — skip this frame
    }

    // Serialize entity positions into the active buffer
    serializeEntityStates(world, activeWriteView);

    // ── Increment monotonic tick counter for liveness detection ──
    tickCount++;

    // Collect events to send (buffer confirmed writable above)
    const events = pendingEvents;
    pendingEvents = [];

    // ArrayBuffer transfer cycle — transfer ownership so the main thread can read.
    // IMPORTANT: after transfer the worker's reference to `buffer` is
    // detached.  The next buffer in the pool may also be detached if the
    // main thread hasn't recycled it yet — guard with byteLength > 0.

    // Advance to the next writable buffer in the pool, skipping
    // any null entries (transferred but not yet recycled).
    const oldIndex = activeBufferIndex;

    // Find the next writable buffer — scan modulo FALLBACK_BUFFER_COUNT only
    let nextWritableIndex = -1;
    for (let attempt = 1; attempt <= FALLBACK_BUFFER_COUNT; attempt++) {
      const candidate = (oldIndex + attempt) % FALLBACK_BUFFER_COUNT;
      const buf = bufferPool[candidate] as ArrayBuffer | null;
      if (buf && buf.byteLength > 0) {
        nextWritableIndex = candidate;
        break;
      }
    }

    // ── RC-1 FIX: Never transfer the last writable buffer ──
    // If no free slot remains, the worker is starved. Post a copy of
    // the current data and retain ownership. The tick loop MUST NOT
    // stop — this is the deadlock that froze the engine.
    //
    // In the normal path: transfer the OLD buffer (bufferPool[oldIndex])
    // and create a view on the NEW buffer. PostMessage's transfer list
    // detaches whatever buffer we include — so we must NEVER include the
    // buffer that activeWriteView wraps.
    let bufferToSend: ArrayBuffer;
    if (nextWritableIndex === -1) {
      // Starvation: copy out, retain ownership.
      // bufferPool[oldIndex] stays in the pool (not nulled).
      bufferToSend = buffer.slice(0);
      logger.debug('[WorkerEngine] tickLoop:starvation-copy', {
        writableBufferCount: 0,
      });
    } else {
      // Normal path: mark old slot as consumed, advance to next.
      // Transfer the OLD buffer (the one we just finished writing to),
      // NOT the new one — otherwise the transfer detaches activeWriteView.
      bufferToSend = bufferPool[oldIndex] as ArrayBuffer;
      bufferPool[oldIndex] = null as unknown as ArrayBuffer;
      activeBufferIndex = nextWritableIndex;
      activeWriteView = new Float32Array(bufferPool[nextWritableIndex] as ArrayBuffer);
    }

    const camera = getCameraPosition();
    const zoom = getCameraZoom();
    const screenPos = getActiveNpcScreenPosition();

    // Emit CAMERA_ZOOM_UPDATE event for the UI overlay when dialogue is active (C-161)
    if (screenPos.x !== undefined) {
      events.push({
        type: 'CAMERA_ZOOM_UPDATE',
        zoom,
        npcScreenX: screenPos.x,
        npcScreenY: screenPos.y,
      });
    }

    const message: Record<string, unknown> = {
      type: 'STATE_UPDATE',
      buffer: bufferToSend,
      events,
      cameraX: camera.x,
      cameraY: camera.y,
      zoom,
      // C-379 AC-2: forward the player's vision mask so the main thread
      // can expose it on the debug bridge — E2E asserts the vision system
      // actually marks the player visible (CodeRabbit review).
      playerVisibleByMask:
        playerEntityId > 0 ? (VisionVisible.visibleByMask[playerEntityId] ?? 0) : 0,
      ack: {
        tickCount,
        lastProcessedInputSequence: _lastProcessedInputSequence,
        writableBufferCount: nextWritableIndex === -1 ? 0 : 1,
      },
      environment: {
        gameHour: environment.gameHour,
        gameMinute: environment.gameMinute,
        gameTimeSeconds: environment.gameTimeSeconds,
        windVelocity: environment.windVelocity,
        rainIntensity: environment.rainIntensity,
        ubo: environment.ubo,
      },
    };
    if (screenPos.x !== undefined) {
      message.npcScreenX = screenPos.x;
      message.npcScreenY = screenPos.y;
    }

    postMessage(
      message,
      // Transfer the buffer to the main thread (zero-copy handoff)
      [bufferToSend],
    );
  } catch (err) {
    logger.error('[WorkerEngine] tickLoop:crash', err);
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Tick loop crashed: ${err instanceof Error ? err.message : String(err)}`,
    });
    stopTickLoop();
  } finally {
    isTicking = false;
    _tickTimerHandle = undefined;
    // ── Self-healing: always reschedule if the world exists. The _running
    // flag is a soft gate inside tickLoop — if it's false, the tick returns
    // early after checking. But we MUST schedule so the loop can recover
    // when _running is restored. Without this, a stopTickLoop/startTickLoop
    // race can leave the timer dead permanently. ──
    if (world) {
      _scheduleNextTick();
    }
  }
};

// -- Grid population helper ------------------------------------------------

/**
 * Populates the spatial hash grid with positions of all context-bearing
 * entities (those with both Position and NPCDialog components).
 *
 * Uses a pre-allocated Float32Array buffer to avoid per-tick allocations.
 *
 * @param w - The bitECS world.
 * @param grid - The spatial hash grid to populate.
 * @param buffer - Pre-allocated Float32Array for interleaved x/y positions.
 */
const populateSpatialGrid = (w: World, grid: SpatialHashGrid, buffer: Float32Array): void => {
  const entityIds: number[] = [];

  for (const eid of query(w, CONTEXT_QUERY_TERMS)) {
    const pos = getComponent(w, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    const idx = entityIds.length;
    buffer[idx * 2] = pos.x;
    buffer[idx * 2 + 1] = pos.y;
    entityIds.push(eid);
  }

  grid.populate(buffer, entityIds);
};

// -- Entity serialization ---------------------------------------------------

/**
 * Writes entity positions and rotations into the Float32Array buffer.
 *
 * Layout per entity: [eid * COMPONENT_STRIDE + 0] = x,
 *                    [eid * COMPONENT_STRIDE + 1] = y,
 *                    [eid * COMPONENT_STRIDE + 2] = rotation
 *
 * @param w - The bitECS world.
 * @param view - The Float32Array view into the active buffer.
 */
const serializeEntityStates = (_w: World, view: Float32Array): void => {
  // Zero out the buffer first (clear stale data)
  view.fill(0);

  // Read directly from the Position SoA arrays (populated by observers)
  const { x: posX, y: posY } = Position;

  const entityCount = Math.min(posX.length, MAX_ENTITIES);
  for (let eid = 0; eid < entityCount; eid++) {
    const x = posX[eid];
    const y = posY[eid];

    if (x === undefined || y === undefined) {
      continue;
    }

    const offset = eid * COMPONENT_STRIDE;
    view[offset] = x;
    view[offset + 1] = y;
    // Rotation is 0 for the MVP (no rotation component yet)
    view[offset + 2] = 0;
  }
};

// -- Message handler --------------------------------------------------------

// ---------------------------------------------------------------------------
// Staging world spawn resolution (C-172)
// ---------------------------------------------------------------------------

/**
 * Copies every SoA field of a component from one entity to another.
 *
 * Used by RESTORE_PLAYER to merge a deserialized player payload onto the
 * live player entity without recreating the entity.
 *
 * @param component - The SoA component object (e.g. `Position`).
 * @param fromEid - Source entity.
 * @param toEid - Destination entity.
 */
const copyComponentSoA = (
  component: Record<string, Array<unknown>>,
  fromEid: number,
  toEid: number,
): void => {
  for (const field of Object.keys(component)) {
    const source = component[field] as Array<unknown>;
    const value = source[fromEid];
    if (value !== undefined) {
      (component[field] as Array<unknown>)[toEid] = value;
    }
  }
};

/**
 * Resolves a target spawn hash to pixel coordinates using a temporary
 * staging world.
 *
 * Creates an isolated bitECS world, spawns the provided spawn point
 * entities into it, queries for the matching `spawnHash`, and returns
 * the resolved coordinates. The staging world is destroyed immediately
 * after resolution — no entities are transferred to the main world.
 *
 * @param spawnPointEntities - Spawn point entities from the new map.
 * @param targetSpawnHash - The target spawn hash from the portal.
 * @returns The resolved X/Y pixel coordinates, or undefined if not found.
 */
const _resolveSpawnInStaging = (
  spawnPointEntities: SpawnPointEntity[] | undefined,
  targetSpawnHash: number,
): { x: number; y: number } | undefined => {
  if (!spawnPointEntities || spawnPointEntities.length === 0) {
    return undefined;
  }

  // Find the matching spawn point entity by spawnHash
  const match = spawnPointEntities.find((sp) => sp.spawnHash === targetSpawnHash);
  if (!match) {
    logger.debug('_resolveSpawnInStaging:no-match', { targetSpawnHash });
    return undefined;
  }

  logger.debug('_resolveSpawnInStaging:resolved', {
    targetSpawnHash,
    x: match.x,
    y: match.y,
  });

  return { x: match.x, y: match.y };
};

/**
 * Handles incoming messages from the main thread.
 *
 * Message types:
 * - INITIALIZE_ENGINE: Creates the world, spawns entities, starts the tick.
 * - RECYCLE_BUFFER: Receives a buffer back from the main thread (fallback).
 * - BRIDGE_COMMAND: A GameCommand from the UI (e.g., MOVE_PLAYER).
 */
self.onmessage = (event: MessageEvent): void => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'INITIALIZE_ENGINE': {
        const {
          canvasWidth,
          canvasHeight,
          buffers,
          loadPayload,
          playerData,
          collisionGrid,
          lpcCatalog,
        } = message;

        // C-400: store the injected LPC slot catalog so the worker's recipe
        // resolver produces the same asset IDs as the main thread.
        _workerLpcCatalog = Array.isArray(lpcCatalog)
          ? (lpcCatalog as LpcSlotCatalog[])
          : undefined;

        // Reset camera state for fresh engine
        resetCameraTracking();

        // N-buffer pool — the worker writes into one buffer, transfers it,
        // and receives it back via RECYCLE_BUFFER. Reset the pool before
        // adding, and cap at FALLBACK_BUFFER_COUNT (the tick loop and the
        // RECYCLE_BUFFER handler are both modulo-bound to that size).
        bufferPool.length = 0;
        for (let i = 0; i < Math.min(buffers.length, FALLBACK_BUFFER_COUNT); i++) {
          bufferPool.push(buffers[i] as ArrayBuffer);
        }
        activeWriteView = new Float32Array(bufferPool[0]);
        activeBufferIndex = 0;

        // ── Wrap initializeEngine in explicit try/catch so any sync
        // error is reported as ENGINE_ERROR instead of a silent worker crash. ──
        try {
          initializeEngine(
            canvasWidth as number,
            canvasHeight as number,
            loadPayload as string | undefined,
            playerData as PlayerCreateOptions | undefined,
            collisionGrid as CollisionGrid | undefined,
          );
        } catch (err) {
          logger.error('worker', 'initializeEngine:crashed', err);
          postMessage({
            type: 'ENGINE_ERROR',
            message: `initializeEngine crashed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      case 'RECYCLE_BUFFER': {
        // Main thread has finished reading this buffer — place it back
        // into the first null slot in the fixed-size pool.
        // If the tick loop paused (activeWriteView is undefined), restore
        // the write view so the loop resumes on the next interval.
        const recycled = message.buffer as ArrayBuffer;
        if (recycled && recycled.byteLength > 0) {
          // Find the first null slot and fill it
          let slotFound = false;
          for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
            if (!bufferPool[i]) {
              bufferPool[i] = recycled;
              slotFound = true;
              break;
            }
          }
          // ── RC-1 FIX: Never grow the pool past FALLBACK_BUFFER_COUNT ──
          // If all 3 slots are occupied, discard the recycled buffer.
          // The scan in tickLoop is modulo-bound to indices 0..2, so any
          // buffer at index 3+ is permanently invisible.
          if (!slotFound) {
            // Discard — the worker still has at least one active buffer
            logger.debug('[WorkerEngine] recycleBuffer:discard', {
              poolSize: bufferPool.filter((b) => b !== null).length,
            });
          }

          // Resume paused tick loop if it was starved (now has a real buffer)
          if (!activeWriteView && slotFound) {
            activeWriteView = new Float32Array(recycled);
            // Find which index we just filled
            for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
              if (bufferPool[i] === recycled) {
                activeBufferIndex = i;
                break;
              }
            }
            // Explicitly restart the tick loop now that we have a valid buffer
            startTickLoop();
          }
        }
        break;
      }

      case 'BRIDGE_COMMAND': {
        handleBridgeCommand(message.command as GameCommand);
        break;
      }

      case 'REQUEST_SNAPSHOT': {
        if (!world) {
          postMessage({
            type: 'SNAPSHOT_RESPONSE',
            payload: undefined,
            error: 'World not initialized',
          });
          break;
        }
        try {
          // Player-scoped by default: the map file is the source of truth for
          // world entities, so saves only need the player's own state.
          // When no map block can be produced (e.g. early-boot autosave race),
          // the save requests a full-world snapshot so the legacy restore path
          // can still reconstruct the world.
          const scope = message.scope === 'world' ? 'world' : 'player';
          const payload =
            scope === 'world'
              ? serializeWorld(world)
              : serializePlayer(world, playerEntityId > 0 ? playerEntityId : 1);
          postMessage({ type: 'SNAPSHOT_RESPONSE', payload });
        } catch (err) {
          postMessage({
            type: 'SNAPSHOT_RESPONSE',
            payload: undefined,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }

      case 'RESTORE_PLAYER': {
        if (!world) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: 'Cannot restore player: world not initialized',
          });
          break;
        }

        // ── Map-authoritative restore: apply the player snapshot onto the
        // existing world (which was just rebuilt via LOAD_MAP). Does NOT
        // clear entities or re-spawn zones — the map load already did that. ──
        const wasRunning = running;
        stopTickLoop();
        try {
          const payload = message.payload as string;
          const eidMap = deserializeWorld(world, payload);

          // The snapshot carries a single entity (the player). Take its
          // restored data and merge it onto the live player entity.
          let restoredEid: number | undefined;
          for (const [, newEid] of eidMap) {
            restoredEid = newEid;
            break;
          }

          if (restoredEid === undefined) {
            postMessage({ type: 'ENGINE_ERROR', message: 'RESTORE_PLAYER: empty snapshot' });
            break;
          }

          if (playerEntityId > 0 && playerEntityId !== restoredEid) {
            // Copy persistent components from the temp entity to the player,
            // then discard the temp entity.
            copyComponentSoA(Position, restoredEid, playerEntityId);
            copyComponentSoA(Appearance, restoredEid, playerEntityId);
            copyComponentSoA(CombatStats, restoredEid, playerEntityId);
            copyComponentSoA(Visual, restoredEid, playerEntityId);
            incrementEntityGeneration(restoredEid);
            removeEntity(world, restoredEid);
          } else {
            // No player yet — adopt the restored entity as the player.
            playerEntityId = restoredEid;
            addComponent(world, restoredEid, CameraFocus);
          }

          // C-378: A saved position can land inside a solid prop or wall —
          // the world was rebuilt by LOAD_MAP with CURRENT collision, while
          // the save may predate it (this contract's map conversion added
          // solid shop props, but any save-vs-map drift hits the same trap).
          // Restoring onto a solid cell freezes the player: the movement
          // bbox sampler spans the blocked cell on every axis, so no move
          // is accepted. Re-run the LOAD_MAP spawn clamp on the restored
          // position so the player always lands on a walkable tile. The
          // oracle validates the FULL collision box (not just the feet
          // tile) — a restore one tile below a solid prop deadlocks the
          // same way (C-378).
          {
            const restoredPx = Position.x[playerEntityId] ?? 0;
            const restoredPy = Position.y[playerEntityId] ?? 0;
            const clamped = clampSpawnToWalkable(
              restoredPx,
              restoredPy,
              isPlayerSpawnBlocked,
              getMapPixelBounds(),
            );
            if (clamped.x !== restoredPx || clamped.y !== restoredPy) {
              logger.debug(
                'RESTORE_PLAYER',
                `clamped restored spawn from (${restoredPx},${restoredPy}) to (${clamped.x},${clamped.y})`,
              );
              addComponent(world, playerEntityId, set(Position, { x: clamped.x, y: clamped.y }));
            }
          }

          // Snap the camera to the restored position and refresh the
          // player's LPC textures immediately. _refreshPlayerAppearance
          // applies the C-370 body-layer fallback before emitting.
          const px = Position.x[playerEntityId] ?? 0;
          const py = Position.y[playerEntityId] ?? 0;
          postMessage({ type: 'CAMERA_SNAP', x: px, y: py });

          _refreshPlayerAppearance(playerEntityId);

          postMessage({ type: 'ENGINE_READY' });
        } catch (err) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: `Restore player failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          if (wasRunning) {
            startTickLoop();
          }
        }
        break;
      }

      case 'SET_MAP_BOUNDS': {
        setMapBounds({
          width: message.width as number,
          height: message.height as number,
        });
        break;
      }

      case 'SET_SCREEN_SIZE': {
        setScreenSize({
          width: message.width as number,
          height: message.height as number,
          scale: message.scale as number | undefined,
        });
        break;
      }

      case 'LOAD_GAME': {
        if (!world) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: 'Cannot load game: world not initialized',
          });
          break;
        }

        // ── RC-3: Hoist wasRunning before try so finally can access it ──
        let wasRunning = false;
        try {
          // ── RC-3 FIX: Route through stopTickLoop for consistency ──
          wasRunning = running;
          stopTickLoop();

          // Clear all existing entities
          const allEids = getAllEntities(world);
          for (const eid of allEids) {
            // C-375 AC-3: defense-in-depth — drop spatial-grid entries before
            // entity teardown so stale entries never block movement.
            removeFromSpatialGrid(eid);
            incrementEntityGeneration(eid);
            removeEntity(world, eid);
          }
          playerEntityId = 0;

          // Reset camera tracking so the viewport snaps to the restored
          // player position instead of lerping from the old camera coords.
          resetCameraTracking();

          // Deserialize from the snapshot payload
          const loadPayload = message.payload as string;
          const eidMap = deserializeWorld(world, loadPayload);

          // C-375 AC-3 (CodeRabbit): re-register restored entities in the
          // spatial grid. deserializeWorld restores persistent components
          // only; any entity that carries GridPosition (solid NPCs /
          // non-walkable props) must be re-inserted after the teardown loop
          // above removed every grid entry. Placement is validated with
          // isCellBlocked so overlapping solid entities surface a diagnostic
          // instead of silently stacking in one cell.
          {
            let restoredGridCount = 0;
            for (const [, newEid] of eidMap) {
              const gx = GridPosition.x[newEid];
              const gy = GridPosition.y[newEid];
              if (gx === undefined || gy === undefined) {
                continue;
              }
              const mask = CollisionData.mask[newEid];
              if (mask !== undefined && isCellBlocked(gx, gy, mask)) {
                logger.warn(
                  'LOAD_GAME',
                  `restored entity ${newEid} overlaps a blocking occupant at (${gx},${gy})`,
                );
              }
              insertIntoSpatialGrid(newEid);
              restoredGridCount++;
            }
            if (restoredGridCount > 0) {
              logger.debug(
                'LOAD_GAME',
                `registered ${restoredGridCount} restored entities in the spatial grid (C-375 AC-3)`,
              );
            }
          }

          // Re-attach CameraFocus to the player (not serialized — tag component)
          for (const [oldEid, newEid] of eidMap) {
            if (oldEid === 1) {
              addComponent(world, newEid, CameraFocus);
              playerEntityId = newEid;
            }
          }

          // Notify main thread about all hydrated entities.
          // Include NPC metadata for non-player entities so the
          // main thread can populate its interaction map.
          let npcIndex = 0;
          for (const [oldEid, newEid] of eidMap) {
            const isPlayer = oldEid === 1;
            const tint = isPlayer ? 0x00ff88 : 0xffcc00;

            if (!isPlayer) {
              npcIndex++;
              // Include Visual.frame for prop entities so they load the real texture
              const frame = Visual.frame[newEid] ? (Visual.frame[newEid] as string) : undefined;
              postMessage({
                type: 'ENTITY_CREATED',
                eid: newEid,
                tint,
                npcData: {
                  eid: newEid,
                  npcId: `npc_${newEid}`,
                  npcName: `Restored NPC #${npcIndex}`,
                  personaId: 'default',
                  interactionRadius: 64,
                  relationshipValue: 0,
                  dialog: '...',
                  isVendor: false,
                  vendorInventory: '',
                },
                ...(frame ? { frame } : {}),
              });
            } else {
              postMessage({ type: 'ENTITY_CREATED', eid: newEid, tint });
            }
          }

          // Send the restored player position as a camera-snap message
          // so the main thread centers the viewport immediately, without
          // waiting for the next tick-loop STATE_UPDATE.
          const playerPosX = Position.x[playerEntityId] ?? 0;
          const playerPosY = Position.y[playerEntityId] ?? 0;
          postMessage({
            type: 'CAMERA_SNAP',
            x: playerPosX,
            y: playerPosY,
          });

          // Emit APPEARANCE_CHANGED for entities that have the Appearance
          // component so the main thread loads LPC textures immediately.
          // Without this, restored entities stay as colored debug squares
          // until the next tick-loop sync picks up the change.
          for (const [, newEid] of eidMap) {
            const layers = getAppearanceLayers(newEid);
            if (layers.length > 0) {
              postMessage({
                type: 'SYNC',
                events: [
                  {
                    type: 'APPEARANCE_CHANGED',
                    eid: newEid,
                    layerIds: [...layers],
                  },
                ],
              });
            }
          }

          // Re-spawn transition zone entities so portals work after load.
          // Transition zones are NOT serialized in the snapshot — they
          // come from the map's Tiled data and are re-created here.
          if (_lastTransitionZones && _lastTransitionZones.length > 0) {
            logger.debug(
              'LOAD_GAME',
              `re-spawning ${_lastTransitionZones.length} transition zones`,
            );
            spawnTransitionEntities({ world, transitionZones: _lastTransitionZones });
          } else {
            logger.debug('LOAD_GAME', 'no transition zones to re-spawn');
          }

          // ── RC-3 FIX: Restore tick loop via startTickLoop(), not raw flag ──
          if (wasRunning) {
            startTickLoop();
          }

          queueMicrotask(() => {
            postMessage({ type: 'ENGINE_READY' });
          });
        } catch (err) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: `Load game failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          // ── RC-3 FIX: Always restore the tick loop state, even on error ──
          if (wasRunning) {
            startTickLoop();
          }
        }
        break;
      }

      case 'LOAD_MAP': {
        if (!world) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: 'Cannot load map: world not initialized',
          });
          break;
        }

        // ── RC-3: Hoist wasRunning before try so finally can access it ──
        let wasRunning = false;
        try {
          // ── C-172: Set engine state to TRANSITIONING ──
          setSimulationState(world, SimulationState.transitioning);

          // ── RC-3 FIX: Route through stopTickLoop for consistency ──
          wasRunning = running;
          stopTickLoop();

          const {
            spawnPoints,
            transitionZones,
            collisionGrid,
            terrainGrid,
            packConfig,
            mapPixelWidth,
            mapPixelHeight,
            targetX,
            targetY,
            targetSpawnHash,
            defaultSpawnHash,
            defeatedEnemies,
            collectedPickups,
            interactableStates,
            spawnPointEntities,
            disableClamping,
            mapId,
          } = message;

          // ── C-376 AC-2: validate + store the pack config once per map load.
          // Malformed payloads warn and degrade to undefined (props solid),
          // never crash the worker.
          if (packConfig !== undefined) {
            if (Value.Check(PackConfigSchema, packConfig)) {
              _packConfig = packConfig as PackConfig;
              logger.debug(
                'LOAD_MAP',
                `stored packConfig (${Object.keys(_packConfig.tiles).length} tiles, ${Object.keys(_packConfig.props).length} props)`,
              );
            } else {
              logger.warn(
                'LOAD_MAP',
                'packConfig failed TypeBox validation — treating as undefined',
              );
              _packConfig = undefined;
            }
          } else {
            _packConfig = undefined;
          }

          // ── C-172: Resolve spawn coordinates ──
          // Resolution chain (each step a fallback):
          //   1. targetSpawnHash (portal's targetSpawnId, e.g. 'shop_entrance')
          //   2. defaultSpawnHash (destination map's manifest defaultSpawnId)
          //   3. targetX/targetY (hardcoded portal fallback)
          // The walkability clamp below runs last and repositions onto
          // walkable terrain if the resolved point is blocked.
          let resolvedX = targetX as number;
          let resolvedY = targetY as number;

          const markers = spawnPointEntities as SpawnPointEntity[] | undefined;
          const spawnCandidates: Array<{ hash: unknown; label: string }> = [
            { hash: targetSpawnHash, label: 'targetSpawnHash' },
            { hash: defaultSpawnHash, label: 'defaultSpawnHash' },
          ];

          for (const candidate of spawnCandidates) {
            if (typeof candidate.hash !== 'number' || candidate.hash <= 0) {
              continue;
            }
            const resolved = _resolveSpawnInStaging(markers, candidate.hash);
            if (resolved) {
              logger.debug(
                'LOAD_MAP',
                `spawn resolved via ${candidate.label} ${candidate.hash} -> (${resolved.x},${resolved.y})`,
              );
              resolvedX = resolved.x;
              resolvedY = resolved.y;
              break;
            }
          }

          // ── C-194: Dehydrate the departing zone before entity cleanup ──
          if (_activeZoneEntityId > 0) {
            dehydrateZone(world, _activeZoneEntityId);
          }

          // 1. Clear non-player entities (NPCs, props, transitions, spawn points).
          //    Preserve the player entity and the EngineState singleton.
          //    C-375 AC-3: remove spatial-grid entries before entity teardown
          //    so stale entries never block the next map.
          const allEids = getAllEntities(world);
          for (const eid of allEids) {
            if (eid !== playerEntityId) {
              removeFromSpatialGrid(eid);
              incrementEntityGeneration(eid);
              removeEntity(world, eid);
            }
          }

          // 2. Update player position to the resolved spawn coordinates
          if (playerEntityId > 0) {
            addComponent(world, playerEntityId, set(Position, { x: resolvedX, y: resolvedY }));
          }

          // 3. Spawn new NPC and prop entities from the new map.
          //    Pass defeatedEnemies + collectedPickups so previously-defeated
          //    enemies and already-collected items are filtered (C-147, C-331).
          //    Pass interactableStates for door/chest/lever persistence (C-342).
          const results = spawnEntities({
            world,
            spawnPoints,
            packConfig: _packConfig,
            defeatedEnemies: defeatedEnemies as string[] | undefined,
            collectedPickups: collectedPickups as string[] | undefined,
            interactableStates: interactableStates as InteractableStateMap | undefined,
          });

          // 4. Spawn transition zone trigger entities
          _lastTransitionZones = transitionZones;
          logger.debug('LOAD_MAP', `storing ${transitionZones.length} transition zones`);
          spawnTransitionEntities({ world, transitionZones });

          // 5. Spawn spawn point marker entities (C-172)
          if (spawnPointEntities && (spawnPointEntities as SpawnPointEntity[]).length > 0) {
            spawnSpawnPointEntities({
              world,
              spawnPointEntities: spawnPointEntities as SpawnPointEntity[],
            });
          }

          // 6. Set the new terrain grid.
          //    C-379 AC-4: prefer the authoritative TerrainGrid (terrain
          //    channel or legacy fallback, built client-side). Fall back to
          //    the legacy boolean grid when no terrainGrid was sent (older
          //    callers / sandbox) — setTerrainGrid converts it internally.
          if (terrainGrid) {
            setTerrainGrid(terrainGrid, world);
          } else if (collisionGrid) {
            setTerrainGrid(
              buildTerrainGridForMap({
                tilemap: {
                  width: (collisionGrid as CollisionGrid).width,
                  height: (collisionGrid as CollisionGrid).height,
                  tilewidth: (collisionGrid as CollisionGrid).tileSize,
                  tileheight: (collisionGrid as CollisionGrid).tileSize,
                  tilesets: [],
                  layers: [],
                },
                packConfig: _packConfig,
                collisionGrid: collisionGrid as CollisionGrid,
              }),
              world,
            );
          } else {
            // C-378: never retain the PREVIOUS map's grid when the new map
            // carries none — a stale grid/bounds would feed RESTORE_PLAYER's
            // clampSpawnToWalkable (and the spawn clamp) with the wrong
            // terrain and map bounds. Reset so no stale collision data
            // survives the transition (the walkability oracle then treats
            // every cell as walkable instead of clamping to a dead grid).
            logger.warn(
              'LOAD_MAP',
              'collisionGrid missing on map load — resetting collision state',
            );
            resetCollisionGrid();
          }

          // 6d. C-375 AC-3: register spawned NPC/prop entities in the
          //     spatial grid. MUST run AFTER setCollisionGrid — the grid was
          //     re-allocated (initializeSpatialGrid) inside setCollisionGrid,
          //     which wipes any earlier inserts. Only entities carrying
          //     GridPosition (solid NPCs + non-walkable props) are inserted.
          {
            let gridInsertCount = 0;
            for (const result of results) {
              if (GridPosition.x[result.eid] !== undefined) {
                insertIntoSpatialGrid(result.eid);
                gridInsertCount++;
              }
            }
            if (gridInsertCount > 0) {
              logger.debug(
                'LOAD_MAP',
                `registered ${gridInsertCount} NPC/prop entities in the spatial grid (C-375 AC-3)`,
              );
            }
          }

          // 6b. C-379: A* pathfinding reads the terrain grid directly — no
          //     separate initialization needed (JPS deleted, AC-6).

          // 6c. C-196/C-379: Initialize spatial vision grid for perception
          //     sweeps. The oracle is blocksSight from the terrain grid — a
          //     movement-passable but sight-blocking tile (window, hedge)
          //     now blocks vision without blocking movement (AC-2, issue I).
          {
            const cg = (terrainGrid ?? collisionGrid) as
              | { width: number; height: number }
              | undefined;
            if (cg) {
              const visionWallCheck = (gx: number, gy: number): boolean => isBlocksSight(gx, gy);
              setVisionGrid(visionWallCheck, cg.width, cg.height);
            }
          }

          // 6a. C-180: Clamp player spawn position to a walkable tile.
          //     Query params like ?position_x=0&position_y=0 may land on
          //     water or outside the map — adjust to interior grass.
          //     C-376 AC-3: use the canonical composite (spatial-grid entity
          //     blocking OR terrain solidity) so a wall/NPC-occupied tile is
          //     never a valid clamp target.
          //     C-378: shared with RESTORE_PLAYER so a saved position that
          //     lands inside a solid prop is also repositioned — otherwise
          //     the bbox sampler deadlocks every movement axis.
          if (playerEntityId > 0) {
            const pos = getComponent(world, playerEntityId, Position) as PositionData | undefined;
            if (pos) {
              const clamped = clampSpawnToWalkable(pos.x, pos.y, isPlayerSpawnBlocked, {
                width: mapPixelWidth as number,
                height: mapPixelHeight as number,
              });
              if (clamped.x !== pos.x || clamped.y !== pos.y) {
                logger.debug(
                  'LOAD_MAP',
                  `clamped spawn from (${pos.x},${pos.y}) to (${clamped.x},${clamped.y})`,
                );
                addComponent(world, playerEntityId, set(Position, { x: clamped.x, y: clamped.y }));
              }
            }
          }

          // 7. Set camera map bounds and reset tracking for snap
          //    C-199: Support optional clamping bypass for visual testing.
          setMapBounds({
            width: mapPixelWidth as number,
            height: mapPixelHeight as number,
            disableClamping: disableClamping as boolean | undefined,
          });
          resetCameraTracking();

          // 8. Notify main thread about the player entity (position updated)
          postMessage({ type: 'ENTITY_CREATED', eid: playerEntityId, tint: 0x00ff88 });

          // 9. Notify main thread about all spawned NPC/prop entities
          for (const result of results) {
            let tint: number;
            if (result.type === 'npc') {
              tint = 0xffcc00;
            } else if (result.type === 'enemy') {
              tint = 0xff4444;
            } else {
              tint = 0xffffff;
            }

            // Read NPCDialog data for NPC entities so the main thread
            // can track them in _npcMeta for interaction key (E/Enter).
            let npcData: Record<string, unknown> | undefined;
            if (result.type === 'npc') {
              const dialogComp = getComponent(world, result.eid, NPCDialog) as
                | {
                    npcId: string;
                    npcName: string;
                    dialog: string;
                    interactionRadius: number;
                    personaId?: string;
                    isVendor?: boolean;
                    vendorInventory?: string;
                  }
                | undefined;
              if (dialogComp) {
                npcData = {
                  npcId: dialogComp.npcId || `npc_${result.eid}`,
                  npcName: dialogComp.npcName || 'Unknown',
                  personaId:
                    (result.spawnPoint.properties?.personaId as string | undefined) || 'default',
                  interactionRadius: dialogComp.interactionRadius || 64,
                  relationshipValue: 0,
                  dialog: dialogComp.dialog || '',
                  isVendor: dialogComp.isVendor || false,
                  vendorInventory: dialogComp.vendorInventory || '',
                };
              }
            }

            postMessage({
              type: 'ENTITY_CREATED',
              eid: result.eid,
              tint,
              ...(npcData ? { npcData } : {}),
              // Props carry their named atlas frame so the main thread can
              // swap the white placeholder for the real tileset sprite.
              ...(result.type === 'prop'
                ? { frame: (Visual.frame[result.eid] ?? '') as string }
                : {}),
            });

            // Emit APPEARANCE_CHANGED for entities with Appearance component
            // so the main thread loads LPC textures immediately instead of
            // waiting for the tick-loop sync system to detect them.
            const layers = getAppearanceLayers(result.eid);
            if (layers.length > 0) {
              postMessage({
                type: 'SYNC',
                events: [
                  {
                    type: 'APPEARANCE_CHANGED',
                    eid: result.eid,
                    layerIds: [...layers],
                  },
                ],
              });
            }
          }

          // Also emit APPEARANCE_CHANGED for the player after position update
          const playerLayers = getAppearanceLayers(playerEntityId);
          if (playerLayers.length > 0) {
            postMessage({
              type: 'SYNC',
              events: [
                {
                  type: 'APPEARANCE_CHANGED',
                  eid: playerEntityId,
                  layerIds: [...playerLayers],
                },
              ],
            });
          }

          // ── C-194: Hydrate the new active zone ──
          // Derive a zone entity ID from the stable map id string so
          // same-sized maps (inn vs merchant_shop, both 512×384) do not
          // collide to the same zone entity. The hash is constrained to the
          // valid bitECS entity range (< MAX_ENTITIES) with a nonzero guard.
          const newZoneEid =
            typeof mapId === 'string' && mapId.length > 0
              ? djb2Hash(mapId) % MAX_ENTITIES || 1
              : ((mapPixelWidth as number) * 31 + (mapPixelHeight as number) * 17) % MAX_ENTITIES ||
                1;
          _activeZoneEntityId = newZoneEid;
          hydrateZone(world, newZoneEid, {
            zonePixelOriginX: 0,
            zonePixelOriginY: 0,
            gridCellSize: 64,
          });

          // ── C-172: Restore engine state to ACTIVE ──
          setSimulationState(world, SimulationState.active);

          // ── RC-3 FIX: Restore tick loop via startTickLoop(), not raw flag ──
          if (wasRunning) {
            startTickLoop();
          }

          queueMicrotask(() => {
            postMessage({ type: 'MAP_LOADED' });
          });
        } catch (err) {
          // Ensure engine state is restored even on error
          if (world) {
            setSimulationState(world, SimulationState.active);
          }
          postMessage({
            type: 'ENGINE_ERROR',
            message: `Load map failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        } finally {
          // ── RC-3 FIX: Always restore the tick loop state, even on error ──
          if (wasRunning) {
            startTickLoop();
          }
        }
        break;
      }

      default: {
        // ── C-332: Worker heartbeat — respond to main-thread PING ──
        if (message.type === 'PING') {
          postMessage({ type: 'PONG', timestamp: performance.now() });
          break;
        }
        // ── C-332: Main thread requests tick loop reset (stall recovery) ──
        if (message.type === 'RESET_TICK_LOOP') {
          logger.debug('[WorkerEngine] resetTickLoop:requested');
          stopTickLoop();
          // Reuse any live buffer in the pool to rebuild activeWriteView
          for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
            const buf = bufferPool[i] as ArrayBuffer | null;
            if (buf && buf.byteLength > 0) {
              activeWriteView = new Float32Array(buf);
              activeBufferIndex = i;
              break;
            }
          }
          startTickLoop();
          break;
        }
        break;
      }
    }
  } catch (err) {
    logger.error('worker', 'Message handler error', err);
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker handler error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};
