// packages/frontend/engine/src/game_world.ts
import type { Application } from 'pixi.js';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { BaseEngineClass, type BaseEngineClassOptions } from './base_engine_class.ts';
import type { LpcLayerRecipe } from './components/appearance.ts';
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
import type { TextureManager } from './rendering/texture_manager.ts';
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
  /** Layer recipes for multi-layer rendering. */
  recipes?: LpcLayerRecipe[];
  /** Array of active layer sprites and their loaded base textures. */
  layerSprites?: { sprite: Sprite; recipe: LpcLayerRecipe; texture?: Texture }[];
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

/** Frame width for the LPC walk spritesheet (64x64 per frame). */
// const LPC_FRAME_SIZE = 64;

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
   * Resolves an array of layer IDs to an array of LPC layer recipes.
   * Required for multi-layer dynamic sprite rendering.
   */
  recipeResolver?: (layerIds: readonly number[]) => LpcLayerRecipe[];
  /**
   * Resolves a slot, asset ID, and animation state to a texture URL.
   */
  assetUrlResolver?: (slot: string, assetId: string, state: string) => string;
  /**
   * Texture manager instance for LRU caching and frame slicing.
   */
  textureManager?: TextureManager;
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

  /** Optional API service for backend communication. */
  private _apiService: GameApiService | undefined;

  /** Optional game AI service for AI-powered features. */
  private _aiService: GameAiService | undefined;

  /** Optional factory for creating the worker (Vite ?worker import). */
  private readonly _workerFactory?: () => Worker;

  /** Resolves layer IDs to LPC layer recipes. */
  private readonly _recipeResolver?: (layerIds: readonly number[]) => LpcLayerRecipe[];

  /** Resolves asset URLs. */
  private readonly _assetUrlResolver?: (slot: string, assetId: string, state: string) => string;

  /** Texture manager instance. */
  private readonly _textureManager?: TextureManager;

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
    this._recipeResolver = options.recipeResolver;
    this._assetUrlResolver = options.assetUrlResolver;
    this._textureManager = options.textureManager;
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
    const pixiInstance: PixiAppInstance = await createPixiApp(options);
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
          const entry = this._renderEntries.get(gameEvent.eid);
          if (entry && this._recipeResolver) {
            entry.recipes = this._recipeResolver(gameEvent.layerIds);
            // Fire async load, ignoring promise result.
            void this._loadEntityRecipes(gameEvent.eid, entry.recipes);
          }
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

    // Create an LPC-compatible container.
    // When the first APPEARANCE_CHANGED event arrives, the container will
    // be populated with layer sprites.
    const container = new Container();
    container.width = 48;
    container.height = 48;

    // Per-contract C-032: bypass layout hit-tests for character visuals
    container.eventMode = 'none';

    this._app.stage.addChild(container);
    this.debug('entity-added-to-stage', {
      eid,
      stageChildren: this._app.stage.children.length,
    });

    // Initialize per-entity animation controller for walk/idle state
    const animationController = new AnimationController();

    this._renderEntries.set(eid, {
      displayObject: container,
      animationController,
      tint,
      cullable: true,
      recipes: [],
    });

    // Recipes will be loaded when the first APPEARANCE_CHANGED event arrives.
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

    // Forward SET_PLAYER_VELOCITY commands
    bridgeWithCommands.onCommand('SET_PLAYER_VELOCITY', (cmd: unknown) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_PLAYER_VELOCITY',
          velocity: (cmd as { velocity: { x: number; y: number } }).velocity,
        },
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
    if (locked) {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: 0, y: 0 } },
      });
    }
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
    const activeKeys = new Set<string>();

    const updateVelocity = () => {
      let vx = 0;
      let vy = 0;

      if (activeKeys.has('w') || activeKeys.has('arrowup')) vy -= 1;
      if (activeKeys.has('s') || activeKeys.has('arrowdown')) vy += 1;
      if (activeKeys.has('a') || activeKeys.has('arrowleft')) vx -= 1;
      if (activeKeys.has('d') || activeKeys.has('arrowright')) vx += 1;

      // Normalize diagonal movement to same speed as orthogonal
      if (vx !== 0 && vy !== 0) {
        const length = Math.sqrt(vx * vx + vy * vy);
        vx /= length;
        vy /= length;
      }

      // Base speed is 150 pixels per second
      vx *= 150;
      vy *= 150;

      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: vx, y: vy } },
      });
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      // Interaction key — check for nearby NPCs regardless of lock state
      if (key === 'e' || key === 'enter') {
        event.preventDefault();
        this._handleInteractKey();
        return;
      }

      // Block movement keys when input is locked
      if (this._inputLocked) {
        activeKeys.clear();
        return;
      }

      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault();
        if (!activeKeys.has(key)) {
          activeKeys.add(key);
          updateVelocity();
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      if (activeKeys.has(key)) {
        event.preventDefault();
        activeKeys.delete(key);
        // Only update if not locked, otherwise we already sent {0,0}
        if (!this._inputLocked) {
          updateVelocity();
        }
      }
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
    // Use the actual screen bounds (canvas dimensions) for spatial culling,
    // rather than the stage's bounding box of children.
    const stageBounds = this._app?.screen ?? {
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

      // Apply LPC frame slicing when layer sprites are loaded.
      if (entry.animationController) {
        this._applyLpcFrame(entry, entry.animationController);
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

  /**
   * Initiates async loading of LPC textures for a given entity's recipes.
   * Creates layer sprites on the container once loaded.
   */
  private async _loadEntityRecipes(eid: number, recipes: LpcLayerRecipe[]): Promise<void> {
    const entry = this._renderEntries.get(eid);
    if (!entry || !this._assetUrlResolver) {
      return;
    }

    // We assume container since it's now a Container.
    const container = entry.displayObject as Container;

    // Clear existing sprites.
    if (entry.layerSprites) {
      for (const { sprite } of entry.layerSprites) {
        container.removeChild(sprite);
        sprite.destroy();
      }
    }
    entry.layerSprites = [];

    // Dynamically import Assets to avoid tying the engine to PixiJS asset loader in simple setups
    const { Assets } = await import('pixi.js');
    const stateStr = 'walk'; // default state for engine

    const layerSprites: NonNullable<RenderEntry['layerSprites']> = [];

    // Map recipes to promises. We await them all below.
    const loadPromises = recipes.map(async (recipe) => {
      if (!recipe.assetId) {
        return;
      }

      const url = this._assetUrlResolver?.(recipe.slot ?? 'body', recipe.assetId, stateStr);
      if (!url) {
        return;
      }
      try {
        const texture = await Assets.load(url);
        texture.source.scaleMode = 'nearest';

        const sprite = new Sprite(Texture.WHITE);
        sprite.eventMode = 'none';

        // Apply tint if provided (for placeholder or fallback tinting)
        // Note: For LPC full-color assets we often don't tint, but for fallback we might.
        // We'll skip tinting for now to avoid muddy colors, similar to LpcCharacterRenderer.

        container.addChild(sprite);
        layerSprites.push({ sprite, recipe, texture });
      } catch (err) {
        this.debug('lpc-load-error', { url, error: String(err) });
      }
    });

    await Promise.all(loadPromises);

    // After all loaded, sort by slot standard z-index?
    // Wait, the client handles z-index, but we don't have LPC_LAYER_Z_INDEX here.
    // Assuming the recipes are provided in sorted order by the resolver!
    // We can just rely on the array order. The array order might be scrambled by Promise.all,
    // so let's sort them back to match recipe order.
    layerSprites.sort((a, b) => recipes.indexOf(a.recipe) - recipes.indexOf(b.recipe));

    // Re-add in correct order
    for (const { sprite } of layerSprites) {
      container.addChild(sprite); // Re-adds and bumps to top, effectively sorting them.
    }

    if (this._renderEntries.get(eid) === entry) {
      entry.layerSprites = layerSprites;
    }
  }

  /**
   * Slices the current animation frame from the loaded LPC walk spritesheets
   * and applies them to the layer sprites.
   */
  private _applyLpcFrame(entry: RenderEntry, controller: AnimationController): void {
    if (!entry.layerSprites || entry.layerSprites.length === 0 || !this._textureManager) {
      return;
    }

    const direction = controller.direction;
    const column = controller.getFrameColumn(LPC_WALK_COLUMNS);
    const row = direction as number; // Up=0, Left=1, Down=2, Right=3

    for (const layer of entry.layerSprites) {
      if (!layer.texture) {
        continue;
      }

      const sheet = layer.texture;
      const columns = Math.floor(sheet.width / 64);
      const rows = Math.floor(sheet.height / 64);

      let effectiveRow = row;
      if (rows === 1) {
        effectiveRow = 0;
      }

      const frameCol = column % columns;
      const dynamicFrameIndex = effectiveRow * columns + frameCol;

      const frameTexture = this._textureManager.getFrameAt({
        texture: sheet,
        layout: { frameWidth: 64, frameHeight: 64, columns, rows },
        frameIndex: dynamicFrameIndex,
      });

      if (frameTexture) {
        layer.sprite.texture = frameTexture;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


export { GameWorld };
