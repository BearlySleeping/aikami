// packages/frontend/engine/src/game_world.ts
import type { Application, Container } from 'pixi.js';
import { Graphics, Rectangle } from 'pixi.js';
import {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
} from './config/memory_config.ts';
import type { EngineBridge } from './engine_bridge.ts';
import type { PixiAppInstance, PixiAppOptions } from './pixi_app.ts';
import { createPixiApp } from './pixi_app.ts';
import type { GameAiService } from './services/ai_service.ts';
import type { GameApiService } from './services/api_service.ts';
import { dirtyCheckAppearance } from './systems/render_system.ts';
import type { Direction, GameEvent } from './types.ts';

// ---------------------------------------------------------------------------
// GameWorld — worker-based bitECS + PixiJS lifecycle manager
//
// The worker owns the bitECS world and all game systems. The main thread
// owns the PixiJS renderer and the EngineBridge for UI communication.
// Entity state flows worker → main via SharedArrayBuffer (or N-buffer
// Transferable fallback).
// ---------------------------------------------------------------------------

/** Base movement speed in pixels per second — copied from input_system. */
const PLAYER_SPEED = 150;

/** Direction-to-velocity lookup table for keyboard input forwarding. */
const DIRECTION_VELOCITY: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -PLAYER_SPEED },
  down: { x: 0, y: PLAYER_SPEED },
  left: { x: -PLAYER_SPEED, y: 0 },
  right: { x: PLAYER_SPEED, y: 0 },
};

/** Per-entity rendering data stored on the main thread. */
type RenderEntry = {
  /** The PixiJS display object (Graphics or Sprite). */
  displayObject: Container;
  /** Tint color for the entity. */
  tint: number;
  /** When `true`, spatial culling is enabled for this entity. */
  cullable: boolean;
};

/**
 * Metadata for an interactable NPC entity stored on the main thread.
 * Populated when ENTITY_CREATED fires for NPCs.
 */
type NpcMetaEntry = {
  eid: number;
  npcId: string;
  npcName: string;
  personaId: string;
  interactionRadius: number;
  relationshipValue: number;
};

/**
 * Default cell geometry rectangle for filterArea pre-allocation.
 *
 * Assigning a fixed `filterArea` to every character display object
 * avoids per-frame `getBounds()` recalculations inside PixiJS.
 */
const CELL_GEOMETRY_RECT = new Rectangle(0, 0, 32, 32);

/** Callback invoked when the player presses the interact key. */
type InteractRequestCallback = (npc: NpcMetaEntry) => void;

/**
 * Manages the complete game engine lifecycle: PixiJS Application, Web Worker
 * for bitECS simulation, shared memory buffers, and the per-frame render loop.
 *
 * This class is instantiated once per game route. It owns the PixiJS
 * Application and orchestrates the worker. The UI layer interacts with it
 * exclusively through the {@link EngineBridge}.
 *
 * Zero framework imports. Zero reactivity. Pure imperative TypeScript.
 */
class GameWorld {
  /** The PixiJS Application (owns the canvas, ticker, stage). */
  private app: Application | undefined;

  /** The Web Worker running the bitECS simulation. */
  private worker: Worker | undefined;

  /** The engine bridge for UI↔Game communication. */
  private bridge: EngineBridge;

  /** Optional game API service for backend communication. */
  private apiService: GameApiService | undefined;

  /** Optional game AI service for AI-powered features. */
  private aiService: GameAiService | undefined;

  /** The entity ID of the player entity (set from worker ENTITY_CREATED). */
  private playerEntityId = 0;

  /** NPC metadata keyed by entity ID (populated from NPC spawn events). */
  private npcMeta = new Map<number, NpcMetaEntry>();

  /** Global input lock — set true when dialogue/UI is active. */
  private inputLocked = false;

  /** Callback invoked when the interaction key is pressed near an NPC. */
  private interactRequestCallback: InteractRequestCallback | undefined;

  /** Cleanup function for keyboard listeners. */
  private inputTeardown: (() => void) | undefined;

  /** Whether the game loop is currently running. */
  private running = false;

  /** PixiJS ticker callback reference for teardown. */
  private tickerCallback: (() => void) | undefined;

  // -- Buffer state --------------------------------------------------------

  /** Whether shared memory is in use (vs N-buffer fallback). */
  private useSharedMemory = false;

  /** Pool of ArrayBuffers for N-buffer fallback mode. */
  private bufferPool: ArrayBuffer[] = [];

  /** The Float32Array view used for rendering the current frame. */
  private activeRenderView: Float32Array | undefined;

  // -- Render state (main thread) ------------------------------------------

  /** Map of entity ID → render entry (display object + tint). */
  private renderEntries = new Map<number, RenderEntry>();

  /**
   * Creates a new GameWorld (uninitialized).
   *
   * Call {@link initialize} to start the engine. Call {@link destroy} to
   * tear it down and release all resources.
   *
   * @param bridge - The engine bridge for UI↔Game communication.
   * @param apiService - Optional API service for backend communication.
   * @param aiService - Optional AI service for AI-powered features.
   */
  constructor(bridge: EngineBridge, apiService?: GameApiService, aiService?: GameAiService) {
    this.bridge = bridge;
    this.apiService = apiService;
    this.aiService = aiService;
  }

  /**
   * Initializes the game engine: creates the PixiJS application, spawns
   * the simulation worker, allocates shared memory buffers, sets up
   * keyboard input, and starts the render loop.
   *
   * Must be called once after construction.
   *
   * @param options - PixiJS application options (must include a canvas).
   */
  async initialize(options: PixiAppOptions): Promise<void> {
    const { canvas, width, height } = options;

    if (this.app) {
      return;
    }

    // ---- 1. Create PixiJS Application (main thread) -------------------
    const pixiInstance: PixiAppInstance = await createPixiApp({ canvas, width, height });
    this.app = pixiInstance.app;

    // ---- 2. Allocate shared memory buffers ----------------------------
    this.allocateBuffers();

    // ---- 3. Spawn the simulation worker -------------------------------
    await this.spawnWorker(canvas.width, canvas.height);

    // ---- 4. Set up keyboard input (main thread) -----------------------
    this.inputTeardown = this.setupKeyboardInput();

    // ---- 5. Start the render loop (main thread) -----------------------
    const stage = this.app.stage;

    this.tickerCallback = (): void => {
      if (!this.running || !this.app || !this.activeRenderView) {
        return;
      }

      this.updateRenderFromBuffer(this.activeRenderView, stage);
    };

    this.app.ticker.add(this.tickerCallback);
    this.running = true;
  }

  /**
   * Pauses the game loop. Entities and systems remain loaded in the worker.
   */
  pause(): void {
    this.running = false;
  }

  /**
   * Resumes a paused game loop.
   */
  resume(): void {
    this.running = true;
  }

  /**
   * Destroys the game engine: stops the render loop, tears down keyboard
   * input, terminates the worker, destroys the PixiJS application, and
   * releases all buffer references.
   *
   * Call this when the UI component is unmounted to prevent memory
   * leaks and orphaned animation frames.
   */
  destroy(): void {
    // Stop the render loop
    this.running = false;

    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = undefined;
    }

    // Tear down keyboard listeners
    if (this.inputTeardown) {
      this.inputTeardown();
      this.inputTeardown = undefined;
    }

    // Terminate the worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = undefined;
    }

    // Release buffer references
    this.bufferPool = [];
    this.activeRenderView = undefined;

    // Clear render entries
    this.renderEntries.clear();

    // Destroy services
    this.apiService?.destroy();
    this.aiService?.destroy();
    this.apiService = undefined;
    this.aiService = undefined;

    // Destroy PixiJS
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Buffer allocation
  // -----------------------------------------------------------------------

  /**
   * Allocates the shared memory buffers for entity state exchange.
   *
   * When cross-origin isolated: allocates a single SharedArrayBuffer.
   * Fallback: allocates N ArrayBuffers for the transfer cycle.
   */
  private allocateBuffers(): void {
    const firstBuffer = createEngineBuffer(BUFFER_SIZE);
    this.useSharedMemory = firstBuffer instanceof SharedArrayBuffer;

    if (this.useSharedMemory) {
      this.bufferPool = [firstBuffer as ArrayBuffer];
      this.activeRenderView = new Float32Array(firstBuffer as ArrayBuffer);
    } else {
      // Allocate N buffers for the fallback cycle
      this.bufferPool = [firstBuffer as ArrayBuffer];
      for (let i = 1; i < FALLBACK_BUFFER_COUNT; i++) {
        this.bufferPool.push(new ArrayBuffer(BUFFER_SIZE));
      }
      // No active render view yet — first STATE_UPDATE will provide one
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Worker management
  // -----------------------------------------------------------------------

  /**
   * Spawns the simulation worker and posts the INITIALIZE_ENGINE message.
   *
   * @param canvasWidth - Width of the canvas for entity spawn placement.
   * @param canvasHeight - Height of the canvas for entity spawn placement.
   */
  private async spawnWorker(canvasWidth: number, canvasHeight: number): Promise<void> {
    this.worker = new Worker(new URL('./worker/ecs_worker.ts', import.meta.url), {
      type: 'module',
    });

    // Send initialization message with buffers
    this.worker.postMessage({
      type: 'INITIALIZE_ENGINE',
      canvasWidth,
      canvasHeight,
      buffers: this.bufferPool,
    });

    // Set up message listener for worker → main communication
    this.worker.onmessage = (event: MessageEvent): void => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error: ErrorEvent): void => {
      this.bridge.emit({
        type: 'GAME_ERROR',
        message: `Worker error: ${error.message}`,
      });
    };

    // Forward bridge commands to the worker
    this.setupCommandForwarding();
  }

  /**
   * Handles messages received from the simulation worker.
   */
  private handleWorkerMessage(message: { type: string } & Record<string, unknown>): void {
    switch (message.type) {
      case 'STATE_UPDATE': {
        this.handleStateUpdate(message);
        break;
      }

      case 'ENTITY_CREATED': {
        this.handleEntityCreated(message);
        break;
      }

      case 'ENGINE_READY': {
        this.bridge.emit({ type: 'GAME_READY' });
        break;
      }

      case 'ENGINE_ERROR': {
        this.bridge.emit({
          type: 'GAME_ERROR',
          message: message.message as string,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  /**
   * Handles a STATE_UPDATE message from the worker.
   *
   * Swaps the active render view and re-emits bridged events.
   */
  private handleStateUpdate(message: { type: string } & Record<string, unknown>): void {
    if (this.useSharedMemory) {
      // SharedArrayBuffer — render view is already the same memory.
      // No swap needed; main thread reads the same bytes the worker writes.
    } else {
      // N-buffer fallback — the worker transferred ownership of the buffer.
      // Swap the render view and recycle the old buffer.
      const newBuffer = message.buffer as ArrayBuffer | undefined;
      if (!newBuffer) {
        return;
      }

      // Recycle the old render buffer back to the worker
      const oldBuffer = this.bufferPool.shift();
      if (oldBuffer && this.worker) {
        this.worker.postMessage({ type: 'RECYCLE_BUFFER', buffer: oldBuffer }, [oldBuffer]);
      }

      // Add the new buffer to the pool and set as active render view
      this.bufferPool.push(newBuffer);
      this.activeRenderView = new Float32Array(newBuffer);
    }

    // Re-emit events through the bridge
    const events = message.events as GameEvent[] | undefined;
    if (events) {
      for (const gameEvent of events) {
        // Intercept APPEARANCE_CHANGED for composited sprite invalidation
        if (gameEvent.type === 'APPEARANCE_CHANGED') {
          dirtyCheckAppearance(gameEvent.eid, gameEvent.layerIds);
        }
        this.bridge.emit(gameEvent);
      }
    }
  }

  /**
   * Handles an ENTITY_CREATED message from the worker.
   *
   * Creates a PixiJS display object for the entity and registers it
   * in the main-thread render map. For NPCs, also stores NPC metadata.
   */
  private handleEntityCreated(message: { type: string } & Record<string, unknown>): void {
    const eid = message.eid as number;
    const tint = message.tint as number;

    if (eid === undefined || !this.app) {
      return;
    }

    // Track player entity ID (first entity created is the player)
    if (this.playerEntityId === 0) {
      this.playerEntityId = eid;
    } else {
      // Non-player entities are NPCs — store metadata if provided
      const npcData = message.npcData as NpcMetaEntry | undefined;
      if (npcData) {
        this.npcMeta.set(eid, {
          eid,
          npcId: npcData.npcId || `npc_${eid}`,
          npcName: npcData.npcName || 'Unknown',
          personaId: npcData.personaId || 'default',
          interactionRadius: npcData.interactionRadius || 64,
          relationshipValue: npcData.relationshipValue || 0,
        });
      }
    }

    // Create a colored rectangle as the entity's visual representation
    const graphic = new Graphics();
    graphic.rect(0, 0, 32, 32);
    graphic.fill({ color: tint });

    // Per-contract C-032: bypass layout hit-tests for character visuals
    graphic.eventMode = 'none';
    // Pre-assign filter area to avoid per-frame bounds recalc overhead
    graphic.filterArea = CELL_GEOMETRY_RECT;

    this.app.stage.addChild(graphic);

    this.renderEntries.set(eid, {
      displayObject: graphic,
      tint,
      cullable: true,
    });
  }

  /**
   * Sets up forwarding of bridge commands to the worker.
   *
   * When the UI calls bridge.send(), the command is forwarded to the
   * worker via postMessage so the worker can apply it to the bitECS world.
   */
  private setupCommandForwarding(): void {
    // Use the bridge's internal onCommand to intercept commands
    const bridgeWithCommands = this.bridge as unknown as {
      onCommand: (type: string, handler: (cmd: unknown) => void) => () => void;
    };

    if (typeof bridgeWithCommands.onCommand !== 'function') {
      return;
    }

    // Forward MOVE_PLAYER commands
    bridgeWithCommands.onCommand('MOVE_PLAYER', (cmd: unknown) => {
      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'MOVE_PLAYER', direction: (cmd as { direction: Direction }).direction },
      });
    });

    // Forward STOP_PLAYER commands
    bridgeWithCommands.onCommand('STOP_PLAYER', () => {
      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'STOP_PLAYER' },
      });
    });

    // Forward SPAWN_NPC commands
    bridgeWithCommands.onCommand('SPAWN_NPC', (cmd: unknown) => {
      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SPAWN_NPC',
          npcData: (cmd as { npcData: unknown }).npcData,
        },
      });
    });

    // Forward TRIGGER_MACRO commands
    bridgeWithCommands.onCommand('TRIGGER_MACRO', (cmd: unknown) => {
      const macroCmd = cmd as { macro: string; args: string[]; entityId?: number };
      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'TRIGGER_MACRO',
          macro: macroCmd.macro,
          args: macroCmd.args,
          entityId: macroCmd.entityId,
        },
      });
    });
  }

  /**
   * Posts a message to the worker, if it exists.
   */
  private postToWorker(message: Record<string, unknown>): void {
    if (this.worker) {
      this.worker.postMessage(message);
    }
  }

  // -----------------------------------------------------------------------
  // Public: input locking & interaction
  // -----------------------------------------------------------------------

  /**
   * Sets the global input lock state.
   *
   * When `true`, keyboard movement keys (WASD/arrows) are suppressed.
   * Interaction keys ('E', 'Enter') continue to work.
   */
  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
  }

  /** Returns the current input lock state. */
  get isInputLocked(): boolean {
    return this.inputLocked;
  }

  /**
   * Registers a callback for interaction requests.
   *
   * Called when the player presses 'E' or 'Enter' while within
   * interaction range of an NPC.
   */
  onInteractRequest(callback: InteractRequestCallback): void {
    this.interactRequestCallback = callback;
  }

  // -----------------------------------------------------------------------
  // Internal: Keyboard input (main thread)
  // -----------------------------------------------------------------------

  /**
   * Registers keyboard input listeners that forward movement commands
   * to the simulation worker.
   *
   * Movement is suppressed when {@link inputLocked} is `true` (dialogue/UI active).
   * The 'E' and 'Enter' keys trigger the {@link interactRequestCallback}.
   *
   * @returns A cleanup function that removes all listeners.
   */
  private setupKeyboardInput(): () => void {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Interaction key — check for nearby NPCs regardless of lock state
      if (event.key === 'e' || event.key === 'E' || event.key === 'Enter') {
        event.preventDefault();
        this.handleInteractKey();
        return;
      }

      // Block movement keys when input is locked
      if (this.inputLocked) {
        return;
      }

      const direction = keyToDirection(event.key);
      if (!direction) {
        return;
      }

      event.preventDefault();

      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'MOVE_PLAYER', direction },
      });
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (this.inputLocked) {
        return;
      }

      const direction = keyToDirection(event.key);
      if (!direction) {
        return;
      }

      // Only stop if the released key matches the current direction
      const releasedVel = DIRECTION_VELOCITY[direction];
      if (!releasedVel) {
        return;
      }

      // We don't track current velocity on the main thread, so we always
      // send STOP_PLAYER and let the worker decide if stopping is correct.
      // For the MVP this is fine — the worker clears velocity to zero.
      this.postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'STOP_PLAYER' },
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }

  /**
   * Handles the interaction keypress ('E' or 'Enter').
   *
   * Checks squared distance between the player and all registered NPCs.
   * If the player is within interaction range of any NPC, fires the
   * {@link interactRequestCallback}.
   */
  private handleInteractKey(): void {
    if (this.inputLocked || !this.activeRenderView) {
      return;
    }

    // Read player position from the render buffer
    const pOffset = this.playerEntityId * COMPONENT_STRIDE;
    const playerX = this.activeRenderView[pOffset];
    const playerY = this.activeRenderView[pOffset + 1];

    if (playerX === undefined || playerY === undefined) {
      return;
    }

    // Check distance to all NPCs
    for (const [eid, npc] of this.npcMeta) {
      const nOffset = eid * COMPONENT_STRIDE;
      const npcX = this.activeRenderView[nOffset];
      const npcY = this.activeRenderView[nOffset + 1];

      if (npcX === undefined || npcY === undefined) {
        continue;
      }

      const dx = npcX - playerX;
      const dy = npcY - playerY;
      const distSq = dx * dx + dy * dy;
      const radiusSq = npc.interactionRadius * npc.interactionRadius;

      if (distSq <= radiusSq && this.interactRequestCallback) {
        this.interactRequestCallback(npc);
        return;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: Render from buffer
  // -----------------------------------------------------------------------

  /**
   * Updates PixiJS display object positions from the active render buffer.
   *
   * Reads entity positions (x, y) from the Float32Array buffer and applies
   * them to the display objects stored in {@link renderEntries}.
   *
   * Applies spatial culling: entities flagged as `cullable` that are
   * outside the visible stage bounds are hidden (`visible = false`).
   *
   * Runs every frame on the PixiJS ticker (~60fps).
   *
   * @param renderView - The Float32Array view into the active buffer.
   * @param stage - The PixiJS stage container.
   */
  private updateRenderFromBuffer(renderView: Float32Array, stage: Container): void {
    const stageBounds = stage.filterArea ?? stage.getBounds();

    for (const [eid, entry] of this.renderEntries) {
      const offset = eid * COMPONENT_STRIDE;
      const x = renderView[offset];
      const y = renderView[offset + 1];

      if (x === undefined || y === undefined) {
        continue;
      }

      entry.displayObject.x = x;
      entry.displayObject.y = y;

      // Spatial culling for cullable entities
      if (entry.cullable) {
        const isOffScreen =
          x + 32 < stageBounds.x ||
          x > stageBounds.x + stageBounds.width ||
          y + 32 < stageBounds.y ||
          y > stageBounds.y + stageBounds.height;

        entry.displayObject.visible = !isOffScreen;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a KeyboardEvent key to a movement direction.
 *
 * @param key - The `event.key` value.
 * @returns The corresponding direction, or `undefined` if not a movement key.
 */
const keyToDirection = (key: string): Direction | undefined => {
  switch (key) {
    case 'w':
    case 'W':
    case 'ArrowUp':
      return 'up';
    case 's':
    case 'S':
    case 'ArrowDown':
      return 'down';
    case 'a':
    case 'A':
    case 'ArrowLeft':
      return 'left';
    case 'd':
    case 'D':
    case 'ArrowRight':
      return 'right';
    default:
      return undefined;
  }
};

export { GameWorld };
