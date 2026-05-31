// packages/engine/src/worker/ecs_worker.ts
/// <reference lib="webworker" />
import type { World } from 'bitecs';
import { addComponent, createWorld, getComponent, query, set } from 'bitecs';
import { registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { NPCDialog } from '../components/npc_dialog.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpriteObservers } from '../components/sprite.ts';
import type { VelocityData } from '../components/velocity.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { COMPONENT_STRIDE, FALLBACK_BUFFER_COUNT, MAX_ENTITIES } from '../config/memory_config.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { createNPC } from '../entities/create_npc.ts';
import { createPlayer } from '../entities/create_player.ts';
import { createTestSprite } from '../entities/create_test_sprite.ts';
import { updateContextSystem } from '../systems/context_system.ts';
import { updateDialogTriggers } from '../systems/dialog_trigger_system.ts';
import { updateMovement } from '../systems/movement_system.ts';
import type { Direction, GameCommand, GameEvent, NPCSpawnData } from '../types.ts';
import type { NPCDialogData } from '../components/npc_dialog.ts';
import type { PositionData } from '../components/position.ts';
import { SpatialHashGrid } from '../math/spatial_hash_grid.ts';
import { MAX_ENTITIES } from '../config/memory_config.ts';

// ---------------------------------------------------------------------------
// Worker: owns the full bitECS world and system ticking
// ---------------------------------------------------------------------------

/**
 * Direction-to-velocity lookup table, mirrored from input_system.ts.
 * The worker applies these directly when it receives a MOVE_PLAYER command.
 */
const PLAYER_SPEED = 150;

const DIRECTION_VELOCITY: Record<Direction, VelocityData> = {
  up: { x: 0, y: -PLAYER_SPEED },
  down: { x: 0, y: PLAYER_SPEED },
  left: { x: -PLAYER_SPEED, y: 0 },
  right: { x: PLAYER_SPEED, y: 0 },
};

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
  triggerMacro(_macro: string, _args: string[]): void {
    // No-op: macros are handled by the main thread
  },
};

// -- Command handling -------------------------------------------------------

/**
 * Applies a MOVE_PLAYER command to the player entity's velocity.
 */
const handleMovePlayer = (direction: Direction): void => {
  if (!world) {
    return;
  }

  const vel = DIRECTION_VELOCITY[direction];
  if (!vel) {
    return;
  }

  addComponent(world, playerEntityId, set(Velocity, vel));
};

/**
 * Applies a STOP_PLAYER command to zero out the player entity's velocity.
 */
const handleStopPlayer = (): void => {
  if (!world) {
    return;
  }

  addComponent(world, playerEntityId, set(Velocity, { x: 0, y: 0 }));
};

/**
 * Handles a SPAWN_NPC command from the main thread.
 */
const handleSpawnNPC = (npcData: NPCSpawnData): void => {
  if (!world) {
    return;
  }

  const eid = createNPC(world, npcData);

  // Notify main thread so it can create a display object
  postMessage({
    type: 'ENTITY_CREATED',
    eid,
    tint: 0xffcc00, // gold tint for NPCs
  });
};

/**
 * Dispatches an incoming GameCommand from the main thread.
 */
const handleBridgeCommand = (command: GameCommand): void => {
  switch (command.type) {
    case 'MOVE_PLAYER': {
      handleMovePlayer(command.direction);
      break;
    }
    case 'STOP_PLAYER': {
      handleStopPlayer();
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
    case 'EXECUTE_COMMAND':
    case 'TRIGGER_MACRO': {
      // These commands are not processed by the worker in the current MVP.
      break;
    }
    default: {
      break;
    }
  }
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

  // 3. Spawn entities
  playerEntityId = createPlayer(world);
  if (canvasWidth && canvasHeight) {
    createTestSprite(world, canvasWidth, canvasHeight);
  }

  // 4. Notify main thread about renderable entities
  // Player (green tint)
  postMessage({
    type: 'ENTITY_CREATED',
    eid: playerEntityId,
    tint: 0x00ff88,
  });

  // Test sprite has eid = playerEntityId + 1 (assuming sequential eid allocation)
  // We send this after a microtask to ensure addEntity has been called
  queueMicrotask(() => {
    postMessage({
      type: 'ENGINE_READY',
    });
  });

  // 5. Start the tick loop (~60fps = 16ms interval)
  running = true;

  // 6. Initialize spatial hash grid (cellSize 50, capacity = MAX_ENTITIES * 2)
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
    // ArrayBuffer fallback — transfer ownership so main thread can read
    const buffer = bufferPool[activeBufferIndex];
    if (!buffer) {
      return;
    }

    // Advance to the next buffer in the pool
    activeBufferIndex = (activeBufferIndex + 1) % FALLBACK_BUFFER_COUNT;
    activeWriteView = new Float32Array(bufferPool[activeBufferIndex]);

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
const populateSpatialGrid = (
  w: World,
  grid: SpatialHashGrid,
  buffer: Float32Array,
): void => {
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

  switch (message.type) {
    case 'INITIALIZE_ENGINE': {
      const { canvasWidth, canvasHeight, buffers } = message;

      // Determine whether we have shared memory
      const firstBuffer = buffers[0] as ArrayBuffer;
      useSharedMemory = firstBuffer instanceof SharedArrayBuffer;

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
      // Main thread has finished reading this buffer — add it back to the pool
      const recycled = message.buffer as ArrayBuffer;
      if (recycled) {
        bufferPool.push(recycled);
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
};
