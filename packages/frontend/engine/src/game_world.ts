// packages/frontend/engine/src/game_world.ts
import type { Application, Container } from 'pixi.js';
import { Rectangle, Sprite, Texture } from 'pixi.js';
import { BaseEngineClass, type BaseEngineClassOptions } from './base_engine_class.ts';
import {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
} from './config/memory_config.ts';
import type { EngineBridge } from './engine_bridge.ts';
import type { PixiAppInstance, PixiAppOptions } from './pixi_app.ts';
import { createPixiApp } from './pixi_app.ts';
import { AnimationController } from './rendering/animation_controller.ts';
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
  /** The PixiJS display object (Sprite or Container). */
  displayObject: Container;
  /**
   * Per-entity animation controller for directional walk/idle.
   *
   * Computes spritesheet frame indices from positional deltas across
   * frames without access to the worker's Velocity component.
   */
  animationController?: AnimationController;
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
const CELL_GEOMETRY_RECT = new Rectangle(0, 0, 48, 48);

/** Frame width for the LPC walk spritesheet (64×64 per frame). */
const LPC_FRAME_SIZE = 64;

/** Number of animation frame columns in the walk spritesheet. */
const LPC_WALK_COLUMNS = 9;

/** Callback invoked when the player presses the interact key. */
type InteractRequestCallback = (npc: NpcMetaEntry) => void;

/**
 * Options for constructing a {@link GameWorld} via {@link GameWorld.create}.
 */
export type GameWorldOptions = BaseEngineClassOptions & {
  /** The engine bridge for UI↔Game communication. */
  bridge: EngineBridge;
  /** Optional API service for backend communication. */
  apiService?: GameApiService;
  /** Optional AI service for AI-powered features. */
  aiService?: GameAiService;
  /**
   * Factory for creating the simulation worker.
   *
   * When omitted, the default {@link new URL('./worker/ecs_worker.ts', import.meta.url)}
   * pattern is used. Provide this when importing via Vite's `?worker` syntax
   * for correct bundling across workspace dependency boundaries.
   */
  workerFactory?: () => Worker;
  /**
   * URL to an LPC walk spritesheet for entity rendering.
   *
   * When provided, entities render as animated LPC character sprites
   * instead of tinted white rectangles. The spritesheet must follow
   * the standard LPC walk layout: N columns × 4 rows (Up/Left/Down/Right)
   * with square frames.
   *
   * Loaded asynchronously — entities show white fallback until the
   * texture resolves.
   */
  spritesheetUrl?: string;
  /**
   * URL to an LPC walk spritesheet for the player entity specifically.
   *
   * When provided alongside {@link spritesheetUrl}, the player entity
   * (first entity created, green tint) uses this spritesheet while all
   * other entities (NPCs, test sprites) use {@link spritesheetUrl}.
   *
   * When only {@link spritesheetUrl} is set, all entities share it.
   * This field has no effect when {@link spritesheetUrl} is not set.
   */
  playerSpritesheetUrl?: string;
};

/**
 * Manages the complete game engine lifecycle: PixiJS Application, Web Worker
 * for bitECS simulation, shared memory buffers, and the per-frame render loop.
 *
 * Instantiate via {@link GameWorld.create}, never with `new`.
 *
 * Zero framework imports. Zero reactivity. Pure imperative TypeScript.
 */
class GameWorld extends BaseEngineClass<GameWorldOptions> {
  /** The engine bridge for UI↔Game communication. */
  private readonly _bridge: EngineBridge;

  /** Optional game API service for backend communication. */
  private _apiService: GameApiService | undefined;

  /** Optional game AI service for AI-powered features. */
  private _aiService: GameAiService | undefined;

  /** Optional factory for creating the worker (Vite ?worker import). */
  private readonly _workerFactory?: () => Worker;

  /** Optional URL to an LPC walk spritesheet for NPC entities. */
  private readonly _spritesheetUrl?: string;

  /** Optional URL to an LPC walk spritesheet for the player entity. */
  private readonly _playerSpritesheetUrl?: string;

  /** LPC walk spritesheet texture for NPCs, loaded asynchronously. */
  private _spritesheetTexture: Texture | undefined;

  /** LPC walk spritesheet texture for the player, loaded asynchronously. */
  private _playerSpritesheetTexture: Texture | undefined;

  /** The PixiJS Application (owns the canvas, ticker, stage). */
  private _app: Application | undefined;

  /** The Web Worker running the bitECS simulation. */
  private _worker: Worker | undefined;

  /** The entity ID of the player entity (set from worker ENTITY_CREATED). */
  private _playerEntityId = 0;

  /** NPC metadata keyed by entity ID (populated from NPC spawn events). */
  private _npcMeta = new Map<number, NpcMetaEntry>();

  /** Global input lock — set true when dialogue/UI is active. */
  private _inputLocked = false;

  /** Callback invoked when the interaction key is pressed near an NPC. */
  private _interactRequestCallback: InteractRequestCallback | undefined;

  /** Cleanup function for keyboard listeners. */
  private _inputTeardown: (() => void) | undefined;

  /** Whether the game loop is currently running. */
  private _running = false;

  /** PixiJS ticker callback reference for teardown. */
  private _tickerCallback: (() => void) | undefined;

  // -- Render debug throttle ---------------------------------------------

  /** Timestamp of the last render frame log (ms). */
  private _lastRenderLog = 0;

  // -- Buffer state --------------------------------------------------------

  /** Whether shared memory is in use (vs N-buffer fallback). */
  private _useSharedMemory = false;

  /** Pool of ArrayBuffers for N-buffer fallback mode. */
  private _bufferPool: ArrayBuffer[] = [];

  /** The Float32Array view used for rendering the current frame. */
  private _activeRenderView: Float32Array | undefined;

  // -- Render state (main thread) ------------------------------------------

  /** Map of entity ID → render entry (display object + tint). */
  private _renderEntries = new Map<number, RenderEntry>();

  /**
   * Do NOT use `new GameWorld()`. Use {@link GameWorld.create} instead.
   *
   * The `.create()` factory wraps the instance with auto-debug proxy.
   */
  constructor(options: GameWorldOptions) {
    super(options);
    this._bridge = options.bridge;
    this._apiService = options.apiService;
    this._aiService = options.aiService;
    this._workerFactory = options.workerFactory;
    this._spritesheetUrl = options.spritesheetUrl;
    this._playerSpritesheetUrl = options.playerSpritesheetUrl;
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

    if (this._app) {
      return;
    }

    // ---- 1. Create PixiJS Application (main thread) -------------------
    const pixiInstance: PixiAppInstance = await createPixiApp({ canvas, width, height });
    this._app = pixiInstance.app;

    // ---- 2. Allocate shared memory buffers ----------------------------
    this._allocateBuffers();

    // ---- 3. Spawn the simulation worker -------------------------------
    await this._spawnWorker(canvas.width, canvas.height);

    // ---- 4. Set up keyboard input (main thread) -----------------------
    this._inputTeardown = this._setupKeyboardInput();

    // ---- 5. Start the render loop (main thread) -----------------------
    const stage = this._app.stage;

    this._tickerCallback = (): void => {
      if (!this._running || !this._app || !this._activeRenderView) {
        return;
      }

      this._updateRenderFromBuffer(this._activeRenderView, stage);
    };

    this._app.ticker.add(this._tickerCallback);
    this._running = true;
  }

  /**
   * Pauses the game loop. Entities and systems remain loaded in the worker.
   */
  pause(): void {
    this._running = false;
  }

  /**
   * Resumes a paused game loop.
   */
  resume(): void {
    this._running = true;
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
    this._running = false;

    if (this._app && this._tickerCallback) {
      this._app.ticker.remove(this._tickerCallback);
      this._tickerCallback = undefined;
    }

    // Tear down keyboard listeners
    if (this._inputTeardown) {
      this._inputTeardown();
      this._inputTeardown = undefined;
    }

    // Terminate the worker
    if (this._worker) {
      this._worker.terminate();
      this._worker = undefined;
    }

    // Release buffer references
    this._bufferPool = [];
    this._activeRenderView = undefined;

    // Clear render entries
    this._renderEntries.clear();

    // Destroy services
    this._apiService?.destroy();
    this._aiService?.destroy();
    this._apiService = undefined;
    this._aiService = undefined;

    // Destroy PixiJS
    if (this._app) {
      this._app.destroy(true, { children: true });
      this._app = undefined;
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
  private _allocateBuffers(): void {
    const firstBuffer = createEngineBuffer(BUFFER_SIZE);
    this._useSharedMemory =
      typeof SharedArrayBuffer !== 'undefined' && firstBuffer instanceof SharedArrayBuffer;

    if (this._useSharedMemory) {
      this._bufferPool = [firstBuffer as ArrayBuffer];
      this._activeRenderView = new Float32Array(firstBuffer as ArrayBuffer);
    } else {
      // Allocate N buffers for the fallback cycle
      this._bufferPool = [firstBuffer as ArrayBuffer];
      for (let i = 1; i < FALLBACK_BUFFER_COUNT; i++) {
        this._bufferPool.push(new ArrayBuffer(BUFFER_SIZE));
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
  private async _spawnWorker(canvasWidth: number, canvasHeight: number): Promise<void> {
    if (this._workerFactory) {
      this.debug('spawnWorker:using-workerFactory');
      this._worker = this._workerFactory();
    } else {
      // Use the direct new Worker(new URL(...)) pattern so Vite's worker
      // plugin detects the worker entry during build and emits a proper
      // .js chunk instead of a .ts file (which gets served as video/mp2t
      // by the preview server).
      this._worker = new Worker(new URL('./worker/ecs_worker.ts', import.meta.url), {
        type: 'module',
      });
      this.debug('spawnWorker:created');
    }

    // Send initialization message with buffers
    this._worker.postMessage({
      type: 'INITIALIZE_ENGINE',
      canvasWidth,
      canvasHeight,
      buffers: this._bufferPool,
    });

    // Set up message listener for worker → main communication
    this._worker.onmessage = (event: MessageEvent): void => {
      this._handleWorkerMessage(event.data);
    };

    this._worker.onerror = (error: ErrorEvent): void => {
      const detail = {
        message: error.message || '(no message)',
        filename: error.filename || '(unknown)',
        lineno: error.lineno,
        colno: error.colno,
      };
      this.error('Worker error', detail);
      this._bridge.emit({
        type: 'GAME_ERROR',
        message: `Worker: ${detail.message} @ ${detail.filename}:${detail.lineno}:${detail.colno}`,
      });
    };

    // Forward bridge commands to the worker
    this._setupCommandForwarding();
  }

  /**
   * Handles messages received from the simulation worker.
   */
  private _handleWorkerMessage(message: { type: string } & Record<string, unknown>): void {
    switch (message.type) {
      case 'STATE_UPDATE': {
        this._handleStateUpdate(message);
        break;
      }

      case 'ENTITY_CREATED': {
        this._handleEntityCreated(message);
        break;
      }

      case 'ENGINE_READY': {
        this._bridge.emit({ type: 'GAME_READY' });
        break;
      }

      case 'ENGINE_ERROR': {
        this._bridge.emit({
          type: 'GAME_ERROR',
          message: message.message as string,
        });

        // Terminate the worker immediately on fatal errors (detached
        // ArrayBuffer cascades, infinite tick-loop failures, etc.).
        // This stops the postMessage flood so the browser event loop
        // can recover. The error surfaced via GAME_ERROR above so
        // the ViewModel can show it to the user.
        this.destroy();
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
  private _handleStateUpdate(message: { type: string } & Record<string, unknown>): void {
    if (this._useSharedMemory) {
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
      const oldBuffer = this._bufferPool.shift();
      if (oldBuffer && this._worker) {
        this._worker.postMessage({ type: 'RECYCLE_BUFFER', buffer: oldBuffer }, [oldBuffer]);
      }

      // Add the new buffer to the pool and set as active render view
      this._bufferPool.push(newBuffer);
      this._activeRenderView = new Float32Array(newBuffer);
    }

    // Re-emit events through the bridge
    const events = message.events as GameEvent[] | undefined;
    if (events) {
      for (const gameEvent of events) {
        // Intercept APPEARANCE_CHANGED for composited sprite invalidation
        if (gameEvent.type === 'APPEARANCE_CHANGED') {
          dirtyCheckAppearance(gameEvent.eid, gameEvent.layerIds);
        }
        this._bridge.emit(gameEvent);
      }
    }
  }

  /**
   * Handles an ENTITY_CREATED message from the worker.
   *
   * Creates a PixiJS display object for the entity and registers it
   * in the main-thread render map. For NPCs, also stores NPC metadata.
   */
  private _handleEntityCreated(message: { type: string } & Record<string, unknown>): void {
    const eid = message.eid as number;
    const tint = message.tint as number;

    if (eid === undefined || !this._app) {
      return;
    }

    this.debug('ENTITY_CREATED', { eid, tint: `0x${tint.toString(16)}` });

    // Track player entity ID (first entity created is the player)
    if (this._playerEntityId === 0) {
      this._playerEntityId = eid;
    } else {
      // Non-player entities are NPCs — store metadata if provided
      const npcData = message.npcData as NpcMetaEntry | undefined;
      if (npcData) {
        this._npcMeta.set(eid, {
          eid,
          npcId: npcData.npcId || `npc_${eid}`,
          npcName: npcData.npcName || 'Unknown',
          personaId: npcData.personaId || 'default',
          interactionRadius: npcData.interactionRadius || 64,
          relationshipValue: npcData.relationshipValue || 0,
        });
      }
    }

    // Create an LPC-compatible sprite using Texture.WHITE as fallback.
    // When TextureManager + LPC sheets are preloaded, the sprite texture
    // will be swapped in via the animation controller's frame index.
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 48;
    sprite.height = 48;
    sprite.tint = tint;

    // Per-contract C-032: bypass layout hit-tests for character visuals
    sprite.eventMode = 'none';
    // Pre-assign filter area to avoid per-frame bounds recalc overhead
    sprite.filterArea = CELL_GEOMETRY_RECT;

    this._app.stage.addChild(sprite);
    this.debug('entity-added-to-stage', {
      eid,
      tint: `0x${tint.toString(16)}`,
      stageChildren: this._app.stage.children.length,
    });

    // Initialize per-entity animation controller for walk/idle state
    const animationController = new AnimationController();

    this._renderEntries.set(eid, {
      displayObject: sprite,
      animationController,
      tint,
      cullable: true,
    });

    // Trigger async spritesheet load on first entity creation.
    // The sprite shows tinted white until the texture resolves, then
    // frame slicing begins in _updateRenderFromBuffer.
    this._loadSpritesheetIfNeeded();
  }

  /**
   * Sets up forwarding of bridge commands to the worker.
   *
   * When the UI calls bridge.send(), the command is forwarded to the
   * worker via postMessage so the worker can apply it to the bitECS world.
   */
  private _setupCommandForwarding(): void {
    // Use the bridge's internal onCommand to intercept commands
    const bridgeWithCommands = this._bridge as unknown as {
      onCommand: (type: string, handler: (cmd: unknown) => void) => () => void;
    };

    if (typeof bridgeWithCommands.onCommand !== 'function') {
      return;
    }

    // Forward MOVE_PLAYER commands
    bridgeWithCommands.onCommand('MOVE_PLAYER', (cmd: unknown) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'MOVE_PLAYER', direction: (cmd as { direction: Direction }).direction },
      });
    });

    // Forward STOP_PLAYER commands
    bridgeWithCommands.onCommand('STOP_PLAYER', () => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'STOP_PLAYER' },
      });
    });

    // Forward SPAWN_NPC commands
    bridgeWithCommands.onCommand('SPAWN_NPC', (cmd: unknown) => {
      this._postToWorker({
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
      this._postToWorker({
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
  private _postToWorker(message: Record<string, unknown>): void {
    if (this._worker) {
      this._worker.postMessage(message);
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
    this._inputLocked = locked;
  }

  /** Returns the current input lock state. */
  get isInputLocked(): boolean {
    return this._inputLocked;
  }

  /**
   * Registers a callback for interaction requests.
   *
   * Called when the player presses 'E' or 'Enter' while within
   * interaction range of an NPC.
   */
  onInteractRequest(callback: InteractRequestCallback): void {
    this._interactRequestCallback = callback;
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
  private _setupKeyboardInput(): () => void {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Interaction key — check for nearby NPCs regardless of lock state
      if (event.key === 'e' || event.key === 'E' || event.key === 'Enter') {
        event.preventDefault();
        this._handleInteractKey();
        return;
      }

      // Block movement keys when input is locked
      if (this._inputLocked) {
        return;
      }

      const direction = keyToDirection(event.key);
      if (!direction) {
        return;
      }

      event.preventDefault();

      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'MOVE_PLAYER', direction },
      });
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (this._inputLocked) {
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
      this._postToWorker({
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
  private _handleInteractKey(): void {
    if (this._inputLocked || !this._activeRenderView) {
      return;
    }

    // Read player position from the render buffer
    const pOffset = this._playerEntityId * COMPONENT_STRIDE;
    const playerX = this._activeRenderView[pOffset];
    const playerY = this._activeRenderView[pOffset + 1];

    if (playerX === undefined || playerY === undefined) {
      return;
    }

    // Check distance to all NPCs
    for (const [eid, npc] of this._npcMeta) {
      const nOffset = eid * COMPONENT_STRIDE;
      const npcX = this._activeRenderView[nOffset];
      const npcY = this._activeRenderView[nOffset + 1];

      if (npcX === undefined || npcY === undefined) {
        continue;
      }

      const dx = npcX - playerX;
      const dy = npcY - playerY;
      const distSq = dx * dx + dy * dy;
      const radiusSq = npc.interactionRadius * npc.interactionRadius;

      if (distSq <= radiusSq && this._interactRequestCallback) {
        this._interactRequestCallback(npc);
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
   * Also drives the per-entity {@link AnimationController} by computing
   * positional deltas across frames. The controller derives facing
   * direction (Up/Left/Down/Right) from the movement vector and
   * transitions between Walk (non-zero delta) and Idle (zero delta)
   * states, returning spritesheet frame indices for texture slicing.
   *
   * Applies spatial culling: entities flagged as `cullable` that are
   * outside the visible stage bounds are hidden (`visible = false`).
   *
   * Runs every frame on the PixiJS ticker (~60fps).
   *
   * @param renderView - The Float32Array view into the active buffer.
   * @param stage - The PixiJS stage container.
   */
  private _updateRenderFromBuffer(renderView: Float32Array, stage: Container): void {
    // Use explicit canvas bounds as fallback when stage.getBounds() returns 0-sized
    // (happens on the first few frames before entities are positioned).
    const rawBounds = stage.filterArea ?? stage.getBounds();
    const stageBounds =
      rawBounds.width > 0 && rawBounds.height > 0
        ? rawBounds
        : {
            x: 0,
            y: 0,
            width: this._app?.canvas.width ?? 800,
            height: this._app?.canvas.height ?? 600,
          };
    let visibleCount = 0;
    let totalCount = 0;

    for (const [eid, entry] of this._renderEntries) {
      totalCount++;
      const offset = eid * COMPONENT_STRIDE;
      const x = renderView[offset];
      const y = renderView[offset + 1];

      if (x === undefined || y === undefined) {
        continue;
      }

      entry.displayObject.x = x;
      entry.displayObject.y = y;

      // Drive per-entity animation controller from positional deltas.
      // The controller computes dx/dy across frames to derive facing
      // direction and walk/idle transitions.
      entry.animationController?.update({ x, y });

      // Apply LPC frame slicing when at least one spritesheet is loaded.
      // _applyLpcFrame selects the right sheet based on entity ID.
      if (
        (this._spritesheetTexture || this._playerSpritesheetTexture) &&
        entry.animationController
      ) {
        this._applyLpcFrame(entry.displayObject as Sprite, entry.animationController, eid);
      }

      // Spatial culling for cullable entities
      if (entry.cullable) {
        const isOffScreen =
          x + 48 < stageBounds.x ||
          x > stageBounds.x + stageBounds.width ||
          y + 48 < stageBounds.y ||
          y > stageBounds.y + stageBounds.height;

        entry.displayObject.visible = !isOffScreen;
      }

      if (entry.displayObject.visible) {
        visibleCount++;
      }
    }

    // Throttled per-second render diagnostic (only when BaseEngineClass.setRenderDebug(true))
    if (totalCount > 0 && performance.now() - this._lastRenderLog > 1000) {
      this._lastRenderLog = performance.now();
      this.render(
        `${visibleCount}/${totalCount} visible, stage ${stageBounds.width}x${stageBounds.height}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Internal: LPC spritesheet loading + frame slicing
  // -----------------------------------------------------------------------

  /** Whether the spritesheet load has been initiated (prevents duplicate loads). */
  private _spritesheetLoadStarted = false;

  /**
   * Initiates async loading of the LPC walk spritesheet.
   *
   * Idempotent — subsequent calls after the first are no-ops. The sprite
   * shows its tinted white fallback until the texture resolves. Once
   * loaded, {@link _applyLpcFrame} begins slicing frames in the render loop.
   */
  private _loadSpritesheetIfNeeded(): void {
    if (this._spritesheetLoadStarted) {
      return;
    }

    this._spritesheetLoadStarted = true;

    // Load NPC spritesheet
    if (this._spritesheetUrl) {
      try {
        this._spritesheetTexture = Texture.from(this._spritesheetUrl);
        this.debug('lpc-spritesheet:npc-loading', { url: this._spritesheetUrl });
      } catch (err) {
        this.debug('lpc-spritesheet:npc-error', { error: String(err) });
      }
    }

    // Load player spritesheet (separate from NPC)
    if (this._playerSpritesheetUrl) {
      try {
        this._playerSpritesheetTexture = Texture.from(this._playerSpritesheetUrl);
        this.debug('lpc-spritesheet:player-loading', { url: this._playerSpritesheetUrl });
      } catch (err) {
        this.debug('lpc-spritesheet:player-error', { error: String(err) });
      }
    }
  }

  /**
   * Slices the current animation frame from the LPC walk spritesheet
   * and applies it to the sprite's texture.
   *
   * Selects the player spritesheet when the entity ID matches
   * {@link _playerEntityId}, otherwise uses the NPC spritesheet.
   * Falls back silently (keeps white tint) when the selected sheet
   * hasn't loaded yet.
   *
   * @param sprite - The PixiJS Sprite to update.
   * @param controller - The entity's animation controller.
   * @param eid - The entity ID, used to select player vs NPC sheet.
   */
  private _applyLpcFrame(sprite: Sprite, controller: AnimationController, eid: number): void {
    const isPlayer = eid === this._playerEntityId;
    const sheet = isPlayer
      ? (this._playerSpritesheetTexture ?? this._spritesheetTexture)
      : this._spritesheetTexture;

    if (!sheet || sheet.width <= 1) {
      return;
    }

    const direction = controller.direction;
    const column = controller.getFrameColumn(LPC_WALK_COLUMNS);

    // Map LpcDirection to spritesheet row
    const row = direction as number; // Up=0, Left=1, Down=2, Right=3

    const frameX = column * LPC_FRAME_SIZE;
    const frameY = row * LPC_FRAME_SIZE;

    // First frame: swap the sprite's texture from WHITE to a spritesheet slice.
    // Subsequent frames: create a new Texture wrapper sharing the same source
    // with an updated frame Rectangle (Texture.frame is readonly in PixiJS v8).
    if (!sprite.texture || sprite.texture === Texture.WHITE) {
      sprite.texture = new Texture({
        source: sheet.source,
        frame: new Rectangle(frameX, frameY, LPC_FRAME_SIZE, LPC_FRAME_SIZE),
      });
      return;
    }

    // Only update when the frame actually changes
    const currentFrame = sprite.texture.frame;
    if (currentFrame.x === frameX && currentFrame.y === frameY) {
      return;
    }

    sprite.texture = new Texture({
      source: sheet.source,
      frame: new Rectangle(frameX, frameY, LPC_FRAME_SIZE, LPC_FRAME_SIZE),
    });
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
