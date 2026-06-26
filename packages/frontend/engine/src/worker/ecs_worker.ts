// packages/frontend/engine/src/worker/ecs_worker.ts
/// <reference lib="webworker" />
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
import { logger } from '$logger';
import type { TransitionZone } from '../assets/map_loader.ts';
import {
  Appearance,
  getAppearanceLayers,
  type LpcLayerRecipe,
  registerAppearanceObservers,
} from '../components/appearance.ts';
import { CameraFocus, registerCameraFocusObservers } from '../components/camera_focus.ts';
import { registerCombatStatsObservers } from '../components/combat_stats.ts';
import { registerEnemyObservers } from '../components/enemy.ts';
import { registerInteractableObservers } from '../components/interactable.ts';
import { registerInventoryObservers } from '../components/inventory.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpriteObservers } from '../components/sprite.ts';
import { registerTransitionObservers } from '../components/transition.ts';
import { registerTurnOrderObservers } from '../components/turn_order.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { COMPONENT_STRIDE, FALLBACK_BUFFER_COUNT, MAX_ENTITIES } from '../config/memory_config.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { createNPC } from '../entities/create_npc.ts';
import { createPlayer, type PlayerCreateOptions } from '../entities/create_player.ts';
import { createTestSprite } from '../entities/create_test_sprite.ts';
import { SpatialHashGrid } from '../math/spatial_hash_grid.ts';
import { deserializeWorld, serializeWorld } from '../serialization/ecs_serializer.ts';
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
import { type CollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import {
  isCombatStageActive,
  setupCombatStage,
  teardownCombatStage,
  triggerPlayerAttackAnimation,
} from '../systems/combat_stage_system.ts';
import { updateContextSystem } from '../systems/context_system.ts';
import { updateDialogTriggers } from '../systems/dialog_trigger_system.ts';
import { updateEncounterSystem } from '../systems/encounter_system.ts';
import { spawnEntities, spawnTransitionEntities } from '../systems/entity_spawner.ts';
import { enqueueMacro, updateExpressions } from '../systems/expression_system.ts';
import { handleInteract } from '../systems/interaction_system.ts';
import { updateMovement } from '../systems/movement_system.ts';
import {
  animateEntitySystem,
  LpcBatchManager,
  syncAppearanceSystem,
} from '../systems/render_worker.ts';
import { handleCombatAction } from '../systems/turn_manager_system.ts';
import { updateZoningSystem } from '../systems/zoning_system.ts';
import type { GameCommand, GameEvent, NPCSpawnData } from '../types.ts';

// ---------------------------------------------------------------------------
// Worker: owns the full bitECS world and system ticking
// ---------------------------------------------------------------------------

// Startup sentinel — confirms the worker module loaded and executed.
logger.info('worker', 'Module loaded, ready for INITIALIZE_ENGINE');

// -- Worker-global state ----------------------------------------------------

/** The bitECS world — created once per INITIALIZE_ENGINE. */
let world: World | undefined;

/** The player entity ID, set during initialization. */
let playerEntityId = 0;

/** Last transition zones from LOAD_MAP — re-spawned after LOAD_GAME. */
let _lastTransitionZones: TransitionZone[] | undefined;

/** Whether the tick loop is currently running. */
let running = false;

/** Spatial hash grid for O(1) proximity queries. */
let spatialGrid: SpatialHashGrid | undefined;

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

/** Whether we have a SharedArrayBuffer (cross-origin isolated). */
let useSharedMemory = false;

/** The pool of ArrayBuffers for N-buffer fallback. */
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
 * Applies a SET_PLAYER_VELOCITY command to the player entity's velocity.
 *
 * Gates on the current engine game mode — velocity is ignored when the
 * mode is not EXPLORE (e.g., during DIALOGUE or MENU overlays).
 */
const handleSetPlayerVelocity = (velocity: { x: number; y: number }): void => {
  if (!world) {
    return;
  }

  // Gate: only apply velocity in EXPLORE mode
  if (getEngineGameMode() !== 'EXPLORE') {
    return;
  }

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
  switch (command.type) {
    case 'SET_PLAYER_VELOCITY': {
      handleSetPlayerVelocity(command.velocity);
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
    case 'PAUSE_GAME':
    case 'RESUME_GAME':
    case 'EXECUTE_COMMAND': {
      // These commands are not processed by the worker in the current MVP.
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
    case 'UPDATE_PLAYER_APPEARANCE': {
      // ── Equipment → Appearance layer sync (C-163) ──
      // When equipment changes, update the player entity's Appearance
      // component layers so the LPC sprite reflects the new gear.
      if (world && playerEntityId > 0) {
        _updatePlayerAppearanceFromEquipment(playerEntityId, {
          weapon: (command as { weapon?: string }).weapon,
          armor: (command as { armor?: string }).armor,
        });
      }
      break;
    }
    default: {
      break;
    }
  }
};

// -- Worker-side recipe resolver --------------------------------------------

/**
 * Updates the player entity's Appearance component layers based on
 * current equipment state.
 *
 * Maps equipment item IDs to LPC layer variant indices:
 * - Armor: updates layer2 (torso)
 *   - leather_armor → layer 2
 *   - iron_armor   → layer 3
 *   - no armor     → layer 1 (default)
 *
 * After updating, emits APPEARANCE_CHANGED through the bridge so the
 * LPC rendering pipeline picks up the change immediately.
 *
 * Contract: C-163 Visceral Feedback Juice
 */
const _updatePlayerAppearanceFromEquipment = (
  eid: number,
  equipment: { weapon?: string; armor?: string },
): void => {
  // Read current layers
  const currentLayers = getAppearanceLayers(eid);
  const newLayers = [...currentLayers];

  // Map armor to torso layer (index 2)
  if (equipment.armor) {
    const armorToLayer = (armorId: string): number => {
      switch (armorId) {
        case 'leather_armor':
        case 'wooden_shield':
          return 2;
        case 'iron_armor':
          return 3;
        default:
          return 2;
      }
    };
    newLayers[2] = armorToLayer(equipment.armor);
  } else {
    // No armor equipped — revert torso to default
    newLayers[2] = 1;
  }

  // Apply updated layers
  for (let i = 0; i < newLayers.length; i++) {
    const layerValue = newLayers[i];
    if (layerValue === undefined) {
      continue;
    }
    switch (i) {
      case 0:
        Appearance.layer0[eid] = layerValue;
        break;
      case 1:
        Appearance.layer1[eid] = layerValue;
        break;
      case 2:
        Appearance.layer2[eid] = layerValue;
        break;
      case 3:
        Appearance.layer3[eid] = layerValue;
        break;
      case 4:
        Appearance.layer4[eid] = layerValue;
        break;
      case 5:
        Appearance.layer5[eid] = layerValue;
        break;
    }
  }

  // Emit APPEARANCE_CHANGED so the LPC rendering pipeline regenerates
  // the sprite with the updated layers.
  workerBridge.emit({
    type: 'APPEARANCE_CHANGED',
    eid,
    layerIds: newLayers as number[],
  });
};

/** Slot name lookup for converting Appearance layer IDs to recipes. */
const WORKER_SLOT_NAMES = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

/**
 * Converts entity layer IDs to {@link LpcLayerRecipe} arrays using
 * empty palettes (zero-filled 1024-byte LUTs).
 *
 * The structural fingerprint computed by {@link recipeStructuralFingerprint}
 * only compares slot names and asset IDs — palette data is ignored.
 * This means fingerprint evaluation in the worker matches the main
 * thread even without access to the actual palette textures.
 *
 * @param layerIds - Array of 5 layer asset IDs from the Appearance component.
 * @returns Layer recipes with empty palettes for structural tracking.
 */
const workerRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const recipes: LpcLayerRecipe[] = [];
  for (let i = 0; i < layerIds.length; i++) {
    if (layerIds[i] > 0) {
      recipes.push({
        slot: WORKER_SLOT_NAMES[i] ?? `layer_${i}`,
        assetId: String(layerIds[i]),
        hexPalette: new Uint8Array(1024),
      });
    }
  }
  return recipes;
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
  // 1. Set the collision grid before any entities or systems start
  if (collisionGrid) {
    setCollisionGrid(collisionGrid);
  }

  // 2. Create the bitECS world
  world = createWorld();

  // 3. Initialize camera bounds from provided canvas dims + collision grid
  setScreenSize({ width: canvasWidth, height: canvasHeight });
  if (collisionGrid) {
    setMapBounds({
      width: collisionGrid.width * collisionGrid.tileSize,
      height: collisionGrid.height * collisionGrid.tileSize,
    });
  }

  // 4. Register component observers
  registerPositionObservers(world);
  registerVelocityObservers(world);
  registerSpriteObservers(world);
  registerNPCDialogObservers(world);
  registerAppearanceObservers(world);
  registerCombatStatsObservers(world);
  registerEnemyObservers(world);
  registerInventoryObservers(world);
  registerInteractableObservers(world);
  registerTurnOrderObservers(world);
  registerCameraFocusObservers(world);
  registerTransitionObservers(world);

  // 5. Create headless LpcBatchManager for slot tracking + fingerprint eval
  //    No createBuffer factory → operates without GPU Buffers in the worker.
  lpcBatchManager = new LpcBatchManager({ maxInstances: 64 });

  // 6. Start the tick loop (~60fps = 16ms interval)
  running = true;

  // 7. Initialize spatial hash grid (cellSize 50, capacity = MAX_ENTITIES * 2)
  spatialGrid = new SpatialHashGrid({
    cellSize: 50,
    capacity: MAX_ENTITIES * 2,
  });
  positionBuffer = new Float32Array(MAX_ENTITIES * 2);

  setInterval(tickLoop, 16);

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
      postMessage({ type: 'ENTITY_CREATED', eid: newEid, tint });
    }
  } else {
    playerEntityId = createPlayer(world, playerData);
    let testSpriteId = 0;
    if (canvasWidth && canvasHeight) {
      testSpriteId = createTestSprite(world, canvasWidth, canvasHeight);
    }

    // Player (green tint)
    postMessage({
      type: 'ENTITY_CREATED',
      eid: playerEntityId,
      tint: 0x00ff88,
    });

    // Test sprite (pink tint) — must be sent so GameWorld creates a display object
    // bitECS allocates sequential IDs, so testSpriteId = playerEntityId + 1
    if (testSpriteId > 0) {
      postMessage({
        type: 'ENTITY_CREATED',
        eid: testSpriteId,
        tint: 0xff6688,
      });
    }
  }

  queueMicrotask(() => {
    postMessage({
      type: 'ENGINE_READY',
    });
  });

  // Emit a dummy quest so the quest log UI has data to display (C-143 MVP).
  // In a full implementation, quests would be tracked via ECS components
  // and emitted whenever a quest is added, progressed, or completed.
  queueMicrotask(() => {
    workerBridge.emit({
      type: 'QUESTS_UPDATED',
      quests: [
        {
          id: 'q-slimes',
          title: 'Slime Extermination',
          description:
            'Clear the eastern road of slimes to ensure safe passage for merchant caravans.',
          status: 'active',
          objectives: [
            { label: 'Defeat Blue Slimes', current: 2, max: 5 },
            { label: 'Defeat Red Slimes', current: 1, max: 3 },
            { label: 'Report to Guard Captain', current: 0, max: 1 },
          ],
        },
        {
          id: 'q-herbs',
          title: 'Gather Moonpetal Herbs',
          description: 'Collect rare Moonpetal herbs from the Silverwood Grove for the apothecary.',
          status: 'active',
          objectives: [
            { label: 'Find Moonpetal Herbs', current: 4, max: 6 },
            { label: 'Deliver herbs to Apothecary Mira', current: 0, max: 1 },
          ],
        },
        {
          id: 'q-artifact',
          title: 'The Lost Artifact of Valdris',
          description: 'Recover the ancient artifact from the ruins beneath the Howling Mountains.',
          status: 'completed',
          objectives: [
            { label: 'Find the entrance to the ruins', current: 1, max: 1 },
            { label: 'Solve the Guardian puzzle', current: 1, max: 1 },
            { label: 'Retrieve the Artifact', current: 1, max: 1 },
            { label: 'Return to Sage Theron', current: 1, max: 1 },
          ],
        },
      ],
    });
  });
};

// -- Tick loop --------------------------------------------------------------

/** Timestamp of the previous tick for computing delta time. */
let lastTickTime = performance.now();

/**
 * Runs one simulation frame: movement → dialog triggers → context →
 * serialize entity states → post STATE_UPDATE.
 */
const tickLoop = (): void => {
  if (!world || !running || !activeWriteView) {
    return;
  }

  // Compute delta time
  const now = performance.now();
  const deltaMs = now - lastTickTime;
  lastTickTime = now;

  // Populate the spatial hash grid with entity positions for this tick
  if (spatialGrid && positionBuffer) {
    populateSpatialGrid(world, spatialGrid, positionBuffer);
  }

  // Run game systems
  updateExpressions(world, workerBridge);
  updateMovement(world, deltaMs);
  updateCameraSystem(world, deltaMs);

  // Run encounter system after movement — positions are finalized
  updateEncounterSystem({ world, playerEntityId, bridge: workerBridge });

  // ── Combat stage setup / teardown (C-166) ──
  const screen = getScreenSize();
  if (getEngineGameMode() === 'COMBAT' && !isCombatStageActive()) {
    setupCombatStage(world, { screenWidth: screen.width, screenHeight: screen.height });
  } else if (getEngineGameMode() !== 'COMBAT' && isCombatStageActive()) {
    teardownCombatStage(world);
  }

  updateDialogTriggers(world, playerEntityId, workerBridge);
  updateZoningSystem(world, playerEntityId, workerBridge);

  if (spatialGrid) {
    updateContextSystem({
      world,
      playerEntityId,
      bridge: workerBridge,
      spatialGrid,
    });
  }

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

  // Serialize entity positions into the active buffer
  serializeEntityStates(world, activeWriteView);

  // Collect events to send
  const events = pendingEvents;
  pendingEvents = [];

  if (useSharedMemory) {
    // SharedArrayBuffer — main thread reads directly, no transfer needed
    const camera = getCameraPosition();
    const zoom = getCameraZoom();
    const screenPos = getActiveNpcScreenPosition();
    const message: Record<string, unknown> = {
      type: 'STATE_UPDATE',
      events,
      cameraX: camera.x,
      cameraY: camera.y,
      zoom,
    };
    if (screenPos.x !== undefined) {
      message.npcScreenX = screenPos.x;
      message.npcScreenY = screenPos.y;
    }

    // Emit CAMERA_ZOOM_UPDATE event for the UI overlay when dialogue is active (C-161)
    if (screenPos.x !== undefined) {
      events.push({
        type: 'CAMERA_ZOOM_UPDATE',
        zoom,
        npcScreenX: screenPos.x,
        npcScreenY: screenPos.y,
      });
    }

    postMessage(message);
  } else {
    // ArrayBuffer fallback — transfer ownership so main thread can read.
    // IMPORTANT: after transfer the worker's reference to `buffer` is
    // detached.  The next buffer in the pool may also be detached if the
    // main thread hasn't recycled it yet — guard with byteLength > 0.
    const buffer = bufferPool[activeBufferIndex];
    if (!buffer || buffer.byteLength === 0) {
      return; // No writable buffer available — skip this frame
    }

    // Advance to the next writable buffer in the pool, skipping
    // any null entries (transferred but not yet recycled).
    const oldIndex = activeBufferIndex;

    // Mark the buffer we're about to transfer as consumed
    bufferPool[oldIndex] = null as unknown as ArrayBuffer;

    // Find the next writable buffer
    let nextWritableIndex = -1;
    for (let attempt = 0; attempt < FALLBACK_BUFFER_COUNT; attempt++) {
      const candidate = (oldIndex + 1 + attempt) % FALLBACK_BUFFER_COUNT;
      const buf = bufferPool[candidate] as ArrayBuffer | null;
      if (buf && buf.byteLength > 0) {
        nextWritableIndex = candidate;
        break;
      }
    }

    if (nextWritableIndex === -1) {
      // All buffers are transferred — pause the tick loop until
      // the main thread recycles one back via RECYCLE_BUFFER.
      activeWriteView = undefined;
      return;
    }

    activeBufferIndex = nextWritableIndex;
    activeWriteView = new Float32Array(bufferPool[nextWritableIndex] as ArrayBuffer);

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
      buffer,
      events,
      cameraX: camera.x,
      cameraY: camera.y,
      zoom,
    };
    if (screenPos.x !== undefined) {
      message.npcScreenX = screenPos.x;
      message.npcScreenY = screenPos.y;
    }

    postMessage(
      message,
      // Transfer the buffer to the main thread (zero-copy handoff)
      [buffer],
    );
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

// -- Error handling (worker-side) --------------------------------------------

/**
 * Worker-level error handler — catches unhandled exceptions inside the
 * worker and posts them back to the main thread for debugging.
 */
self.onerror = (event: string | Event): void => {
  const evt = event instanceof ErrorEvent ? event : undefined;
  const detail = {
    message: evt?.message || String(event),
    filename: evt?.filename || '(unknown)',
    lineno: evt?.lineno,
    colno: evt?.colno,
  };
  logger.error('worker', 'Unhandled error', detail);
  postMessage({
    type: 'ENGINE_ERROR',
    message: `Worker: ${detail.message} @ ${detail.filename}:${detail.lineno}`,
  });
};

/**
 * Catch unhandled promise rejections inside the worker.
 */
self.onunhandledrejection = (event: PromiseRejectionEvent): void => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  logger.error('worker', `Unhandled rejection: ${message}`, event.reason);
  postMessage({
    type: 'ENGINE_ERROR',
    message: `Worker rejection: ${message}`,
  });
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
        const { canvasWidth, canvasHeight, buffers, loadPayload, playerData, collisionGrid } =
          message;

        // Reset camera state for fresh engine
        resetCameraTracking();

        // Determine whether we have shared memory
        const firstBuffer = buffers[0] as ArrayBuffer;
        useSharedMemory =
          typeof SharedArrayBuffer !== 'undefined' && firstBuffer instanceof SharedArrayBuffer;

        if (useSharedMemory) {
          // Single SharedArrayBuffer — both threads read/write the same memory
          activeWriteView = new Float32Array(firstBuffer);
        } else {
          // N-buffer pool for fallback
          for (let i = 0; i < buffers.length; i++) {
            bufferPool.push(buffers[i] as ArrayBuffer);
          }
          activeWriteView = new Float32Array(bufferPool[0]);
          activeBufferIndex = 0;
        }

        initializeEngine(
          canvasWidth as number,
          canvasHeight as number,
          loadPayload as string | undefined,
          playerData as PlayerCreateOptions | undefined,
          collisionGrid as CollisionGrid | undefined,
        );
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
          // Fallback: push if all slots are somehow full (shouldn't happen)
          if (!slotFound) {
            bufferPool.push(recycled);
          }

          // Resume paused tick loop
          if (!activeWriteView) {
            activeWriteView = new Float32Array(recycled);
            // Find which index we just filled
            for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
              if (bufferPool[i] === recycled) {
                activeBufferIndex = i;
                break;
              }
            }
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
          const payload = serializeWorld(world);
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

        try {
          // Pause the tick loop during entity teardown + recreate
          const wasRunning = running;
          running = false;

          // Clear all existing entities
          const allEids = getAllEntities(world);
          for (const eid of allEids) {
            removeEntity(world, eid);
          }
          playerEntityId = 0;

          // Reset camera tracking so the viewport snaps to the restored
          // player position instead of lerping from the old camera coords.
          resetCameraTracking();

          // Deserialize from the snapshot payload
          const loadPayload = message.payload as string;
          const eidMap = deserializeWorld(world, loadPayload);

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

          // Restore the tick loop if it was running
          running = wasRunning;

          queueMicrotask(() => {
            postMessage({ type: 'ENGINE_READY' });
          });
        } catch (err) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: `Load game failed: ${err instanceof Error ? err.message : String(err)}`,
          });
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

        try {
          // Pause the tick loop during map teardown + recreate
          const wasRunning = running;
          running = false;

          const {
            spawnPoints,
            transitionZones,
            collisionGrid,
            mapPixelWidth,
            mapPixelHeight,
            targetX,
            targetY,
            defeatedEnemies,
          } = message;

          // 1. Clear non-player entities (NPCs, props, transitions).
          //    Preserve the player entity and any persistent entities.
          const allEids = getAllEntities(world);
          for (const eid of allEids) {
            if (eid !== playerEntityId) {
              removeEntity(world, eid);
            }
          }

          // 2. Update player position to the target spawn coordinates
          if (playerEntityId > 0) {
            addComponent(world, playerEntityId, set(Position, { x: targetX, y: targetY }));
          }

          // 3. Spawn new NPC and prop entities from the new map.
          //    Pass defeatedEnemies so previously-defeated enemies are filtered.
          const results = spawnEntities({
            world,
            spawnPoints,
            defeatedEnemies: defeatedEnemies as string[] | undefined,
          });

          // 4. Spawn transition zone trigger entities
          _lastTransitionZones = transitionZones;
          logger.debug('LOAD_MAP', `storing ${transitionZones.length} transition zones`);
          spawnTransitionEntities({ world, transitionZones });

          // 5. Set the new collision grid
          setCollisionGrid(collisionGrid as CollisionGrid);

          // 6. Set camera map bounds and reset tracking for snap
          setMapBounds({ width: mapPixelWidth as number, height: mapPixelHeight as number });
          resetCameraTracking();

          // 7. Notify main thread about the player entity (position updated)
          postMessage({ type: 'ENTITY_CREATED', eid: playerEntityId, tint: 0x00ff88 });

          // 8. Notify main thread about all spawned NPC/prop entities
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

          // 9. Restore the tick loop
          running = wasRunning;

          queueMicrotask(() => {
            postMessage({ type: 'MAP_LOADED' });
          });
        } catch (err) {
          postMessage({
            type: 'ENGINE_ERROR',
            message: `Load map failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      default: {
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
