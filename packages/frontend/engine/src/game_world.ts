// packages/frontend/engine/src/game_world.ts
import type { Application } from 'pixi.js';
import { Container, Graphics, type Renderer, Sprite, Texture } from 'pixi.js';
import {
  extractCollisionGrid,
  extractSpawnPoints,
  extractTransitionZones,
  loadTilemap,
} from './assets/map_loader.ts';
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
import type { CollisionGrid } from './systems/collision_system.ts';
import { dirtyCheckAppearance } from './systems/render_system.ts';
import { renderTilemap } from './systems/tilemap_render_system.ts';
import type { GameEvent } from './types.ts';
import EcsWorker from './worker/ecs_worker.ts?worker';

// ---------------------------------------------------------------------------
// GameWorld — worker-based bitECS + PixiJS lifecycle manager
//
// The worker owns the bitECS world and all game systems. The main thread
// owns the PixiJS renderer and the EngineBridge for UI communication.
// Entity state flows worker → main via SharedArrayBuffer (or N-buffer
// Transferable fallback).
// ---------------------------------------------------------------------------

/** Base movement speed in pixels per second — copied from input_system. */
// TODO: re-enable when keyboard movement is wired up.
// const PLAYER_SPEED = 150;

/**
 * Direction-to-velocity lookup table for keyboard input forwarding.
 * TODO: re-enable when keyboard movement is wired up.
 */
// const _DIRECTION_VELOCITY: Record<Direction, { x: number; y: number }> = {
//   up: { x: 0, y: -PLAYER_SPEED },
//   down: { x: 0, y: PLAYER_SPEED },
//   left: { x: -PLAYER_SPEED, y: 0 },
//   right: { x: PLAYER_SPEED, y: 0 },
// };

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
  /** Initial greeting dialog text from the NPC's spawn data. */
  dialog: string;
};

/**
 * Default cell geometry rectangle for filterArea pre-allocation.
 *
 * Assigning a fixed `filterArea` to every character display object
 * avoids per-frame `getBounds()` recalculations inside PixiJS.
 * TODO: re-enable when character display filterArea is wired up.
 */
// const _CELL_GEOMETRY_RECT = new Rectangle(0, 0, 48, 48);

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
 * Player initialization data passed from the UI layer to the engine.
 *
 * Carries the active persona's name so the worker can display it
 * and apply character-specific properties to the player entity.
 */
export type PlayerInitData = {
  /** The player character's display name. */
  name: string;
};

/**
 * Initialize options for {@link GameWorld.initialize}.
 */
export type GameWorldInitializeOptions = PixiAppOptions & {
  /** Optional ECS snapshot payload to load (resume saved game). */
  initialPayload?: string;
  /** Optional player data for new-game character initialization. */
  playerData?: PlayerInitData;
  /**
   * Optional collision grid for the current scene.
   *
   * When provided, the worker sets this grid before any entities move,
   * preventing the player from walking through walls or off the map.
   */
  collisionGrid?: CollisionGrid;
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

  /**
   * Master container for all game entities.
   *
   * Scaled 4× for visible pixel-art entities and positioned so (0,0) maps
   * to the center of the canvas. All entities are added to this container
   * instead of the stage directly, which keeps the coordinate origin
   * consistent and enables future camera transforms.
   */
  private _worldContainer: Container | undefined;

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

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraX = 0;

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraY = 0;

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
   * @param options - PixiJS application options + optional engine init params.
   */
  async initialize(options: GameWorldInitializeOptions): Promise<void> {
    const { canvas, initialPayload, playerData } = options;

    if (this._app) {
      return;
    }

    // ---- 1. Create PixiJS Application (main thread) -------------------
    // resizeTo: window ensures the canvas fills the viewport immediately
    // instead of waiting for the parent element's CSS layout to resolve.
    // Without this PixiJS may init at 0×0 when the $effect fires before
    // layout is calculated.
    const pixiInstance: PixiAppInstance = await createPixiApp({
      ...options,
      resizeTo: window,
    });
    this._app = pixiInstance.app;

    // ---- 1a. Build the world container with camera transform ----------
    this._worldContainer = new Container();

    // Scale everything so pixel-art sprites are visible (4× zoom)
    this._worldContainer.scale.set(4);

    // Camera centering is handled dynamically in _updateRenderFromBuffer —
    // it follows the player entity every frame. No static offset here.

    this._app.stage.addChild(this._worldContainer);

    // Draw a debug floor grid for spatial orientation
    this._drawDebugGrid();

    // ---- 2. Allocate shared memory buffers ----------------------------
    this._allocateBuffers();

    // ---- 3. Spawn the simulation worker -------------------------------
    await this._spawnWorker(
      canvas.width,
      canvas.height,
      initialPayload,
      playerData,
      options.collisionGrid,
    );

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
   * Resizes the PixiJS renderer to fill the given dimensions.
   *
   * Called by the ViewModel in response to `window.resize` events
   * so the game canvas always fills the viewport. Also forwards the
   * new screen size to the worker so the camera system can update its
   * clamping bounds and center offset.
   */
  resize(width: number, height: number): void {
    if (this._app) {
      this._app.renderer.resize(width, height);
    }

    // Notify the worker so the camera system updates its screen dimensions
    if (this._worker) {
      this._worker.postMessage({ type: 'SET_SCREEN_SIZE', width, height });
    }
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

    this._worldContainer = undefined;
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
   * @param loadPayload - Optional ECS snapshot to load (bypasses default entities).
   * @param playerData - Optional player data for new-game character initialization.
   */
  private async _spawnWorker(
    canvasWidth: number,
    canvasHeight: number,
    loadPayload?: string,
    playerData?: PlayerInitData,
    collisionGrid?: CollisionGrid,
  ): Promise<void> {
    if (this._workerFactory) {
      this.debug('spawnWorker:using-workerFactory');
      this._worker = this._workerFactory();
    } else {
      // Vite's ?worker import provides a Worker constructor that handles
      // both dev (transpiled TS) and prod (bundled JS) correctly.
      this._worker = new EcsWorker();
      this.debug('spawnWorker:created', { name: EcsWorker.name });
    }

    // Send initialization message with buffers
    const worker = this._worker;
    if (!worker) {
      this.error('spawnWorker: worker is undefined after creation');
      return;
    }

    worker.postMessage({
      type: 'INITIALIZE_ENGINE',
      canvasWidth,
      canvasHeight,
      buffers: this._bufferPool,
      loadPayload,
      playerData,
      collisionGrid,
    });

    // Set up message listener for worker → main communication
    worker.onmessage = (event: MessageEvent): void => {
      this._handleWorkerMessage(event.data);
    };

    worker.onerror = (error: ErrorEvent): void => {
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

    // Register snapshot/restore handlers on the bridge
    this._setupSnapshotHandlers();

    // ZONE_TRIGGERED is handled by the ViewModel (GameUIViewModel) so
    // defeatedEnemies can be threaded from GameStateService into loadMap.
    // This keeps persistence state in the UI layer where it belongs.
  }

  /**
   * Handles messages received from the simulation worker.
   */
  private _handleWorkerMessage(message: { type: string } & Record<string, unknown>): void {
    switch (message.type) {
      case 'SYNC':
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
   * Swaps the active render view, stores the camera position, and
   * re-emits bridged events.
   */
  private _handleStateUpdate(message: { type: string } & Record<string, unknown>): void {
    // Store camera position from the worker for use in the render loop
    if (typeof message.cameraX === 'number') {
      this._cameraX = message.cameraX;
    }
    if (typeof message.cameraY === 'number') {
      this._cameraY = message.cameraY;
    }

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
          this.debug('appearance-changed', {
            eid: gameEvent.eid,
            layers: gameEvent.layerIds.length,
          });
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
          dialog: npcData.dialog || '',
        });
      }
    }

    // Create an LPC-compatible container.
    // When the first APPEARANCE_CHANGED event arrives, the container will
    // be populated with layer sprites.
    //
    // ⚠️  NEVER set .width / .height on an empty Container. PixiJS
    // computes an internal scale multiplier by dividing target width by
    // the container's local bounds — when there are no children the
    // local bounds are (0,0,0,0), producing a scale of 0 (or Infinity),
    // which makes ALL future children invisible.
    const container = new Container();

    // Draw a debug colored square using the worker's tint so entities are
    // visible even before LPC textures load. Uses Sprite(Texture.WHITE)
    // because PixiJS v8 Graphics has compat issues in headless WebGL.
    // Centered 32×32 world units → 128×128 screen pixels at 4× scale.
    const parsedTint =
      typeof tint === 'string' ? Number.parseInt(String(tint).replace('0x', ''), 16) : tint;
    const safeTint =
      typeof parsedTint === 'number' && !Number.isNaN(parsedTint) ? parsedTint : 0xff00ff;
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 32;
    sprite.height = 32;
    sprite.anchor.set(0.5);
    sprite.tint = safeTint;
    container.addChild(sprite);

    // Per-contract C-032: bypass layout hit-tests for character visuals
    container.eventMode = 'none';

    // Add to the world container (scaled + centered) instead of raw stage
    const target = this._worldContainer ?? this._app.stage;
    target.addChild(container);
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

    // Forward SET_GAME_MODE commands (C-140)
    bridgeWithCommands.onCommand('SET_GAME_MODE', (cmd: unknown) => {
      const modeCmd = cmd as { mode: 'EXPLORE' | 'DIALOGUE' | 'MENU' | 'COMBAT' };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_GAME_MODE',
          mode: modeCmd.mode,
        },
      });
    });

    // Forward COMBAT_ACTION commands (C-145)
    bridgeWithCommands.onCommand('COMBAT_ACTION', (cmd: unknown) => {
      const actionCmd = cmd as { action: 'ATTACK' | 'FLEE' | 'DEFEND'; targetId?: number };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'COMBAT_ACTION',
          action: actionCmd.action,
          targetId: actionCmd.targetId,
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
   * Registers snapshot and restore handler callbacks on the engine bridge
   * so the UI can request serialization without direct access to the worker.
   */
  private _setupSnapshotHandlers(): void {
    const bridgeWithHandlers = this._bridge as unknown as {
      setSnapshotHandler: (handler: () => Promise<string>) => void;
      setRestoreHandler: (handler: (snapshot: string) => Promise<void>) => void;
    };

    if (typeof bridgeWithHandlers.setSnapshotHandler === 'function') {
      bridgeWithHandlers.setSnapshotHandler(() => this.snapshotWorld());
    }

    if (typeof bridgeWithHandlers.setRestoreHandler === 'function') {
      bridgeWithHandlers.setRestoreHandler((payload: string) => this.restoreWorld(payload));
    }
  }

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

      if (activeKeys.has('w') || activeKeys.has('arrowup')) {
        vy -= 1;
      }
      if (activeKeys.has('s') || activeKeys.has('arrowdown')) {
        vy += 1;
      }
      if (activeKeys.has('a') || activeKeys.has('arrowleft')) {
        vx -= 1;
      }
      if (activeKeys.has('d') || activeKeys.has('arrowright')) {
        vx += 1;
      }

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
      // Interaction key — only when input is not locked (DIALOGUE/MENU)
      if ((key === 'e' || key === 'enter') && !this._inputLocked) {
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

    if (playerX === undefined || playerY === undefined || (playerX === 0 && playerY === 0)) {
      return;
    }

    const npcCount = this._npcMeta.size;
    if (npcCount === 0) {
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

      if (distSq <= radiusSq) {
        // Emit through the engine bridge for the UI to consume
        this._bridge.emit({
          type: 'NPC_INTERACTED',
          npcId: npc.npcId,
          npcName: npc.npcName,
          dialog: npc.dialog,
          personaId: npc.personaId,
        });

        // Also notify legacy callback consumers (sandbox, interaction_bridge)
        if (this._interactRequestCallback) {
          this._interactRequestCallback(npc);
        }
        return;
      }
    }
  }

  /**
   * Requests a serialized ECS snapshot from the worker.
   *
   * Posts a REQUEST_SNAPSHOT message to the worker and returns a promise
   * that resolves with the JSON payload string. Rejects if the worker
   * is not running or the snapshot fails.
   *
   * @returns The serialized ECS world state as a JSON string.
   */
  snapshotWorld(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker not running — cannot snapshot'));
        return;
      }

      const handler = (event: MessageEvent): void => {
        const message = event.data;
        if (message.type !== 'SNAPSHOT_RESPONSE') {
          return;
        }

        this._worker?.removeEventListener('message', handler);

        if (message.error) {
          reject(new Error(message.error as string));
          return;
        }

        resolve(message.payload as string);
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({ type: 'REQUEST_SNAPSHOT' });
    });
  }

  /**
   * Restores the ECS world from a saved snapshot payload.
   *
   * Clears all current entity display objects from the main-thread render
   * map, then posts a LOAD_GAME message to the worker. The worker clears
   * all bitECS entities, deserializes the snapshot, and posts
   * ENTITY_CREATED messages for each new entity.
   *
   * Resolves when the worker sends ENGINE_READY after the restore.
   *
   * @param payload - The serialized ECS snapshot JSON string.
   * @throws If the worker is not running or the restore fails.
   */
  restoreWorld(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker not running — cannot restore'));
        return;
      }

      // Clear all existing render entries (PixiJS display objects)
      for (const entry of this._renderEntries.values()) {
        entry.displayObject.destroy({ children: true });
      }
      this._renderEntries.clear();
      this._npcMeta.clear();
      this._playerEntityId = 0;

      // Wait for the worker to finish restoring
      const handler = (event: MessageEvent): void => {
        const message = event.data;

        if (message.type === 'ENGINE_ERROR') {
          this._worker?.removeEventListener('message', handler);
          reject(new Error(message.message as string));
          return;
        }

        if (message.type !== 'ENGINE_READY') {
          return;
        }

        this._worker?.removeEventListener('message', handler);
        resolve();
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({ type: 'LOAD_GAME', payload });
    });
  }

  /**
   * Loads a new map at the given URL and places the player at the target
   * coordinates. Orchestrates the full map transition lifecycle:
   *
   * 1. Pauses the engine (stop tick loop + lock input).
   * 2. Clears all existing render entries and tilemap background.
   * 3. Loads and parses the new Tiled JSON tilemap.
   * 4. Extracts collision grid, spawn points, and transition zones.
   * 5. Renders the new tilemap into a RenderTexture-backed Container.
   * 6. Posts a LOAD_MAP message to the worker with all map data.
   * 7. Worker clears non-player entities, updates player position,
   *    spawns new NPCs/props/transitions, sets collision + camera bounds.
   * 8. Resumes the engine and unlocks input when the worker finishes.
   *
   * Called from the {@link EngineBridge} ZONE_TRIGGERED listener.
   *
   * @param mapUrl - URL to the new Tiled JSON tilemap.
   * @param targetX - X pixel coordinate for the player on the new map.
   * @param targetY - Y pixel coordinate for the player on the new map.
   * @throws If the worker is not running or the map fails to load.
   *
   * Contract: C-138 Map Transitions
   */
  async loadMap(
    mapUrl: string,
    targetX: number,
    targetY: number,
    defeatedEnemies?: string[],
  ): Promise<void> {
    this.debug('loadMap', { mapUrl, targetX, targetY });

    // 1. Pause the engine
    this._running = false;
    this.setInputLocked(true);

    // 2. Clear all existing render entries (old map display objects)
    for (const entry of this._renderEntries.values()) {
      entry.displayObject.destroy({ children: true });
    }
    this._renderEntries.clear();
    this._npcMeta.clear();
    this._playerEntityId = 0;

    // 3. Remove old tilemap from the world container
    if (this._worldContainer) {
      const oldTilemap = this._worldContainer.getChildByLabel('tilemap-background');
      if (oldTilemap) {
        this._worldContainer.removeChild(oldTilemap);
        oldTilemap.destroy({ children: true });
      }
    }

    // 4. Load and parse the new tilemap
    const tilemap = await loadTilemap({ url: mapUrl });
    const collisionGridData = extractCollisionGrid(tilemap);
    const spawnPoints = extractSpawnPoints(tilemap);
    const transitionZones = extractTransitionZones(tilemap);

    const mapPixelWidth = tilemap.width * tilemap.tilewidth;
    const mapPixelHeight = tilemap.height * tilemap.tileheight;

    // 5. Render the new tilemap background
    if (this._app && this._worldContainer) {
      const result = await renderTilemap({
        tilemap,
        renderer: this._app.renderer as Renderer,
      });
      // Place at z-index 0 — behind all entity sprites
      this._worldContainer.addChildAt(result.container, 0);
      this.debug('loadMap:tilemap-rendered', { layers: result.layerCount });
    }

    // 6. Post LOAD_MAP to worker and wait for completion
    await this._postLoadMap({
      spawnPoints,
      transitionZones,
      collisionGrid: collisionGridData
        ? {
            width: tilemap.width,
            height: tilemap.height,
            tileSize: tilemap.tilewidth,
            grid: collisionGridData,
          }
        : undefined,
      mapPixelWidth,
      mapPixelHeight,
      targetX,
      targetY,
      defeatedEnemies,
    });

    // 7. Resume the engine
    this._running = true;
    this.setInputLocked(false);

    this.debug('loadMap:complete');
  }

  /**
   * Posts a LOAD_MAP message to the worker and returns a promise that
   * resolves when the worker responds with ENGINE_READY.
   */
  private _postLoadMap(options: {
    spawnPoints: import('./assets/map_loader.ts').SpawnPoint[];
    transitionZones: import('./assets/map_loader.ts').TransitionZone[];
    collisionGrid: CollisionGrid | undefined;
    mapPixelWidth: number;
    mapPixelHeight: number;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker not running — cannot load map'));
        return;
      }

      const handler = (event: MessageEvent): void => {
        const message = event.data;

        if (message.type === 'ENGINE_ERROR') {
          this._worker?.removeEventListener('message', handler);
          reject(new Error(message.message as string));
          return;
        }

        if (message.type !== 'MAP_LOADED') {
          return;
        }

        this._worker?.removeEventListener('message', handler);
        resolve();
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({
        type: 'LOAD_MAP',
        spawnPoints: options.spawnPoints,
        transitionZones: options.transitionZones,
        collisionGrid: options.collisionGrid,
        mapPixelWidth: options.mapPixelWidth,
        mapPixelHeight: options.mapPixelHeight,
        targetX: options.targetX,
        targetY: options.targetY,
        defeatedEnemies: options.defeatedEnemies,
      });
    });
  }

  // -----------------------------------------------------------------------
  // Internal: Debug grid
  // -----------------------------------------------------------------------

  /**
   * Draws a 10×10 tile debug grid centered on the world origin.
   *
   * Each tile is 32×32 world units. With the 4× scale transform on
   * {@link _worldContainer}, tiles appear as 128×128 screen pixels —
   * large enough to be clearly visible. Provides spatial reference
   * during development.
   */
  private _drawDebugGrid(): void {
    if (!this._app || !this._worldContainer) {
      return;
    }

    const grid = new Graphics();
    const strokeColor = 0x33334a;

    const tileSize = 32;
    const tiles = 10;
    const halfExtent = (tiles * tileSize) / 2;

    for (let i = 0; i <= tiles; i++) {
      const pos = i * tileSize - halfExtent;
      // Vertical lines
      grid
        .moveTo(pos, -halfExtent)
        .lineTo(pos, halfExtent)
        .stroke({ width: 1, color: strokeColor });
      // Horizontal lines
      grid
        .moveTo(-halfExtent, pos)
        .lineTo(halfExtent, pos)
        .stroke({ width: 1, color: strokeColor });
    }

    this._worldContainer.addChildAt(grid, 0); // behind all entities
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
  private _updateRenderFromBuffer(renderView: Float32Array, _stage: Container): void {
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

      // Dynamic camera: center the world container on the camera position
      // computed by the CameraSystem in the worker (with lerp + clamping).
      // The old per-player-entity centering is replaced by this global
      // camera transform applied once per frame outside the entity loop.
      // Past this point in _updateRenderFromBuffer, the camera transform
      // is applied after all entity positions are updated.
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

      // Spatial culling: temporaily disabled.
      // FIXME: The math is broken now that the world origin is centered
      // and scaled via _worldContainer. Raw world coordinates can be
      // negative (e.g., player at -100, -100) while the camera centers
      // them on-screen, but this check treats negative coords as off-screen.
      // Hardcoded outside any if-block to guarantee visibility.
      entry.displayObject.visible = true;
      visibleCount++;
    }

    // Camera transform: center the world container at the camera position
    // computed by the CameraSystem in the worker (lerp + clamping).
    // Applied once per frame after all entity display objects are positioned.
    if (this._app && this._worldContainer) {
      this._worldContainer.x =
        this._app.screen.width / 2 - this._cameraX * this._worldContainer.scale.x;
      this._worldContainer.y =
        this._app.screen.height / 2 - this._cameraY * this._worldContainer.scale.y;
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

    entry.layerSprites = [];

    // Dynamically import Assets to avoid tying the engine to PixiJS asset loader in simple setups
    const { Assets } = await import('pixi.js');
    const stateStr = 'walk'; // default state for engine

    const layerSprites: NonNullable<RenderEntry['layerSprites']> = [];
    let texturesLoaded = false;

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

        // Remove debug sprites on first successful texture load
        if (!texturesLoaded) {
          texturesLoaded = true;
          container.removeChildren();
        }

        const sprite = new Sprite(Texture.WHITE);
        sprite.eventMode = 'none';

        container.addChild(sprite);
        layerSprites.push({ sprite, recipe, texture });
      } catch (err) {
        this.debug('lpc-load-error', { url, error: String(err) });
      }
    });

    await Promise.all(loadPromises);

    if (texturesLoaded) {
      this.debug('lpc-loaded', { eid, layers: layerSprites.length });
    }

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
