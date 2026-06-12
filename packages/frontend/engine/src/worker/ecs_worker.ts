// packages/frontend/engine/src/worker/ecs_worker.ts
/// <reference lib="webworker" />
import type { World } from 'bitecs';
import { addComponent, createWorld, getComponent, query, set } from 'bitecs';
import { type LpcLayerRecipe, registerAppearanceObservers } from '../components/appearance.ts';
import { registerCombatStatsObservers } from '../components/combat_stats.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpriteObservers } from '../components/sprite.ts';
import { registerTurnOrderObservers } from '../components/turn_order.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { COMPONENT_STRIDE, FALLBACK_BUFFER_COUNT, MAX_ENTITIES } from '../config/memory_config.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { createNPC } from '../entities/create_npc.ts';
import { createPlayer } from '../entities/create_player.ts';
import { createTestSprite } from '../entities/create_test_sprite.ts';
import { SpatialHashGrid } from '../math/spatial_hash_grid.ts';
import { updateContextSystem } from '../systems/context_system.ts';
import { updateDialogTriggers } from '../systems/dialog_trigger_system.ts';
import { enqueueMacro, updateExpressions } from '../systems/expression_system.ts';
import { updateMovement } from '../systems/movement_system.ts';
import {
  animateEntitySystem,
  LpcBatchManager,
  syncAppearanceSystem,
} from '../systems/render_worker.ts';
import type { GameCommand, GameEvent, NPCSpawnData } from '../types.ts';

// ---------------------------------------------------------------------------
// Worker: owns the full bitECS world and system ticking
// ---------------------------------------------------------------------------

// Startup sentinel — confirms the worker module loaded and executed.
// biome-ignore lint/suspicious/noConsole: worker startup diagnostic
console.log('[ecs_worker] Module loaded, ready for INITIALIZE_ENGINE');

// -- Worker-global state ----------------------------------------------------

/** The bitECS world — created once per INITIALIZE_ENGINE. */
let world: World | undefined;

/** The player entity ID, set during initialization. */
let playerEntityId = 0;

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
};

// -- Command handling -------------------------------------------------------

/**
 * Applies a SET_PLAYER_VELOCITY command to the player entity's velocity.
 */
const handleSetPlayerVelocity = (velocity: { x: number; y: number }): void => {
  if (!world) {
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
    case 'INTERACT':
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
    default: {
      break;
    }
  }
};

// -- Worker-side recipe resolver --------------------------------------------

/** Slot name lookup for converting Appearance layer IDs to recipes. */
const WORKER_SLOT_NAMES = ['body', 'hair', 'torso', 'legs', 'feet'] as const;

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
 */
const initializeEngine = (canvasWidth: number, canvasHeight: number): void => {
  // 1. Create the bitECS world
  world = createWorld();

  // 2. Register component observers
  registerPositionObservers(world);
  registerVelocityObservers(world);
  registerSpriteObservers(world);
  registerNPCDialogObservers(world);
  registerAppearanceObservers(world);
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);

  // 3. Create headless LpcBatchManager for slot tracking + fingerprint eval
  //    No createBuffer factory → operates without GPU Buffers in the worker.
  lpcBatchManager = new LpcBatchManager({ maxInstances: 64 });

  // 4. Spawn entities
  playerEntityId = createPlayer(world);
  let testSpriteId = 0;
  if (canvasWidth && canvasHeight) {
    testSpriteId = createTestSprite(world, canvasWidth, canvasHeight);
  }

  // 5. Notify main thread about renderable entities
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

  queueMicrotask(() => {
    postMessage({
      type: 'ENGINE_READY',
    });
  });

  // 6. Start the tick loop (~60fps = 16ms interval)
  running = true;

  // 7. Initialize spatial hash grid (cellSize 50, capacity = MAX_ENTITIES * 2)
  spatialGrid = new SpatialHashGrid({
    cellSize: 50,
    capacity: MAX_ENTITIES * 2,
  });
  positionBuffer = new Float32Array(MAX_ENTITIES * 2);

  setInterval(tickLoop, 16);
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
  updateDialogTriggers(world, playerEntityId, workerBridge);

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
    postMessage({
      type: 'STATE_UPDATE',
      events,
    });
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

    postMessage(
      {
        type: 'STATE_UPDATE',
        buffer,
        events,
      },
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
  // biome-ignore lint/suspicious/noConsole: worker error diagnostic
  console.error('[ecs_worker] Unhandled error:', detail);
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
  // biome-ignore lint/suspicious/noConsole: worker rejection diagnostic
  console.error('[ecs_worker] Unhandled rejection:', message, event.reason);
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
        const { canvasWidth, canvasHeight, buffers } = message;

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

        initializeEngine(canvasWidth, canvasHeight);
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

      default: {
        break;
      }
    }
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: worker handler error diagnostic
    console.error('[ecs_worker] Message handler error:', err);
    postMessage({
      type: 'ENGINE_ERROR',
      message: `Worker handler error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};
