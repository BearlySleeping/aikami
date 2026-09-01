// packages/frontend/engine/src/game_world.ts

import type { PackConfig } from '@aikami/types';
import type { Application, Spritesheet } from 'pixi.js';
import { Container, Graphics, Sprite, Texture, type UniformGroup } from 'pixi.js';
import { autotileLayers, type TerrainLayerEmission } from './assets/autotile.ts';
import {
  type AssetTagResolver,
  buildCollisionGrid,
  buildTerrainGridForMap,
  extractCollisionGrid,
  extractSpawnPointEntities,
  extractSpawnPoints,
  extractTransitionZones,
  loadJtonMap,
  loadTilemap,
} from './assets/map_loader.ts';
import { BaseEngineClass, type BaseEngineClassOptions } from './base_engine_class.ts';
import type { LpcLayerRecipe } from './components/appearance.ts';
import type { InteractableStateMap } from './components/interactable_state.ts';
import {
  BUFFER_SIZE,
  COMPONENT_STRIDE,
  createEngineBuffer,
  FALLBACK_BUFFER_COUNT,
} from './config/memory_config.ts';
import type { EngineBridge } from './engine_bridge.ts';
import { COLOR_INTERIOR, ENV_UBO_OFFSETS } from './environment/environment_ubo.ts';
import {
  computeInterpolationAlpha,
  copyRenderState,
  interpolateValue,
  unprojectScreenPoint,
} from './frame_pacing.ts';
import {
  createPixiApp,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  type PixiAppInstance,
  type PixiAppOptions,
} from './pixi_app.ts';
import { sanitizeCanvasDimension } from './pixi_init_options.ts';
import { AnimationController } from './rendering/animation_controller.ts';
import { computeEntityZIndex, WORLD_Z_BANDS } from './rendering/layer_bands.ts';
import type { LpcSlotCatalog } from './rendering/lpc_appearance_resolver.ts';
import { resolveLayerDepth } from './rendering/lpc_layer_order.ts';
import { resolveLpcSheetGeometry } from './rendering/lpc_sheet_geometry.ts';
import { snapToDevicePixels } from './rendering/pixel_snap.ts';
import type { PropTextureResolver } from './rendering/prop_texture_resolver.ts';
import type { TextureManager } from './rendering/texture_manager.ts';
import { frustumCullChunks, type TilemapChunk } from './rendering/tilemap_chunk_renderer.ts';
import { WeatherOverlay } from './rendering/weather_overlay.ts';
import type { GameAiService } from './services/ai_service.ts';
import type { GameApiService } from './services/api_service.ts';
import type { CollisionGrid } from './systems/collision_system.ts';
import { keyToDirection } from './systems/keybinding_config.ts';
import { dirtyCheckAppearance } from './systems/render_system.ts';
import { type FrameUvResolver, renderTilemap } from './systems/tilemap_render_system.ts';
import type { GameEvent } from './types.ts';

// Vite ?worker&type=module import for the bootstrap entry point.
//
// MUST NOT be inlined (?worker&inline): the bootstrap dynamic-imports
// ./ecs_worker.ts, and a relative dynamic import cannot resolve inside a
// blob/data-URL worker (no path base) — the module never evaluates and the
// engine silently hangs (LOAD_MAP timeout). A real worker file keeps the
// dynamic-import chunk resolvable at its emitted URL.
//
// The import is lazy (dynamic) so non-Vite runtimes — e.g. bun's test
// runner — can evaluate this module without resolving the `?worker` query
// (Vite-specific syntax). `_spawnWorker` loads the constructor on first use.
type EcsWorkerConstructor = new () => Worker;

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
   * Monotonic spawn order — tie-break for y-depth sorting so equal-Y
   * entities render deterministically without per-frame flicker (C-375 AC-2).
   */
  spawnOrder: number;
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
  layerSprites?: {
    sprite: Sprite;
    recipe: LpcLayerRecipe;
    texture?: Texture;
    spritesheet?: Spritesheet;
  }[];
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
  /** Whether this NPC is a vendor (opens VendorView instead of DialogueOverlay). */
  isVendor: boolean;
  /** Comma-separated list of item IDs sold by this vendor. */
  vendorInventory: string;
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

// C-428: LPC_WALK_COLUMNS removed — column count is now resolved per-sheet
// via resolveLpcSheetGeometry(). The old global was wrong for oversize sheets.

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
   * May return null for unmapped tags — callers degrade gracefully.
   */
  assetUrlResolver?: (slot: string, assetId: string, state: string) => string | null;
  /**
   * Optional provider returning the player's currently equipped items as
   * LPC layer recipes. Invoked whenever the player's appearance changes
   * (initial render + UPDATE_PLAYER_APPEARANCE nudges) and merged on top
   * of the base recipe — equipment slots that overlap base layers (torso,
   * feet) replace them, others are appended.
   *
   * Contract: C-374 Equipment, Armour & Weapon Inventory UI
   */
  equipmentRecipeProvider?: () => readonly LpcLayerRecipe[];
  /**
   * Texture manager instance for LRU caching and frame slicing.
   */
  textureManager?: TextureManager;
  /**
   * Resolves a content-pack prop frame key (e.g. "well.png") to a PixiJS
   * Texture via the parsed spritesheet — deterministic, WebGPU-safe, with
   * `fallbackTile` on missing frames (C-375 AC-1).
   *
   * When omitted, props keep their tinted placeholder and a warning is
   * logged — never the old global TextureCache lookup.
   */
  propFrameResolver?: PropTextureResolver;
  /**
   * Projected LPC slot catalog (C-400) — the six engine slots with their
   * variant asset IDs, forwarded to the simulation worker so the worker's
   * recipe resolver produces the SAME slot/assetId sequences as the main
   * thread. Build via {@link projectLpcCatalog} from the generated catalog.
   */
  lpcCatalog?: readonly LpcSlotCatalog[];
  /**
   * Optional registry-backed tag resolver (C-434). When provided, map and
   * tileset URLs are resolved through the asset registry — cached blob URL,
   * origin URL, or bundled static path — instead of fetching static paths
   * directly.
   */
  resolveTag?: AssetTagResolver;
  /**
   * Optional blob URL release function (C-434). Called after map/tileset
   * bytes are parsed, to revoke refcounted blob URLs acquired via resolveTag.
   */
  releaseUrl?: (url: string) => void;
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
  /**
   * LPC appearance layer indices (1-indexed variant numbers per slot).
   *
   * Order matches the engine slot order: body, hair, torso, legs, feet, head.
   * Each value is a 1-indexed variant number within the corresponding slot's
   * catalog entries. A value of 0 means "no asset for this slot."
   *
   * When omitted, defaults to [1, 1, 1, 1, 1, 95] (basic male human).
   *
   * Contract: C-158 LPC Avatar Integration
   */
  appearanceLayers?: number[];
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

  /** Lazily-loaded Vite `?worker` constructor (see module top comment). */
  private _workerConstructor: EcsWorkerConstructor | undefined;
  /** Set by destroy() so in-flight async init paths can abort early. */
  private _disposed = false;

  /** Resolves layer IDs to LPC layer recipes. */
  private readonly _recipeResolver?: (layerIds: readonly number[]) => LpcLayerRecipe[];

  /** Resolves asset URLs. May return null for unmapped tags. */
  private readonly _assetUrlResolver?: (
    slot: string,
    assetId: string,
    state: string,
  ) => string | null;

  /** Returns the player's equipped items as LPC layer recipes (C-374). */
  private readonly _equipmentRecipeProvider?: () => readonly LpcLayerRecipe[];

  /** Texture manager instance. */
  private readonly _textureManager?: TextureManager;

  /** Projected LPC slot catalog forwarded to the worker (C-400). */
  private readonly _lpcCatalog?: readonly LpcSlotCatalog[];

  /** Registry-backed tag resolver (C-434). */
  private readonly _resolveTag?: AssetTagResolver;
  /** Blob URL release function (C-434). */
  private readonly _releaseUrl?: (url: string) => void;

  /** Weather overlay quad for procedural rain/fog (C-213). */
  private _weatherOverlay: WeatherOverlay | undefined;

  /**
   * Rejects the pending _postLoadMap or restoreWorld promise when the
   * worker crashes. Set by _postLoadMap / restoreWorld, cleared on
   * resolve/reject. Prevents the boot pipeline from hanging forever.
   */
  private _pendingWorkerReject: ((reason: Error) => void) | undefined;

  /** The PixiJS Application (owns the canvas, ticker, stage). */
  private _app: Application | undefined;

  /** The renderer name that was actually initialised (e.g. 'webgl', 'webgpu'). */
  get renderer(): string {
    return this._app?.renderer.name ?? 'unknown';
  }

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

  /**
   * Player's VisionVisible.visibleByMask, forwarded from the worker in
   * STATE_UPDATE and exposed on the debug bridge (C-379 AC-2 E2E).
   */
  private _playerVisibleByMask = 0;

  /**
   * NPC metadata keyed by entity ID.
   *
   * Populated from ENTITY_CREATED messages that carry `npcData` — authored
   * manifest NPCs, restored/hydrated NPCs, and programmatically spawned
   * NPCs all qualify. It is NOT a manifest lookup at read time: unauthored
   * Tiled NPCs (or any entity created with npcData) count too.
   */
  private _npcMeta = new Map<number, NpcMetaEntry>();

  /** Public read-only access to NPC metadata for sandbox ViewModels. */
  get npcMeta(): ReadonlyMap<number, NpcMetaEntry> {
    return this._npcMeta;
  }

  /** Global input lock — set true when dialogue/UI is active. */
  private _inputLocked = false;

  /**
   * Currently held movement keys (WASD/arrows).
   *
   * Hoisted from the _setupKeyboardInput closure so flushInput()
   * can clear them. Without this, the old closure-based approach
   * left activeKeys unreachable from outside the keyboard handler,
   * making the C-332 flushInput() implemention a no-op.
   */
  private _activeKeys = new Set<string>();

  /** Callback invoked when the interaction key is pressed near an NPC. */
  private _interactRequestCallback: InteractRequestCallback | undefined;

  /** Cleanup function for keyboard listeners. */
  private _inputTeardown: (() => void) | undefined;

  /** Whether the game loop is currently running. */
  private _running = false;

  // ── Worker heartbeat (C-332) ──

  /** Heartbeat interval timer handle. */
  private _heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  /** Unsubscribe function for the MAP_LOADED listener. */
  private _mapLoadedUnsubscribe: (() => void) | undefined;

  /** Unsubscribe function for the pointer input listener (C-380). */
  private _pointerInputTeardown: (() => void) | undefined;
  /** Timestamp of the last pong received from the worker (ms). */
  private _lastPongMs = 0;
  /** Number of consecutive missed heartbeats. */
  private _missedHeartbeats = 0;
  /** Heartbeat interval in milliseconds. */
  private static readonly _heartbeatIntervalMs = 2000;
  /** Last known tickCount from the worker (0 if never received). */
  private _lastKnownTickCount = 0;
  /** Baseline tickCount from the previous heartbeat cycle (for stale-tick detection). */
  private _lastCheckedTickCount = 0;
  /** Number of consecutive heartbeat cycles with no tickCount progress. */
  private _staleTickCycles = 0;
  /**
   * N-buffer transfer accounting, for diagnosing a stalled simulation.
   *
   * The worker only increments tickCount *after* it secures a writable
   * buffer, so a tickCount frozen at exactly FALLBACK_BUFFER_COUNT means
   * every buffer was transferred to this thread and none came back — a
   * recycle-path failure, not a dead tick timer. These counters tell the
   * two apart in the stall warning instead of requiring a re-run.
   */
  private _lastWritableBufferCount = -1;
  /** SYNC messages carrying a transferred buffer. */
  private _syncWithBufferCount = 0;
  /** SYNC messages with no buffer (events only) — these never recycle. */
  private _syncWithoutBufferCount = 0;
  /** Buffers posted back to the worker via RECYCLE_BUFFER. */
  private _recycledBufferCount = 0;

  /** PixiJS ticker callback reference for teardown. */
  private _tickerCallback: (() => void) | undefined;

  // -- Render debug throttle ---------------------------------------------

  /** Timestamp of the last render frame log (ms). */
  private _lastRenderLog = 0;

  // -- Buffer state --------------------------------------------------------

  /** Pool of ArrayBuffers for the N-buffer transfer cycle. */
  private _bufferPool: ArrayBuffer[] = [];

  /** The Float32Array view used for rendering the current frame. */
  private _activeRenderView: Float32Array | undefined;

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraX = 0;

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraY = 0;

  /** Current camera zoom received from the worker (1.0–1.5). */
  private _cameraZoom = 1.0;

  // -- C-380: Interpolation state window ----------------------------------

  /**
   * Timing info from the last STATE_UPDATE.
   * Used to derive the interpolation alpha on the main thread.
   */
  private _lastStateTiming: { tick: number; simTimeMs: number; stepMs: number } | undefined;

  /**
   * Previous state buffer — copied before the active buffer is recycled
   * so interpolation has two states to blend between.
   */
  private _previousRenderView: Float32Array | undefined;

  /**
   * Camera position from the previous state, for camera interpolation.
   */
  private _previousCameraX = 0;
  private _previousCameraY = 0;

  /** simTimeMs from the previous state. */
  private _previousSimTimeMs = 0;

  /** Wall-clock timestamp when the current state was received. */
  private _currentStateReceivedAt = 0;

  // -- C-380 AC-6: Cursor feedback ----------------------------------------

  /** Graphics overlay for the tile hover highlight. */
  private _hoverHighlight: Graphics | undefined;

  /** Graphics overlay for the click destination marker. */
  private _destinationMarker: Graphics | undefined;

  /** Last hovered cell coordinates (for dirty-checking). */
  private _lastHoverCell: { cellX: number; cellY: number } | undefined;

  /** Tile size for the active map; undefined until terrain is loaded. */
  private _activeTileSize: number | undefined;

  /** Global uniform group for animation time (C-177). */
  private _tilemapUniforms: UniformGroup | undefined;

  /**
   * Owned tilemap chunk records (C-377 AC-4) — the culler's iteration
   * source. The tilemap chunks live in the scene graph under
   * `_worldContainer`, but culling toggles `mesh.visible` on these
   * records instead of walking/removing children.
   */
  private _tilemapChunks: readonly TilemapChunk[] | undefined;

  /** Last culled/visible chunk counts (render diagnostic, C-377). */
  private _lastCulledChunkCounts: { visible: number; total: number } | undefined;

  // -- Render state (main thread) ------------------------------------------

  /** Map of entity ID → render entry (display object + tint). */
  private _renderEntries = new Map<number, RenderEntry>();

  /**
   * Monotonic spawn counter — increments per ENTITY_CREATED to provide
   * the stable tie-break for the y-depth sort (C-375 AC-2).
   */
  private _entitySpawnCounter = 0;

  /**
   * Per-entity revision counter for appearance loads.
   * Prevents stale async loads from overwriting newer equipment changes.
   */
  private _entityLoadRevisions = new Map<number, number>();

  /**
   * Do NOT use `new GameWorld()`. Use {@link GameWorld.create} instead.
   *
   * The `.create()` factory wraps the instance with auto-debug proxy.
   */
  /**
   * Resolves content-pack prop frames to textures (C-375 AC-1).
   */
  private readonly _propFrameResolver?: PropTextureResolver;

  /**
   * Frame → { anchor } for C-378 AC-7 prop anchoring. Width/height are NOT
   * stored — the sprite is rendered at the resolved texture's native size
   * (0/0 placeholders were unusable zero-sized metadata). Built at loadMap
   * from the resolved pack config; cleared on map switch. Keyed by frame
   * name because the worker message carries the frame, not the propId.
   */
  private _propFrameMeta = new Map<string, { anchorX: number; anchorY: number }>();

  /**
   * Latest environment UBO received from the worker via STATE_UPDATE
   * (C-213). The worker flushes its own module-level UBO each tick; the
   * main thread must read the tint from THIS copy, never from a local
   * environment_system import (that module is not stepped on the main
   * thread — C-378 AC-9).
   */
  private _environmentUbo: Float32Array | undefined;

  /**
   * C-417 AC-2: whether the currently loaded map is an interior whose
   * lighting is independent of the world clock. Set at loadMap from the
   * content-pack manifest's per-map `interior` flag (projected through
   * PackConfig) — never hard-coded per map id. When true, the tilemap
   * ambient tint is pinned to COLOR_INTERIOR instead of following the
   * worker's diurnal UBO.
   */
  private _isInteriorMap = false;

  /**
   * C-378 AC-9: whether the day/night tint has been sampled in screenshot
   * mode. The first ambient value (once the worker UBO arrives) is retained
   * for the whole capture instead of refreshing from the advancing worker
   * UBO, keeping the tint deterministic across runs.
   */
  private _screenshotTintSampled = false;

  /**
   * C-378 AC-9: the last game hour reported by the worker. When it
   * changes, a screenshot tint frozen from the previous hour's UBO is
   * stale — the sample latch is reset so the next ticker frame re-samples
   * from the fresh UBO (the visual runner waits for the hour-confirmed
   * flag before capturing, so the re-sample lands on the requested hour,
   * never the boot hour).
   */
  private _lastReportedGameHour: number | undefined;

  /**
   * Cached result of the `screenshot=true` URL check — computed once, since
   * it cannot change without a page load (C-378 performance pass: the check
   * used to rebuild URLSearchParams on every ticker frame).
   */
  private _visualScreenshotMode: boolean | undefined;

  constructor(options: GameWorldOptions) {
    super(options);
    this._bridge = options.bridge;
    this._apiService = options.apiService;
    this._aiService = options.aiService;
    this._workerFactory = options.workerFactory;
    this._recipeResolver = options.recipeResolver;
    this._assetUrlResolver = options.assetUrlResolver;
    this._equipmentRecipeProvider = options.equipmentRecipeProvider;
    this._textureManager = options.textureManager;
    this._propFrameResolver = options.propFrameResolver;
    this._lpcCatalog = options.lpcCatalog;
    this._resolveTag = options.resolveTag;
    this._releaseUrl = options.releaseUrl;
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
    // layout is calculated. Defaulted here, but NOT forced: a caller that
    // explicitly passes `resizeTo` (own property, even `undefined`) opts
    // out entirely and drives resize() itself — Tauri on WebKitGTK is known
    // to report garbage from window.innerWidth/innerHeight/devicePixelRatio
    // on some hosts, which Pixi's resizeTo:window watcher multiplies into
    // an oversized canvas (silently refused — blank screen, no error). The
    // client sources real dimensions from Tauri's native window API instead.
    //
    // The default is additionally gated on the window actually reporting
    // usable metrics. Pixi's resizeTo watcher calls renderer.resize() with
    // window.innerWidth/innerHeight *directly*, bypassing the sanitizing in
    // resolvePixiInitOptions — so on a host that reports garbage, honouring
    // resizeTo:window would undo a correctly sized init a frame later. This
    // check is deliberately platform-agnostic rather than keyed on an
    // isTauri() probe, which can be wrong or race the webview's injection.
    const hasUsableWindowMetrics =
      typeof window !== 'undefined' &&
      sanitizeCanvasDimension(window.innerWidth, 0) > 0 &&
      sanitizeCanvasDimension(window.innerHeight, 0) > 0;
    if (!hasUsableWindowMetrics) {
      this.warn('[GameWorld] initialize:unusable-window-metrics', {
        innerWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
        innerHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
      });
    }
    const defaultResizeTo = hasUsableWindowMetrics ? window : undefined;
    const resizeTo = Object.hasOwn(options, 'resizeTo') ? options.resizeTo : defaultResizeTo;
    const pixiInstance: PixiAppInstance = await createPixiApp({
      ...options,
      resizeTo,
    });
    this._app = pixiInstance.app;

    // Diagnostic for the WebKitGTK blank-canvas class of bug: WebKit refuses
    // an oversized backing-store allocation *silently*, leaving the canvas at
    // its 300x150 default and rendering every frame into nothing. Comparing
    // the allocated backing store against what the renderer asked for is the
    // only way to notice — nothing throws.
    const { resolution } = this._app.renderer;
    const expectedWidth = Math.round(this._app.renderer.width * resolution);
    const expectedHeight = Math.round(this._app.renderer.height * resolution);
    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      this.error('[GameWorld] initialize:canvas-allocation-refused', {
        requestedWidth: options.width,
        requestedHeight: options.height,
        expectedWidth,
        expectedHeight,
        actualWidth: canvas.width,
        actualHeight: canvas.height,
        resolution,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
        innerWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
        innerHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
        resizeTo: resizeTo === undefined ? 'none' : 'window',
      });
    } else {
      this.debug('[GameWorld] initialize:canvas-allocated', {
        width: canvas.width,
        height: canvas.height,
        resolution,
      });
    }

    // ---- 1a. Build the world container with camera transform ----------
    this._worldContainer = new Container();

    // C-376 AC-4: in-place zIndex depth sort. Entity containers get
    // `zIndex = displayObject.y` (raw float — never rounded) and the world
    // container sorts children with a stable sort, so equal-Y entities
    // resolve ties by insertion order (= spawn order, containers are added
    // once and never reparented). Sibling layers (tilemap, debug grid, zone
    // overlays) use WORLD_Z_BANDS below the entity y-range.
    this._worldContainer.sortableChildren = true;

    // Scale everything so pixel-art sprites are visible (4× zoom)
    this._worldContainer.scale.set(4);

    // C-380 AC-6: Create cursor feedback overlays
    this._hoverHighlight = new Graphics();
    this._hoverHighlight.label = 'hover-highlight';
    this._hoverHighlight.zIndex = WORLD_Z_BANDS.zoneOverlays; // Above tilemap, below entities
    this._hoverHighlight.eventMode = 'none';
    this._hoverHighlight.visible = false;
    this._worldContainer.addChild(this._hoverHighlight);

    this._destinationMarker = new Graphics();
    this._destinationMarker.label = 'destination-marker';
    this._destinationMarker.zIndex = WORLD_Z_BANDS.zoneOverlays;
    this._destinationMarker.eventMode = 'none';
    this._destinationMarker.visible = false;
    this._worldContainer.addChild(this._destinationMarker);

    // Camera centering is handled dynamically in _updateRenderFromBuffer —
    // it follows the player entity every frame. No static offset here.

    this._app.stage.addChild(this._worldContainer);

    // ── C-213 AC-3: Hardcode filterArea and boundsArea on the world
    // container to prevent PixiJS from recursively traversing thousands
    // of tilemap chunk vertices every frame when post-processing filters
    // or scene effects are evaluated.
    if (this._app.screen) {
      this._worldContainer.filterArea = this._app.screen;
      this._app.stage.filterArea = this._app.screen;
      this._app.stage.boundsArea = this._app.screen;
    }

    // Draw a debug floor grid for spatial orientation
    this._drawDebugGrid();

    // ---- 1b. Create weather overlay (C-213) ------------------------
    // Attached to the stage above the world container so rain renders
    // over the game scene. Initially transparent (rain intensity = 0).
    // Skipped in E2E test mode — weather particles are non-deterministic.
    if (!this._isE2ETestMode()) {
      this._weatherOverlay = WeatherOverlay.create({ parent: this._app.stage });
    }

    // ---- 2. Allocate shared memory buffers ----------------------------
    this._allocateBuffers();

    // ---- 3. Spawn the simulation worker -------------------------------
    await this._spawnWorker(
      canvas.width,
      canvas.height,
      initialPayload,
      playerData,
      options.collisionGrid,
      this._lpcCatalog,
    );

    // ---- 4. Set up keyboard input (main thread) -----------------------
    this._inputTeardown = this._setupKeyboardInput();

    // ---- 4b. Set up pointer input (C-380) ------------------------------
    this._pointerInputTeardown = this._setupPointerInput();

    // ---- 5. Start the render loop (main thread) -----------------------
    const stage = this._app.stage;

    this._tickerCallback = (): void => {
      if (!this._running || !this._app || !this._activeRenderView) {
        return;
      }

      // ── C-177: Update uTime for GPU tile animation ──
      // ── C-378 AC-9: update the day/night tint from the worker's UBO ──
      if (this._tilemapUniforms) {
        // C-378 visual determinism: freeze the tile animation clock in
        // screenshot mode (the visual runner always injects `screenshot=true`).
        // Animated water tiles made every capture pixel-different, which busted
        // the VLM cache key and produced independent (flaky) judgements.
        if (!this._isVisualScreenshotMode()) {
          this._tilemapUniforms.uniforms.uTime = performance.now() / 1000;
        }
        // C-378 AC-9: outside screenshot mode the ambient tint follows the
        // live worker UBO every frame. In screenshot mode the FIRST sampled
        // tint is retained for the entire capture — the worker UBO keeps
        // advancing (game time passes), so refreshing it per frame would
        // make the tint non-deterministic across runs.
        const screenshotMode = this._isVisualScreenshotMode();
        if (!screenshotMode || !this._screenshotTintSampled) {
          const tintArr = this._tilemapUniforms.uniforms.uTint as Float32Array | undefined;
          if (tintArr && this._environmentUbo) {
            // C-417 AC-2: interior maps pin their ambient tint to a fixed
            // warm colour so they stay readable regardless of the outdoor
            // clock; outdoor maps follow the worker's diurnal UBO ambient
            // (same factor the rest of the scene uses). Neutral (1,1,1) when
            // the worker hasn't sent a UBO yet (boot) → pixel-identical to
            // an untinted render.
            if (this._isInteriorMap) {
              tintArr[0] = COLOR_INTERIOR[0] ?? 0.82;
              tintArr[1] = COLOR_INTERIOR[1] ?? 0.78;
              tintArr[2] = COLOR_INTERIOR[2] ?? 0.68;
            } else {
              const ambient = this._environmentUbo;
              tintArr[0] = ambient[ENV_UBO_OFFSETS.ambientColor + 0] ?? 1;
              tintArr[1] = ambient[ENV_UBO_OFFSETS.ambientColor + 1] ?? 1;
              tintArr[2] = ambient[ENV_UBO_OFFSETS.ambientColor + 2] ?? 1;
            }
            if (screenshotMode) {
              this._screenshotTintSampled = true;
            }
          }
        }
      }

      this._updateRenderFromBuffer(this._activeRenderView, stage);
    };

    this._app.ticker.add(this._tickerCallback);
    this._running = true;

    // ── C-332: Heartbeat started by GameBootService._stageSpawnEntities ──
    // Deferred until the game is fully booted to prevent false positive
    // stall detection during LOAD_MAP, tilemap loading, and auto-save.

    // ── C-217: E2E test mode — freeze ticker after first render ──
    // When running in deterministic E2E mode, let exactly one ticker
    // frame render, then pause the ticker and expose engine state
    // on window for Playwright assertions.
    if (this._isE2ETestMode()) {
      this._app.ticker.addOnce(() => {
        this._running = false;
        this._exposeEngineState();
      });
    }
  }

  /**
   * Resizes the PixiJS renderer to fill the given dimensions.
   *
   * Called by the ViewModel in response to `window.resize` events
   * so the game canvas always fills the viewport. Also forwards the
   * new screen size and current world container scale to the worker
   * so the camera system can update its clamping bounds with the
   * correct world-to-screen ratio.
   */
  resize(width: number, height: number): void {
    // Resize callers measure the DOM, which lies on some WebKitGTK hosts
    // (negative innerWidth, billions-scale clientWidth). Passing that
    // through wraps to a multi-gigapixel backing store the platform
    // refuses, blanking a canvas that was rendering fine a frame earlier.
    const safeWidth = sanitizeCanvasDimension(width, this._app?.renderer.width ?? DEFAULT_WIDTH);
    const safeHeight = sanitizeCanvasDimension(
      height,
      this._app?.renderer.height ?? DEFAULT_HEIGHT,
    );

    if (this._app) {
      this._app.renderer.resize(safeWidth, safeHeight);
    }

    // Notify the worker so the camera system updates its screen dimensions
    // and recalculates clamping with the active world container scale.
    if (this._worker) {
      this._worker.postMessage({
        type: 'SET_SCREEN_SIZE',
        width: safeWidth,
        height: safeHeight,
        scale: this._worldContainer?.scale.x ?? 4,
      });
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
    // Diagnostic: trace who calls destroy
    this.error('[GameWorld] destroy:called', { stack: new Error().stack });
    // Flag disposal so in-flight async init paths (worker import) abort
    this._disposed = true;
    // Stop the render loop
    this._running = false;

    // ── Clear any pending worker promise so timeouts don't fire after teardown ──
    // Reject any in-flight restoreWorld/postLoadMap operations before clearing
    if (this._pendingWorkerReject) {
      this._pendingWorkerReject(new Error('GameWorld destroyed during pending worker operation'));
      this._pendingWorkerReject = undefined;
    }

    // ── C-332: Stop worker heartbeat ──
    this._stopHeartbeat();

    if (this._app && this._tickerCallback) {
      this._app.ticker.remove(this._tickerCallback);
      this._tickerCallback = undefined;
    }

    // Tear down keyboard listeners
    if (this._inputTeardown) {
      this._inputTeardown();
      this._inputTeardown = undefined;
    }

    // Tear down pointer input (C-380)
    if (this._pointerInputTeardown) {
      this._pointerInputTeardown();
      this._pointerInputTeardown = undefined;
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

    // Destroy weather overlay BEFORE PixiJS app — the overlay mesh is a
    // child of the stage, and destroying the app first would null out the
    // mesh geometry, causing a crash when WeatherOverlay.destroy() runs.
    if (this._weatherOverlay) {
      this._weatherOverlay.destroy();
      this._weatherOverlay = undefined;
    }

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

  // ── C-217: E2E test mode helpers ──────────────────────────────────

  /**
   * Detects whether the engine is running in E2E visual test mode.
   *
   * Checks URL search params (`?e2e=true`) and a global window flag
   * (`window.__AIKAMI_E2E_TEST_MODE__`) set by Playwright before
   * page navigation.
   */
  private _isE2ETestMode(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('e2e') === 'true') {
        return true;
      }
    } catch {
      // window.location may be unavailable (SSR)
    }
    return !!(window as unknown as Record<string, unknown>).__AIKAMI_E2E_TEST_MODE__;
  }

  /**
   * True in visual-screenshot mode (the visual runner always injects
   * `screenshot=true`). Used to freeze time-varying rendering (C-378 visual
   * determinism): the tilemap clock is pinned so animated tiles render
   * identically across runs.
   */
  private _isVisualScreenshotMode(): boolean {
    if (this._visualScreenshotMode !== undefined) {
      return this._visualScreenshotMode;
    }
    if (typeof window === 'undefined') {
      this._visualScreenshotMode = false;
      return false;
    }
    let enabled = false;
    try {
      const params = new URLSearchParams(window.location.search);
      enabled = params.get('screenshot') === 'true';
    } catch {
      // window.location may be unavailable (SSR)
    }
    this._visualScreenshotMode = enabled;
    return enabled;
  }

  /**
   * Exposes engine state on `window.__AIKAMI_ENGINE_STATE__` so Playwright
   * can await specific bitECS conditions before capturing screenshots.
   */
  private _exposeEngineState(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const state = {
      frozen: !this._running,
      entityCount: this._renderEntries.size,
      // C-400 AC-1: spawned NPC count (entities created with npcData — authored
      // manifest NPCs plus restored/programmatic NPCs) — asserted by
      // game_boot.spec.ts against the manifest-derived count.
      npcCount: this._npcMeta.size,
      playerEntityId: this._playerEntityId,
      cameraX: this._cameraX,
      cameraY: this._cameraY,
    } as const;
    (window as unknown as Record<string, unknown>).__AIKAMI_ENGINE_STATE__ = state;
  }

  /**
   * Allocates the N transfer buffers for entity state exchange.
   *
   * The worker writes state into one buffer, transfers ownership to the
   * main thread each tick, and receives the buffer back via
   * RECYCLE_BUFFER. (The former single-SharedArrayBuffer zero-copy path
   * was removed — see docs/gotchas/cross-origin-isolation.md.)
   */
  private _allocateBuffers(): void {
    this._bufferPool = [];
    for (let i = 0; i < FALLBACK_BUFFER_COUNT; i++) {
      this._bufferPool.push(createEngineBuffer(BUFFER_SIZE));
    }
    // No active render view yet — first STATE_UPDATE will provide one
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
    lpcCatalog?: readonly LpcSlotCatalog[],
  ): Promise<void> {
    if (this._workerFactory) {
      this.debug('spawnWorker:using-workerFactory');
      this._worker = this._workerFactory();
    } else {
      if (!this._workerConstructor) {
        try {
          // @ts-expect-error - Vite worker import syntax (?worker&type=module) not recognized by stable tsc
          const workerModule = await import('./worker/ecs_worker_bootstrap.ts?worker&type=module');
          this._workerConstructor = workerModule.default as EcsWorkerConstructor;
        } catch (error) {
          this.error('spawnWorker:import-failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Clean up partial state so initialize() can be retried
          this._workerConstructor = undefined;
          this._worker = undefined;
          throw error;
        }
      }

      // Check if destroy() was called during the await above
      if (this._disposed) {
        this.warn('spawnWorker:aborted-after-import', {
          reason: 'GameWorld was destroyed during worker module import',
        });
        return;
      }

      this._worker = new this._workerConstructor();
      this.debug('spawnWorker:created', { name: this._workerConstructor.name });
    }

    const worker = this._worker;
    if (!worker) {
      this.error('spawnWorker: worker is undefined after creation');
      return;
    }

    // ── Set up error handler BEFORE postMessage so any synchronous
    // module-evaluation error in the worker is captured. ──
    worker.onerror = (error: ErrorEvent): void => {
      const detail = {
        message: error.message || '(no message)',
        filename: error.filename || '(unknown)',
        lineno: error.lineno,
        colno: error.colno,
        errorMessage:
          error.error instanceof Error ? error.error.message : String(error.error ?? 'none'),
        errorStack: error.error instanceof Error ? error.error.stack : undefined,
        errorConstructor: error.error?.constructor?.name ?? 'none',
      };
      this.error('[GameWorld] Worker error', detail);

      // Mark worker as dead so pending operations fail fast

      // Reject any pending load/restore promise so the boot pipeline
      // doesn't hang forever waiting for a crashed worker.
      if (this._pendingWorkerReject) {
        this._pendingWorkerReject(
          new Error(`Worker crashed: ${detail.message} @ ${detail.filename}:${detail.lineno}`),
        );
        this._pendingWorkerReject = undefined;
      }

      this._bridge.emit({
        type: 'GAME_ERROR',
        message: `Worker: ${detail.message} @ ${detail.filename}:${detail.lineno}:${detail.colno}`,
      });
    };

    // ── C-332: Handle worker message serialization errors ──
    worker.onmessageerror = (event: MessageEvent): void => {
      this.error('[GameWorld] Worker message serialization error', {
        data: typeof event.data,
      });
      if (this._pendingWorkerReject) {
        this._pendingWorkerReject(
          new Error('Worker message serialization error — data could not be deserialized'),
        );
        this._pendingWorkerReject = undefined;
      }
      this._bridge.emit({
        type: 'GAME_ERROR',
        message: 'Worker message serialization error — data could not be deserialized',
      });
    };

    // Send initialization message with buffers
    worker.postMessage(
      {
        type: 'INITIALIZE_ENGINE',
        canvasWidth,
        canvasHeight,
        buffers: this._bufferPool,
        loadPayload,
        playerData,
        collisionGrid,
        lpcCatalog,
      },
      // ── RC-1 FIX: Transfer buffers to worker, don't structure-clone ──
      // Without the transferables array, postMessage clones the 3 buffers
      // instead of transferring ownership. This creates 6 distinct buffers
      // — the main thread's 3 originals and the worker's 3 clones — which
      // are completely disjoint pools.
      [...this._bufferPool],
    );
    // Ownership moved to worker — clear main-thread references
    this._bufferPool = [];
    this._activeRenderView = undefined;

    // Set up message listener for worker → main communication
    worker.onmessage = (event: MessageEvent): void => {
      this._handleWorkerMessage(event.data);
    };

    // Forward bridge commands to the worker
    this._setupCommandForwarding();

    // ── C-332: Start heartbeat on first MAP_LOADED ──
    // The heartbeat is deferred until the first map finishes loading because
    // the worker's tick loop is paused/restarted during LOAD_MAP in the boot
    // pipeline. MAP_LOADED signals the game is fully interactive.
    this._mapLoadedUnsubscribe = this._bridge.on('MAP_LOADED', () => {
      if (!this._heartbeatTimer) {
        this._startHeartbeat();
      }
    });

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
        this._pendingWorkerReject = undefined;
        this._bridge.emit({ type: 'GAME_READY' });
        break;
      }

      case 'CAMERA_SNAP': {
        // Immediate camera position update from worker (used after
        // LOAD_GAME to avoid waiting for the next tick-loop sync).
        if (typeof message.x === 'number') {
          this._cameraX = message.x;
        }
        if (typeof message.y === 'number') {
          this._cameraY = message.y;
        }
        break;
      }

      case 'ENGINE_ERROR': {
        if (this._pendingWorkerReject) {
          this._pendingWorkerReject(new Error(message.message as string));
          this._pendingWorkerReject = undefined;
        }
        this._bridge.emit({
          type: 'GAME_ERROR',
          message: message.message as string,
        });
        break;
      }

      case 'ENGINE_FATAL': {
        // ── RC-2: Unrecoverable — terminate the worker ──
        this.error('[GameWorld] ENGINE_FATAL', { message: message.message as string });
        this._bridge.emit({
          type: 'GAME_ERROR',
          message: `FATAL: ${message.message as string}`,
        });

        // Terminate the worker immediately on fatal errors (detached
        // ArrayBuffer cascades, infinite tick-loop failures, etc.).
        // This stops the postMessage flood so the browser event loop
        // can recover.
        this.destroy();
        break;
      }

      case 'DIAGNOSTIC_PING': {
        // Worker module loaded and event loop is alive — confirm liveness.
        this.debug('[GameWorld] worker diagnostic ping received — event loop alive');
        break;
      }

      case 'DIAGNOSTIC_MODULE_LOADED': {
        // Phase 1: bootstrap loaded (ecs_worker_bootstrap.ts)
        this.debug('[GameWorld] worker bootstrap loaded', {
          timestamp: message.timestamp as number,
        });
        break;
      }

      case 'DIAGNOSTIC_WORKER_EVALUATED': {
        // Phase 2: all 56 ECS worker imports resolved successfully
        this.debug('[GameWorld] worker fully evaluated — all imports OK', {
          timestamp: message.timestamp as number,
        });
        break;
      }

      // ── C-332: Worker heartbeat — record pong timestamp ──
      case 'PONG': {
        this._lastPongMs = performance.now();
        this._missedHeartbeats = 0;
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
    const newBuffer = message.buffer as ArrayBuffer | undefined;

    // Preserve the old state before applying the incoming camera and timing.
    // The active buffer is recycled below, so its render data must be copied.
    if (newBuffer && this._activeRenderView) {
      this._previousCameraX = this._cameraX;
      this._previousCameraY = this._cameraY;
      this._previousSimTimeMs = this._lastStateTiming?.simTimeMs ?? 0;
      this._previousRenderView = copyRenderState(this._activeRenderView);
    }

    // C-380 AC-1: Store timing info for interpolation
    if (
      typeof message.tick === 'number' &&
      typeof message.simTimeMs === 'number' &&
      typeof message.stepMs === 'number'
    ) {
      this._lastStateTiming = {
        tick: message.tick as number,
        simTimeMs: message.simTimeMs as number,
        stepMs: message.stepMs as number,
      };
    }

    // Store camera position from the worker for use in the render loop
    if (typeof message.cameraX === 'number') {
      this._cameraX = message.cameraX;
    }
    if (typeof message.cameraY === 'number') {
      this._cameraY = message.cameraY;
    }

    // Store zoom factor for world container scale (C-161)
    if (typeof message.zoom === 'number') {
      this._cameraZoom = message.zoom;
    }

    // N-buffer transfer cycle — the worker transferred ownership of the
    // buffer. Swap the render view and recycle the old buffer. A SYNC-only
    // message (e.g. the post-LOAD_MAP APPEARANCE_CHANGED batch from the
    // worker) carries NO buffer — skip the swap but still process its
    // events below, otherwise the player stays a tinted placeholder square
    // on every portal transition (C-378).
    if (newBuffer) {
      this._syncWithBufferCount++;

      // ── RC-1 FIX: Recycle the outgoing buffer being replaced, not a
      // FIFO shift from a ring buffer that has no relation to what the
      // worker actually owns. After INITIALIZE_ENGINE with transferables,
      // _bufferPool is empty — and even before the fix, the original
      // buffers were clones disconnected from the worker's pool. ──
      const outgoing = this._activeRenderView?.buffer as ArrayBuffer | undefined;
      if (outgoing && outgoing.byteLength > 0 && this._worker) {
        this._worker.postMessage({ type: 'RECYCLE_BUFFER', buffer: outgoing }, [outgoing]);
        this._recycledBufferCount++;
      }

      this._activeRenderView = new Float32Array(newBuffer);
      this._currentStateReceivedAt = performance.now();
    } else {
      this._syncWithoutBufferCount++;
    }

    // ── C-332: Extract tickCount for semantic heartbeat ──
    const ack = message.ack as { tickCount?: number; writableBufferCount?: number } | undefined;
    if (typeof ack?.tickCount === 'number') {
      this._lastKnownTickCount = ack.tickCount;
    }
    if (typeof ack?.writableBufferCount === 'number') {
      this._lastWritableBufferCount = ack.writableBufferCount;
    }

    // C-379 AC-2: forward the player's vision mask onto the debug bridge
    // so E2E can assert the vision system actually marks the player visible.
    if (typeof message.playerVisibleByMask === 'number') {
      this._playerVisibleByMask = message.playerVisibleByMask;
      if (typeof window !== 'undefined') {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | Record<string, unknown>
          | undefined;
        if (debug) {
          debug.playerVisibleByMask = message.playerVisibleByMask;
        }
      }
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
            let recipes = this._recipeResolver(gameEvent.layerIds);
            // C-374: merge equipped items into the player's recipe so the
            // sprite reflects current gear (torso/feet replace the base
            // layer; hat/shoulders/weapon/shield are appended).
            if (gameEvent.eid === this._playerEntityId && this._equipmentRecipeProvider) {
              recipes = this._mergeEquipmentRecipes(recipes, this._equipmentRecipeProvider());
            }
            entry.recipes = recipes;
            // Bump revision to invalidate any in-flight loads for this entity.
            const nextRevision = (this._entityLoadRevisions.get(gameEvent.eid) ?? 0) + 1;
            this._entityLoadRevisions.set(gameEvent.eid, nextRevision);
            // Fire async load, ignoring promise result.
            void this._loadEntityRecipes(gameEvent.eid, recipes, nextRevision);
          }
          dirtyCheckAppearance(gameEvent.eid, gameEvent.layerIds);
        }
        this._bridge.emit(gameEvent);
      }
    }

    // ── Environment state forwarding (C-213) ──
    // Extract the environment UBO data from the STATE_UPDATE message
    // and emit it as an ENVIRONMENT_UPDATED event for the clock HUD
    // and weather overlay.
    const envData = message.environment as Record<string, unknown> | undefined;
    if (envData) {
      // Keep the latest worker UBO for the tilemap day/night tint
      // (C-378 AC-9) — the worker's module-level UBO is not visible here.
      const ubo = envData.ubo as Float32Array | undefined;
      if (ubo) {
        this._environmentUbo = ubo;
      }
      // C-378 AC-9: the worker applied a new game hour — a screenshot tint
      // frozen from the previous hour's UBO no longer matches. Reset the
      // sample latch so the ticker re-samples once the requested hour's UBO
      // is in place (the visual runner waits for the hour-confirmed flag,
      // so the re-sample lands on the requested hour, not the boot hour).
      // Outside screenshot mode the latch is never set — no-op.
      const reportedHour = envData.gameHour as number;
      if (this._lastReportedGameHour !== undefined && this._lastReportedGameHour !== reportedHour) {
        this._screenshotTintSampled = false;
      }
      this._lastReportedGameHour = reportedHour;
      // Update the weather overlay with the fresh UBO data (C-213)
      if (ubo && this._weatherOverlay) {
        this._weatherOverlay.update(ubo);
      }

      this._bridge.emit({
        type: 'ENVIRONMENT_UPDATED',
        gameHour: envData.gameHour as number,
        gameMinute: envData.gameMinute as number,
        gameTimeSeconds: envData.gameTimeSeconds as number,
        windVelocity: envData.windVelocity as number,
        rainIntensity: envData.rainIntensity as number,
      });
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
          isVendor: npcData.isVendor || false,
          vendorInventory: npcData.vendorInventory || '',
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
    // Anchored bottom-center (0.5, 1.0) so the position represents the
    // character's feet — consistent with the LPC layer sprite anchor.
    // 32×32 world units → 128×128 screen pixels at 4× scale.
    const parsedTint =
      typeof tint === 'string' ? Number.parseInt(String(tint).replace('0x', ''), 16) : tint;
    const safeTint =
      typeof parsedTint === 'number' && !Number.isNaN(parsedTint) ? parsedTint : 0xff00ff;
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 32;
    sprite.height = 32;
    sprite.anchor.set(0.5, 1.0);
    sprite.tint = safeTint;
    container.addChild(sprite);

    // Props carry their named atlas frame from the worker — swap the white
    // placeholder for the real tileset sprite (e.g. "well.png"). The atlas
    // spritesheet is preloaded at boot so Texture.from(frame) resolves.
    const frame = message.frame as string | undefined;
    if (frame) {
      void this._loadPropFrameTexture({ eid, frame, container });
    }

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
      spawnOrder: ++this._entitySpawnCounter,
      animationController,
      tint,
      cullable: true,
      recipes: [],
    });

    // Recipes will be loaded when the first APPEARANCE_CHANGED event arrives.
  }

  /**
   * Loads a prop's named atlas frame texture and swaps it into the entity
   * container, replacing the white placeholder sprite.
   *
   * The frame is resolved through the injected {@link PropTextureResolver}
   * (C-375 AC-1) — a parsed spritesheet lookup with `fallbackTile` on miss.
   * Never routes into the LPC head fallback and never renders a white
   * 1×1 placeholder for a frame that is missing from the atlas.
   */
  private async _loadPropFrameTexture(options: {
    eid: number;
    frame: string;
    container: Container;
  }): Promise<void> {
    const { eid, frame, container } = options;
    try {
      const resolution = this._propFrameResolver?.(frame);
      if (!resolution) {
        this.error('prop-frame-texture-missing', {
          eid,
          frame,
          hint: 'No prop frame resolver wired (or atlas not preloaded) — prop keeps its placeholder. Wire createPropFrameResolver() at boot (C-375 AC-1).',
        });
        return;
      }

      // Replace the white placeholder sprite (children = [placeholder]).
      for (const child of [...container.children]) {
        container.removeChild(child);
        child.destroy();
      }

      // C-378 AC-7: render at the texture's native size with the manifest
      // anchor instead of forcing 32×32. Existing 32×32 props are
      // pixel-identical (native width/height are 32 and the default anchor
      // is (0.5, 1.0) — the same values the forced path used). Multi-tile
      // props (e.g. a 32×64 gate) now render at their authored size.
      // Prop COLLISION stays one tile from the foot pixel regardless of art
      // height — that is correct for top-down and must not change here.
      const propMeta = this._propFrameMeta.get(frame) ?? { anchorX: 0.5, anchorY: 1.0 };
      const propSprite = new Sprite(resolution.texture);
      propSprite.width = resolution.texture.width;
      propSprite.height = resolution.texture.height;
      // Bottom-center anchor matches the manifest prop anchors (0.5, 1.0)
      // and the placeholder it replaces. Fallback: manifest default.
      propSprite.anchor.set(propMeta.anchorX, propMeta.anchorY);
      container.addChild(propSprite);

      this.debug('prop-frame-texture-loaded', {
        eid,
        frame,
        source: resolution.source,
        width: resolution.texture.width,
        height: resolution.texture.height,
      });
    } catch (error) {
      this.error('prop-frame-texture-failed', {
        eid,
        frame,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Builds a frame-name → UV-rect resolver for C-378 terrain layers.
   *
   * The terrain autotiler emits frame NAMES (never GIDs). This resolver
   * converts a frame name to an exact UV rect using the pack's spritesheet
   * via the injected prop frame resolver — the same atlas and the same
   * fallback semantics. Missing frames resolve to the pack's fallbackTile
   * (never a blank map, never a URL).
   *
   * The returned resolver exposes the atlas {@link FrameUvResolver.source}
   * its UV rects are computed against, so the renderer can verify the
   * sampled tileset texture is the same source before emitting terrain
   * chunks (a mismatch degrades to the baked ground fallback instead of
   * garbage UV sampling).
   *
   * Returns undefined when no prop resolver is wired (atlas not preloaded)
   * or the probe frame cannot resolve — the renderer then degrades to the
   * legacy baked-GID path.
   */
  private _buildFrameUvResolver(probeFrame: string | undefined): FrameUvResolver | undefined {
    if (!this._propFrameResolver || !probeFrame) {
      return undefined;
    }
    const probe = this._propFrameResolver(probeFrame);
    if (!probe) {
      return undefined;
    }
    const source = probe.texture.source;
    return {
      source,
      resolve: (frame: string) => {
        const resolution = this._propFrameResolver?.(frame);
        if (!resolution) {
          return undefined;
        }
        const tex = resolution.texture;
        // UV rect from the texture's frame rect. PixiJS Texture.frame is the
        // atlas-space rect in pixels; divide by the source size for [0,1] UVs.
        const f = tex.frame;
        const src = tex.source;
        const sourceW = src.width || 1;
        const sourceH = src.height || 1;
        return {
          u0: f.x / sourceW,
          v0: f.y / sourceH,
          u1: (f.x + f.width) / sourceW,
          v1: (f.y + f.height) / sourceH,
        };
      },
    };
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

    // Forward SET_ENTITY_VELOCITY commands (C-212)
    bridgeWithCommands.onCommand('SET_ENTITY_VELOCITY', (cmd: unknown) => {
      const vCmd = cmd as { entityId: number; velocity: { x: number; y: number } };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_ENTITY_VELOCITY',
          entityId: vCmd.entityId,
          velocity: vCmd.velocity,
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
      // C-380 AC-7: Mode changes cancel click-path
      if (modeCmd.mode !== 'EXPLORE') {
        this._cancelClickPath();
      }
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

    // Forward UPDATE_PLAYER_APPEARANCE commands (C-163)
    bridgeWithCommands.onCommand('UPDATE_PLAYER_APPEARANCE', (cmd: unknown) => {
      const appearanceCmd = cmd as { weapon?: string; armor?: string };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'UPDATE_PLAYER_APPEARANCE',
          weapon: appearanceCmd.weapon,
          armor: appearanceCmd.armor,
        },
      });
    });

    // Forward INTERACT commands (C-161 camera zoom)
    bridgeWithCommands.onCommand('INTERACT', (cmd: unknown) => {
      const interactCmd = cmd as { targetEntityId: string };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'INTERACT',
          targetEntityId: interactCmd.targetEntityId,
        },
      });
    });

    // Forward SET_ENVIRONMENT_CONFIG commands (C-213)
    bridgeWithCommands.onCommand('SET_ENVIRONMENT_CONFIG', (cmd: unknown) => {
      const envCmd = cmd as {
        timeScale?: number;
        windVelocity?: number;
        rainIntensity?: number;
        startHour?: number;
      };
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_ENVIRONMENT_CONFIG',
          timeScale: envCmd.timeScale,
          windVelocity: envCmd.windVelocity,
          rainIntensity: envCmd.rainIntensity,
          startHour: envCmd.startHour,
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
      setSnapshotHandler: (handler: (scope?: 'player' | 'world') => Promise<string>) => void;
      setRestoreHandler: (handler: (snapshot: string) => Promise<void>) => void;
    };

    if (typeof bridgeWithHandlers.setSnapshotHandler === 'function') {
      bridgeWithHandlers.setSnapshotHandler((scope?: 'player' | 'world') =>
        this.snapshotWorld(scope),
      );
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
    // Always send zero velocity when lock state changes so the worker
    // has a clean slate — prevents sticky movement persisting across
    // pause/unpause cycles.
    this._postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: 0, y: 0 } },
    });
  }

  /**
   * Flushes all tracked key state and zeroes player velocity.
   *
   * Called when overlays open/close or the window loses focus to
   * prevent key-state poisoning — where the browser's internal key-repeat
   * state survives an overlay transition and subsequent keyDown events
   * are treated as OS repeats (dropped).
   *
   * Contract: C-332 — Prevent key-state poisoning
   */
  flushInput(): void {
    // ── RC-4 FIX: Directly clear _activeKeys (now a field, not a closure var) ──
    this._activeKeys.clear();
    this._postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: 0, y: 0 } },
    });
    this.debug('[GameWorld] flushInput:cleared');
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
  // Internal: Worker heartbeat (C-332)
  // -----------------------------------------------------------------------

  /**
   * Starts the worker heartbeat interval.
   *
   * Sends a PING message every {@link _heartbeatIntervalMs}ms.
   * If the worker fails to respond with PONG within 3 intervals,
   * logs a warning and attempts recovery.
   *
   * Called by {@link GameBootService._stageSpawnEntities} after the
   * game is fully booted and input is unlocked.
   */
  private _startHeartbeat(): void {
    if (this._heartbeatTimer) {
      return;
    }

    this._lastPongMs = performance.now();
    this._missedHeartbeats = 0;
    this._lastKnownTickCount = 0;
    this._lastCheckedTickCount = 0;
    this._staleTickCycles = 0;

    this._heartbeatTimer = setInterval(() => {
      if (!this._worker) {
        return;
      }

      // ── C-332: Semantic heartbeat — check for simulation progress ──
      // The PONG proves message-handler liveness. But the real signal is
      // whether tickCount is advancing. If tickCount stagnates across 3
      // heartbeat cycles while the engine is unpaused, the simulation is
      // stalled — even if PONG answers perfectly.
      const currentTick = this._lastKnownTickCount;
      if (currentTick > 0 && !this._inputLocked) {
        if (currentTick === this._lastCheckedTickCount) {
          this._staleTickCycles++;
        } else {
          this._staleTickCycles = 0;
        }

        if (this._staleTickCycles >= 3) {
          this.warn('[GameWorld] WARN: Simulation stalled — tickCount unchanged for 3 heartbeats', {
            tickCount: currentTick,
            staleCycles: this._staleTickCycles,
            // writableBufferCount 0 => the worker is still ticking but has
            // no buffer to write into (recycle path broken). Non-zero =>
            // the worker has a buffer and simply is not ticking.
            writableBufferCount: this._lastWritableBufferCount,
            syncWithBuffer: this._syncWithBufferCount,
            syncWithoutBuffer: this._syncWithoutBufferCount,
            recycled: this._recycledBufferCount,
          });
          // Escalate: send RESET_TICK_LOOP to the worker
          this._postToWorker({ type: 'RESET_TICK_LOOP' });
          this._staleTickCycles = 0;
        }

        this._lastCheckedTickCount = currentTick;
      }

      // Check for missed PONG heartbeats (connection-level failure)
      const elapsed = performance.now() - this._lastPongMs;
      if (elapsed > GameWorld._heartbeatIntervalMs * 3) {
        this._missedHeartbeats++;
        this.warn('[GameWorld] WARN: Worker engine heartbeat missed!', {
          elapsedMs: Math.round(elapsed),
          missedCount: this._missedHeartbeats,
        });
        this._lastPongMs = performance.now();
      }

      this._postToWorker({ type: 'PING', timestamp: performance.now() });
    }, GameWorld._heartbeatIntervalMs);

    this.debug('[GameWorld] heartbeat:started', {
      intervalMs: GameWorld._heartbeatIntervalMs,
    });
  }

  /**
   * Stops the worker heartbeat interval.
   */
  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
      this.debug('[GameWorld] heartbeat:stopped');
    }
    if (this._mapLoadedUnsubscribe) {
      this._mapLoadedUnsubscribe();
      this._mapLoadedUnsubscribe = undefined;
    }
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
   * C-379 AC-8: movement keys resolve through `keyToDirection`, which reads
   * localStorage on every call, so Settings → Controls rebinds take effect
   * on the next keydown WITHOUT a reload. Legacy arrow keys keep working
   * as unconditional aliases (the pre-contract behaviour), while rebound
   * WASD keys stop responding — the old key does nothing after a rebind.
   *
   * @returns A cleanup function that removes all listeners.
   */
  private _setupKeyboardInput(): () => void {
    // ── RC-4 FIX: Use field-scoped _activeKeys, not closure variable ──

    // ── Input dispatch telemetry — logged every 500ms to avoid spam ──
    let _lastInputLog = 0;
    const _throttledLog = (label: string, detail: Record<string, unknown>): void => {
      const now = performance.now();
      if (now - _lastInputLog > 500) {
        _lastInputLog = now;
        this.debug(label, detail);
      }
    };

    // Legacy arrow aliases — never rebindable, always map to the base
    // direction (preserves pre-C-379 behaviour for arrow users).
    const LegacyArrowDirection: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      arrowup: 'up',
      arrowdown: 'down',
      arrowleft: 'left',
      arrowright: 'right',
    };

    // Direction → unit vector (base speed applied after normalisation).
    const DirectionDelta: Record<'up' | 'down' | 'left' | 'right', { dx: number; dy: number }> = {
      up: { dx: 0, dy: -1 },
      down: { dx: 0, dy: 1 },
      left: { dx: -1, dy: 0 },
      right: { dx: 1, dy: 0 },
    };

    /**
     * Resolves a keyboard key to a movement direction.
     *
     * C-379 AC-8: legacy arrow keys are checked FIRST — they are
     * unconditional aliases for the base directions, so a rebind can never
     * shadow them. `keyToDirection` (the current localStorage bindings) is
     * consulted only when no legacy arrow alias exists (CodeRabbit review,
     * C-379). Returns undefined for non-movement keys.
     */
    const keyToMovementDirection = (key: string): 'up' | 'down' | 'left' | 'right' | undefined => {
      const legacy = LegacyArrowDirection[key];
      if (legacy) {
        return legacy;
      }
      return keyToDirection(key);
    };

    const updateVelocity = () => {
      let vx = 0;
      let vy = 0;

      // Aggregate the held movement directions — rebind-aware (AC-8).
      for (const key of this._activeKeys) {
        const direction = keyToMovementDirection(key);
        if (!direction) {
          continue;
        }
        const delta = DirectionDelta[direction];
        vx += delta.dx;
        vy += delta.dy;
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

      _throttledLog('[GameWorld] dispatchInputToWorker', {
        vector: { x: Math.round(vx), y: Math.round(vy) },
        activeKeys: [...this._activeKeys],
        inputLocked: this._inputLocked,
      });

      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: vx, y: vy } },
      });
    };

    const isMovementKey = (key: string): boolean => keyToMovementDirection(key) !== undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      // ── Skip game keys when focus is in a text input (C-332 AC-fix) ──
      const target = event.target as HTMLElement | null;
      const isInputField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInputField) {
        return;
      }

      // Interaction key — only when input is not locked (DIALOGUE/MENU)
      if ((key === 'e' || key === 'enter') && !this._inputLocked) {
        event.preventDefault();
        this._handleInteractKey();
        return;
      }

      // Block movement keys when input is locked and force-stop velocity.
      if (this._inputLocked) {
        this._activeKeys.clear();
        if (isMovementKey(key)) {
          _throttledLog('[GameWorld] inputSuppressed:inputLocked', {
            key,
            reason: 'inputLocked',
          });
          updateVelocity();
        }
        return;
      }

      if (isMovementKey(key)) {
        event.preventDefault();
        // C-380 AC-7: Keyboard movement cancels click-path
        this._cancelClickPath();
        if (!this._activeKeys.has(key)) {
          this._activeKeys.add(key);
          updateVelocity();
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      // ── Also skip game keys in text input fields ──
      const target = event.target as HTMLElement | null;
      const isInputField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInputField) {
        return;
      }

      if (this._activeKeys.has(key)) {
        event.preventDefault();
        this._activeKeys.delete(key);
        updateVelocity();
      }
    };

    // ── RC-4 FIX: Window blur handled here so it's torn down with
    // the other keyboard listeners (Path B). Previously the blur handler
    // lived in game_ui_view_model (Path A) — a separate lifecycle. ──
    const handleBlur = (): void => {
      this._activeKeys.clear();
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_PLAYER_VELOCITY', velocity: { x: 0, y: 0 } },
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }

  // -----------------------------------------------------------------------
  // C-380 AC-4/5: Pointer input — click-to-move
  // -----------------------------------------------------------------------

  /**
   * Sets up a canvas-level pointer listener for click-to-move.
   *
   * Uses one canvas-level listener + inverse camera transform instead of
   * PixiJS hit-testing (the scene is deliberately `eventMode: 'none'`
   * throughout — C-032).
   *
   * On click, unprojects the screen coordinate to a world cell and posts
   * a MOVE_TO_CELL command to the worker. The worker resolves the actual
   * intent (walk / interact / portal / reject) from its grids.
   *
   * @returns A cleanup function that removes the listener.
   */
  private _setupPointerInput(): () => void {
    const canvas = this._app?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) {
      this.warn('[GameWorld] _setupPointerInput:no-canvas');
      return () => {};
    }

    const getCanvasCoords = (event: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      if (this._inputLocked) {
        return;
      }
      if (!this._running || !this._activeRenderView) {
        return;
      }

      const { x: screenX, y: screenY } = getCanvasCoords(event);
      const { cellX, cellY } = this.screenToCell(screenX, screenY);

      this.debug('[GameWorld] pointerDown', { screenX, screenY, cellX, cellY });

      // Show destination marker
      this._showDestinationMarker(cellX, cellY);

      // Post MOVE_TO_CELL to the worker
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'MOVE_TO_CELL',
          cellX,
          cellY,
          arriveRadius: 0,
        },
      });
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (this._inputLocked) {
        return;
      }
      if (!this._running || !this._activeRenderView) {
        return;
      }

      const { x: screenX, y: screenY } = getCanvasCoords(event);
      const { cellX, cellY } = this.screenToCell(screenX, screenY);

      // Throttle to cell changes only
      if (this._lastHoverCell?.cellX === cellX && this._lastHoverCell?.cellY === cellY) {
        return;
      }
      this._lastHoverCell = { cellX, cellY };

      this._updateHoverHighlight(cellX, cellY);
    };

    const handlePointerLeave = (): void => {
      this._lastHoverCell = undefined;
      if (this._hoverHighlight) {
        this._hoverHighlight.visible = false;
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);

    return (): void => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }

  // -----------------------------------------------------------------------
  // C-380 AC-6: Cursor feedback helpers
  // -----------------------------------------------------------------------

  /**
   * Updates the hover highlight to show the target cell.
   * Draws a semi-transparent rectangle at the cell position in world space.
   */
  private _updateHoverHighlight(cellX: number, cellY: number): void {
    if (!this._hoverHighlight) {
      return;
    }

    const tileSize = this._activeTileSize ?? 32;
    const worldX = cellX * tileSize;
    const worldY = cellY * tileSize;

    this._hoverHighlight.clear();
    this._hoverHighlight.rect(worldX, worldY, tileSize, tileSize);
    this._hoverHighlight.fill({ color: 0xffffff, alpha: 0.2 });
    this._hoverHighlight.rect(worldX, worldY, tileSize, tileSize);
    this._hoverHighlight.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
    this._hoverHighlight.visible = true;
  }

  /**
   * Shows a destination marker at the clicked cell.
   * Draws a small crosshair or dot at the cell center.
   */
  private _showDestinationMarker(cellX: number, cellY: number): void {
    if (!this._destinationMarker) {
      return;
    }

    const tileSize = this._activeTileSize ?? 32;
    const centerX = cellX * tileSize + tileSize / 2;
    const centerY = cellY * tileSize + tileSize / 2;

    this._destinationMarker.clear();
    // Draw a crosshair
    const crossSize = 6;
    this._destinationMarker.moveTo(centerX - crossSize, centerY);
    this._destinationMarker.lineTo(centerX + crossSize, centerY);
    this._destinationMarker.moveTo(centerX, centerY - crossSize);
    this._destinationMarker.lineTo(centerX, centerY + crossSize);
    this._destinationMarker.stroke({ width: 2, color: 0x00ff88, alpha: 0.9 });
    this._destinationMarker.visible = true;
  }

  // -----------------------------------------------------------------------
  // C-380 AC-7: Click-path cancellation
  // -----------------------------------------------------------------------

  /**
   * Cancels the active click-to-move path.
   * Called when the player presses a movement key, or the game mode
   * changes to DIALOGUE/COMBAT/MENU.
   */
  private _cancelClickPath(): void {
    if (this._destinationMarker) {
      this._destinationMarker.visible = false;
    }
    // Post STOP_PLAYER to clear any active PathFollow goal
    this._postToWorker({
      type: 'BRIDGE_COMMAND',
      command: { type: 'STOP_PLAYER' },
    });
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
        // Vendor NPCs open the trading UI; non-vendor NPCs open dialogue
        if (npc.isVendor) {
          this.debug('_handleInteractKey:vendor-interacted', {
            npcId: npc.npcId,
            npcName: npc.npcName,
            vendorInventory: npc.vendorInventory,
          });
          this._bridge.emit({
            type: 'VENDOR_INTERACTED',
            npcId: npc.npcId,
            npcName: npc.npcName,
            dialog: npc.dialog,
            vendorInventory: npc.vendorInventory,
          });
        } else {
          this._bridge.emit({
            type: 'NPC_INTERACTED',
            npcId: npc.npcId,
            npcName: npc.npcName,
            dialog: npc.dialog,
            personaId: npc.personaId,
          });
        }

        // Also notify callback consumers (sandbox, interaction_bridge)
        if (this._interactRequestCallback) {
          this._interactRequestCallback(npc);
        }
        return;
      }
    }
  }

  /**
   * Returns the player's current world-space pixel position, or undefined
   * if the engine has not booted yet.
   *
   * Used by the save pipeline to persist exact coordinates in the envelope
   * map block (v3+). Reads the active render buffer directly.
   */
  getPlayerPosition(): { x: number; y: number } | undefined {
    if (!this._activeRenderView || this._playerEntityId <= 0) {
      return undefined;
    }
    const offset = this._playerEntityId * COMPONENT_STRIDE;
    const x = this._activeRenderView[offset];
    const y = this._activeRenderView[offset + 1];
    if (x === undefined || y === undefined || (x === 0 && y === 0)) {
      return undefined;
    }
    return { x, y };
  }

  /**
   * Requests a serialized ECS snapshot from the worker.
   *
   * Posts a REQUEST_SNAPSHOT message to the worker and returns a promise
   * that resolves with the JSON payload string. Rejects if the worker
   * is not running or the snapshot fails.
   *
   * @param scope - 'player' (default) serializes only the player entity
   *   (map-authoritative saves). 'world' serializes the full ECS world
   *   (legacy/fallback saves without a map block).
   * @returns The serialized ECS world state as a JSON string.
   */
  snapshotWorld(scope: 'player' | 'world' = 'player'): Promise<string> {
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
      this._worker.postMessage({ type: 'REQUEST_SNAPSHOT', scope });
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

      // ═══ Timeout: 15s max wait for worker response ═══
      const RestoreTimeoutMs = 15_000;
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this._worker?.removeEventListener('message', handler);
        this._pendingWorkerReject = undefined;
        fn();
      };

      const timeout = setTimeout(() => {
        this.error('restoreWorld:timeout', { timeoutMs: RestoreTimeoutMs });
        finish(() =>
          reject(
            new Error('Worker did not respond to LOAD_GAME within 15s — worker may have crashed'),
          ),
        );
      }, RestoreTimeoutMs);

      // Store reject so worker onerror can also reject
      this._pendingWorkerReject = (reason: Error): void => {
        finish(() => reject(reason));
      };

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
          finish(() => reject(new Error(message.message as string)));
          return;
        }

        if (message.type !== 'ENGINE_READY') {
          return;
        }

        finish(() => resolve());
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({ type: 'LOAD_GAME', payload });
    });
  }

  /**
   * Applies a player-scoped ECS snapshot onto the live world.
   *
   * Used by the map-authoritative restore pipeline: the world is rebuilt
   * from the saved map via {@link loadMap} (which spawns NPCs, props,
   * portals, and collision), then this method merges the player's saved
   * Position/Appearance/CombatStats/Visual onto the existing player
   * entity — without clearing the freshly spawned world.
   *
   * Unlike {@link restoreWorld}, render entries are preserved: the player's
   * display object survives and is repositioned by the worker's next
   * STATE_UPDATE + the CAMERA_SNAP message.
   *
   * @param payload - A player-scoped ECS snapshot JSON string.
   * @throws If the worker is not running or the restore fails.
   */
  restorePlayer(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker not running — cannot restore player'));
        return;
      }

      // ═══ Timeout: 15s max wait for worker response ═══
      const RestoreTimeoutMs = 15_000;
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this._worker?.removeEventListener('message', handler);
        this._pendingWorkerReject = undefined;
        fn();
      };

      const timeout = setTimeout(() => {
        this.error('restorePlayer:timeout', { timeoutMs: RestoreTimeoutMs });
        finish(() =>
          reject(
            new Error(
              'Worker did not respond to RESTORE_PLAYER within 15s — worker may have crashed',
            ),
          ),
        );
      }, RestoreTimeoutMs);

      this._pendingWorkerReject = (reason: Error): void => {
        finish(() => reject(reason));
      };

      const handler = (event: MessageEvent): void => {
        const message = event.data;

        if (message.type === 'ENGINE_ERROR') {
          finish(() => reject(new Error(message.message as string)));
          return;
        }

        if (message.type !== 'ENGINE_READY') {
          return;
        }

        finish(() => resolve());
      };

      this._worker.addEventListener('message', handler);
      this._worker.postMessage({ type: 'RESTORE_PLAYER', payload });
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
   * @param options.mapUrl - URL to the new Tiled JSON tilemap.
   * @param options.targetX - X pixel coordinate for the player on the new map.
   * @param options.targetY - Y pixel coordinate for the player on the new map.
   * @param options.defeatedEnemies - Array of defeated enemy spawn IDs to filter during spawn.
   * @param options.collectedPickups - Array of collected item pickup spawn IDs to suppress (C-331).
   * @param options.targetSpawnHash - Numeric hash of the target spawn point ID (C-172).
   * @param options.defaultSpawnHash - Numeric hash of the destination map's manifest
   *   `defaultSpawnId`. Used as a fallback when targetSpawnHash is absent (C-172 resolution chain).
   * @param options.disableClamping - Bypass viewport boundary clamping for visual testing (C-199).
   * @throws If the worker is not running or the map fails to load.
   *
   * Contract: C-138 Map Transitions, C-172 Staging World Transitions, C-199
   */
  async loadMap(options: {
    mapUrl: string;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    collectedPickups?: string[];
    interactableStates?: InteractableStateMap;
    targetSpawnHash?: number;
    defaultSpawnHash?: number;
    disableClamping?: boolean;
    /**
     * Resolved content-pack tile/prop definitions (C-376 AC-2). Posted to
     * the worker once per map load so the spawner can read prop walkability
     * from the manifest instead of the legacy propWalkability side channel.
     * `undefined` (manifest resolution failed) degrades gracefully — all
     * props stay solid and the collision grid falls back to the explicit
     * collision layer.
     */
    packConfig?: PackConfig;
  }): Promise<void> {
    const {
      mapUrl,
      targetX,
      targetY,
      defeatedEnemies,
      collectedPickups,
      interactableStates,
      targetSpawnHash,
      defaultSpawnHash,
      disableClamping,
      packConfig,
    } = options;
    this.debug('loadMap', { mapUrl, targetX, targetY, disableClamping });

    // C-417 AC-2: interior maps pin their ambient to a fixed warm colour
    // independent of the outdoor clock. The flag is declared generically in
    // the content-pack manifest (per-map `interior`) and projected through
    // PackConfig — reset to false for non-interior/legacy maps.
    this._isInteriorMap = packConfig?.interior === true;

    try {
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
      this._activeTileSize = undefined;

      // 3. Remove old tilemap from the world container.
      //    Destroy with texture:true to free map-specific RenderTextures
      //    and GPU memory (C-155 AC-3: PixiJS Asset Cleanup).
      //    PixiJS v8 ref-counts BaseTextures, so cached Assets textures
      //    (Texture.from) shared across maps are NOT prematurely freed.
      if (this._worldContainer) {
        // C-378 AC-1: the band path adds one container per band
        // (`tilemap-band-ground` / `tilemap-band-decor` /
        // `tilemap-band-overhead`) as a direct child of the world
        // container — remove EVERY band container from the previous map
        // (including stale overhead bands) before the new map renders, or
        // the old chunks keep drawing over the new scene.
        for (const child of [...this._worldContainer.children]) {
          if (child.label?.startsWith('tilemap-band-')) {
            this._worldContainer.removeChild(child);
            child.destroy({ children: true, texture: true });
          }
        }
        const oldTilemap = this._worldContainer.getChildByLabel('tilemap-chunks');
        if (oldTilemap) {
          this._worldContainer.removeChild(oldTilemap);
          oldTilemap.destroy({ children: true, texture: true });
        }
        // Release the owned chunk records with the container (C-377
        // cancellation/teardown requirement).
        this._tilemapChunks = undefined;
        this._lastCulledChunkCounts = undefined;
      }

      // 4. Load and parse the new tilemap
      const isJton = mapUrl.endsWith('.jton');
      const tilemap = isJton
        ? await loadJtonMap({
            url: mapUrl,
            resolveTag: this._resolveTag,
            releaseUrl: this._releaseUrl,
          })
        : await loadTilemap({
            url: mapUrl,
            resolveTag: this._resolveTag,
            releaseUrl: this._releaseUrl,
          });
      // C-376 AC-1: derive the boolean grid from manifest walkability when a
      // pack config is available; fall back to the explicit collision layer
      // for packless maps (dev sandbox) or when manifest resolution failed.
      // C-378 AC-4: decor/overhead layers never contribute solidity. With a
      // terrain channel, the terrain path ignores baked layers entirely;
      // without one, only ground-band layers contribute (decor/overhead are
      // visual-only). An empty ground-band list (unusual map) falls back to
      // the C-376 default (all non-collision layers) rather than silently
      // opening every cell.
      const groundBandLayers = tilemap.terrain
        ? undefined // terrain-channel path ignores solidityLayers (AC-2)
        : tilemap.layers
            .filter((l) => (l.band ?? 'ground') === 'ground' && l.name !== 'collision')
            .map((l) => l.name);
      const solidityLayers =
        groundBandLayers && groundBandLayers.length > 0 ? groundBandLayers : undefined;
      const collisionGridData = packConfig
        ? buildCollisionGrid(tilemap, packConfig, { solidityLayers })
        : extractCollisionGrid(tilemap);

      // C-379 AC-4: build the authoritative TerrainGrid. Terrain-channel
      // maps derive cost + blocksSight from the pack terrain defs; legacy
      // maps without a channel (or a terrain-less pack) fall back to the
      // boolean grid with cost 0/16. The grid crosses the worker boundary
      // as flat Uint8Arrays (structured-clone safe).
      const terrainGrid = buildTerrainGridForMap({
        tilemap,
        packConfig,
        collisionGrid: collisionGridData
          ? {
              width: tilemap.width,
              height: tilemap.height,
              tileSize: tilemap.tilewidth,
              grid: collisionGridData,
            }
          : undefined,
      });
      this._activeTileSize = terrainGrid.tileSize;
      const spawnPoints = extractSpawnPoints(tilemap);
      const transitionZones = extractTransitionZones(tilemap);
      const spawnPointEntities = extractSpawnPointEntities(tilemap);

      const mapPixelWidth = tilemap.width * tilemap.tilewidth;
      const mapPixelHeight = tilemap.height * tilemap.tileheight;

      // Stable map id for the worker (zone entity derivation — C-194 fix):
      // same filename → same id, regardless of pixel dimensions, so
      // same-sized maps (inn vs merchant_shop, both 512×384) no longer
      // collide to the same zone entity.
      const mapId = (mapUrl.split('/').pop() ?? mapUrl).replace(/\.json$/i, '');

      // C-378 AC-7: prop frame metadata (manifest anchor) for multi-tile
      // props. Keyed by frame so the worker's ENTITY_CREATED message (which
      // carries only the frame) can resolve the anchor without a propId
      // round-trip. Width/height are intentionally absent — the sprite is
      // sized from the resolved texture at render time.
      this._propFrameMeta.clear();
      for (const propDef of Object.values(packConfig?.props ?? {})) {
        const anchor = propDef.anchor ?? { x: 0.5, y: 1.0 };
        this._propFrameMeta.set(propDef.frame, {
          anchorX: anchor.x,
          anchorY: anchor.y,
        });
      }

      // 5. Render the new tilemap background
      if (this._app && this._worldContainer) {
        // C-378: resolve the terrain channel into frame-name layers when the
        // map declares `aikami.terrain` AND the pack declares `terrains`.
        // Legacy maps (no terrain channel / terrain-less pack) render
        // through the existing baked-GID path (AC-8).
        let terrainLayers: TerrainLayerEmission[] | undefined;
        let frameUvResolver: FrameUvResolver | undefined;
        if (tilemap.terrain && packConfig?.terrains && packConfig.terrains.length > 0) {
          // Frame-name → UV rect, derived from the pack's spritesheet via
          // the injected prop frame resolver (same atlas, same fallback
          // semantics). Missing frames fall back to the pack's fallbackTile
          // (prop resolver contract) — never a blank map. The base terrain's
          // frameBase probes the atlas source the UV rects live in.
          frameUvResolver = this._buildFrameUvResolver(packConfig.terrains[0]?.frameBase);
          if (frameUvResolver) {
            terrainLayers = autotileLayers({
              width: tilemap.width,
              height: tilemap.height,
              terrain: tilemap.terrain,
              terrains: packConfig.terrains,
            });
            if (terrainLayers.length > 0) {
              this.debug('loadMap:terrain-resolved', {
                layers: terrainLayers.map((l) => l.name),
                cells: tilemap.width * tilemap.height,
              });
            }
          } else {
            // Atlas not preloaded — degrade to the legacy baked-GID ground
            // layer (never a blank map).
            this.warn('loadMap:terrain-skipped', {
              hint: 'Prop frame resolver not wired — rendering baked GID ground (C-378 degraded path).',
            });
          }
        }

        const result = await renderTilemap({
          tilemap,
          terrainLayers,
          frameUvResolver,
          resolveTag: this._resolveTag,
          releaseUrl: this._releaseUrl,
        });
        // C-378 AC-1: add each band container with its declared zIndex —
        // ground/decor below entities, overhead above every entity zIndex.
        // The merged `result.container` is kept inside the world at the
        // ground band for callers that render a single z-band (sandbox).
        if (result.bandContainers.length > 0) {
          for (const band of result.bandContainers) {
            band.container.zIndex = band.zIndex;
            this._worldContainer.addChild(band.container);
          }
        } else {
          // C-376 AC-4: explicit band below the entity y-range — the world
          // container now sorts children by zIndex, so insertion index no
          // longer guarantees layering.
          result.container.zIndex = WORLD_Z_BANDS.tilemapGround;
          this._worldContainer.addChild(result.container);
        }
        this.debug('loadMap:tilemap-rendered', {
          layers: result.layerCount,
          bands: result.bandContainers.map((b) => b.band),
        });

        // Store animation resources (C-177)
        this._tilemapUniforms = result.globalUniforms;
        // C-377 AC-4: keep the owned chunk records for frustum culling.
        this._tilemapChunks = result.chunks;
      }

      // 5b. Render transition zone debug overlays so portals are visible.
      //     Transition zones are invisible ECS triggers — without visual
      //     indicators, the player cannot find where to walk.
      this._renderTransitionZoneOverlays(transitionZones);

      // 5c. Redraw the debug grid to match the new map's dimensions.
      //     Different maps may have different tile counts.
      this._drawDebugGrid({
        width: tilemap.width,
        height: tilemap.height,
        tileSize: tilemap.tilewidth,
      });

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
        terrainGrid,
        packConfig,
        mapPixelWidth,
        mapPixelHeight,
        targetX,
        targetY,
        defeatedEnemies,
        collectedPickups,
        interactableStates,
        targetSpawnHash,
        defaultSpawnHash,
        spawnPointEntities,
        disableClamping,
        mapId,
      });

      // 7. Resume the engine
      this._running = true;
      this.setInputLocked(false);

      // Signal the UI layer that the map transition is complete so
      // the fade-to-black overlay can be dismissed.
      this._bridge.emit({ type: 'MAP_LOADED' });

      // Emit MAP_ENTERED so the QuestStateService can evaluate map-enter objectives.
      this._bridge.emit({ type: 'MAP_ENTERED', mapUrl });

      this.debug('loadMap:complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error('loadMap:failed', { mapUrl, error: message });

      // Restore engine state so it does not remain soft-locked
      this._running = true;
      this.setInputLocked(false);

      // Emit so the ViewModel can surface the error to the UI
      this._bridge.emit({ type: 'GAME_ERROR', message: `Map load failed: ${message}` });

      throw error;
    }
  }

  /**
   * Posts a LOAD_MAP message to the worker and returns a promise that
   * resolves when the worker responds with ENGINE_READY.
   */
  private _postLoadMap(options: {
    spawnPoints: import('./assets/map_loader.ts').SpawnPoint[];
    transitionZones: import('./assets/map_loader.ts').TransitionZone[];
    collisionGrid: CollisionGrid | undefined;
    /** Authoritative terrain cost grid (C-379 AC-4) — preferred over collisionGrid. */
    terrainGrid?: import('./systems/terrain_grid.ts').TerrainGrid;
    /** Resolved content-pack tile/prop definitions (C-376 AC-2). */
    packConfig?: PackConfig;
    mapPixelWidth: number;
    mapPixelHeight: number;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    collectedPickups?: string[];
    interactableStates?: InteractableStateMap;
    targetSpawnHash?: number;
    defaultSpawnHash?: number;
    spawnPointEntities?: import('./assets/map_loader.ts').SpawnPointEntity[];
    disableClamping?: boolean;
    /** Stable map id (URL filename without extension) for zone derivation. */
    mapId: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker not running — cannot load map'));
        return;
      }

      // ── Worker is in bootstrap phase — dynamic import may be in-flight.
      // Don't fail fast here; the 15s timeout covers the waiting period.
      // ENGINE_ERROR from bootstrap will reject via the handler below.

      // ═══ Timeout: 15s max wait for worker response ═══
      const LoadMapTimeoutMs = 15_000;
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this._worker?.removeEventListener('message', handler);
        this._pendingWorkerReject = undefined;
        fn();
      };

      const timeout = setTimeout(() => {
        this.error('_postLoadMap:timeout', { timeoutMs: LoadMapTimeoutMs });
        finish(() =>
          reject(
            new Error('Worker did not respond to LOAD_MAP within 15s — worker may have crashed'),
          ),
        );
      }, LoadMapTimeoutMs);

      // Store reject so worker onerror can also reject
      this._pendingWorkerReject = (reason: Error): void => {
        finish(() => reject(reason));
      };

      const handler = (event: MessageEvent): void => {
        const message = event.data;

        if (message.type === 'ENGINE_ERROR') {
          finish(() => reject(new Error(message.message as string)));
          return;
        }

        if (message.type !== 'MAP_LOADED') {
          return;
        }

        finish(() => resolve());
      };

      this._worker.addEventListener('message', handler);

      // Sanitize spawn-point properties for postMessage — some Tiled
      // property values (e.g. Python bools read as Proxy) may not be
      // structurally clonable by the Worker API.
      const safeSpawnPoints = options.spawnPoints.map((sp) => ({
        ...sp,
        properties: JSON.parse(JSON.stringify(sp.properties)),
      }));

      // Sanitize collision grid — ensure it is a plain boolean array,
      // not a typed array or proxy that postMessage cannot clone.
      const safeCollisionGrid = options.collisionGrid
        ? { ...options.collisionGrid, grid: [...options.collisionGrid.grid] }
        : undefined;

      this._worker.postMessage({
        type: 'LOAD_MAP',
        spawnPoints: safeSpawnPoints,
        transitionZones: options.transitionZones,
        collisionGrid: safeCollisionGrid,
        // C-379 AC-4: the authoritative terrain grid — typed arrays clone
        // structurally, no sanitization needed.
        terrainGrid: options.terrainGrid,
        packConfig: options.packConfig,
        mapPixelWidth: options.mapPixelWidth,
        mapPixelHeight: options.mapPixelHeight,
        targetX: options.targetX,
        targetY: options.targetY,
        defeatedEnemies: options.defeatedEnemies,
        collectedPickups: options.collectedPickups,
        interactableStates: options.interactableStates,
        targetSpawnHash: options.targetSpawnHash,
        defaultSpawnHash: options.defaultSpawnHash,
        spawnPointEntities: options.spawnPointEntities,
        disableClamping: options.disableClamping,
        mapId: options.mapId,
      });
    });
  }

  // -----------------------------------------------------------------------
  // Internal: Debug grid
  // -----------------------------------------------------------------------

  /**
   * Draws a tile-aligned debug grid matching the map dimensions.
   *
   * Called during initialization with default 10×10 tiles, and after
   * each {@link loadMap} with the actual map's tile count.
   */
  private _drawDebugGrid(opts?: { width: number; height: number; tileSize: number }): void {
    if (!this._app || !this._worldContainer) {
      return;
    }

    // Remove old debug grid
    const oldGrid = this._worldContainer.children.find((c) => c.label === 'debug-grid');
    if (oldGrid) {
      this._worldContainer.removeChild(oldGrid);
      oldGrid.destroy();
    }

    const grid = new Graphics();
    grid.label = 'debug-grid';
    // C-376 AC-4: explicit band below the entity y-range.
    grid.zIndex = WORLD_Z_BANDS.debugGrid;
    const strokeColor = 0x33334a;
    const tileSize = opts?.tileSize ?? 32;
    const gridW = opts?.width ?? 10;
    const gridH = opts?.height ?? 10;
    const pixelW = gridW * tileSize;
    const pixelH = gridH * tileSize;

    for (let col = 0; col <= gridW; col++) {
      const x = col * tileSize;
      grid.moveTo(x, 0).lineTo(x, pixelH).stroke({ width: 1, color: strokeColor });
    }
    for (let row = 0; row <= gridH; row++) {
      const y = row * tileSize;
      grid.moveTo(0, y).lineTo(pixelW, y).stroke({ width: 1, color: strokeColor });
    }

    this._worldContainer.addChild(grid); // behind all entities (z-band)
  }

  /**
   * Draws debug overlays for transition zones so portals are visible.
   *
   * Each zone is rendered as a semi-transparent colored rectangle with
   * a pulsing animation and an arrow indicator. This is the ONLY way
   * players can see where to walk to trigger zone transitions.
   *
   * Called from {@link loadMap} after the tilemap is rendered.
   */
  private _renderTransitionZoneOverlays(
    zones: import('./assets/map_loader.ts').TransitionZone[],
  ): void {
    if (!this._worldContainer || zones.length === 0) {
      return;
    }

    // Remove old overlays first
    const oldOverlays = this._worldContainer.children.filter(
      (c) => typeof c.label === 'string' && c.label.startsWith('zone-overlay-'),
    );
    for (const overlay of oldOverlays) {
      this._worldContainer.removeChild(overlay);
      overlay.destroy({ children: true });
    }

    for (const zone of zones) {
      const graphics = new Graphics();

      // Semi-transparent fill
      graphics.rect(zone.x, zone.y, zone.width, zone.height);
      graphics.fill({ color: 0x00ff88, alpha: 0.2 });

      // Bright border
      graphics.rect(zone.x, zone.y, zone.width, zone.height);
      graphics.stroke({ width: 2, color: 0x00ff88, alpha: 0.8 });

      // Direction arrow (pointing into the zone)
      const cx = zone.x + zone.width / 2;
      const cy = zone.y + zone.height / 2;
      graphics.moveTo(cx, cy - 8);
      graphics.lineTo(cx, cy + 4);
      graphics.lineTo(cx - 6, cy - 2);
      graphics.moveTo(cx, cy + 4);
      graphics.lineTo(cx + 6, cy - 2);
      graphics.stroke({ width: 1.5, color: 0x00ff88, alpha: 0.9 });

      graphics.label = `zone-overlay-${zone.id}`;
      graphics.eventMode = 'none';
      // C-376 AC-4: explicit band below the entity y-range.
      graphics.zIndex = WORLD_Z_BANDS.zoneOverlays;

      this._worldContainer.addChild(graphics);
    }
  }

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

    // ── C-380 AC-2: Compute interpolation alpha ──
    // Blend between the previous and current sim states based on how much
    // wall-clock time has passed since the current state was received.
    // Alpha = elapsedSinceCurrentState / stepMs, clamped to [0, 1].
    const hasTwoStates =
      this._previousRenderView !== undefined &&
      this._lastStateTiming !== undefined &&
      this._previousSimTimeMs < this._lastStateTiming.simTimeMs;
    const stepMs = this._lastStateTiming?.stepMs ?? 16.667;
    const elapsedSinceCurrent =
      this._currentStateReceivedAt > 0 ? performance.now() - this._currentStateReceivedAt : 0;
    const alpha = hasTwoStates
      ? computeInterpolationAlpha({ elapsedMs: elapsedSinceCurrent, stepMs })
      : 1;
    const prevView = this._previousRenderView;

    for (const [eid, entry] of this._renderEntries) {
      totalCount++;
      const offset = eid * COMPONENT_STRIDE;

      // C-380 AC-2: Interpolate between previous and current state
      let x: number;
      let y: number;
      if (hasTwoStates && prevView) {
        const prevX = prevView[offset];
        const prevY = prevView[offset + 1];
        const currX = renderView[offset];
        const currY = renderView[offset + 1];
        if (
          prevX !== undefined &&
          currX !== undefined &&
          !Number.isNaN(prevX) &&
          !Number.isNaN(currX)
        ) {
          x = interpolateValue({ previous: prevX, current: currX, alpha });
          y = interpolateValue({ previous: prevY, current: currY, alpha });
        } else {
          x = renderView[offset];
          y = renderView[offset + 1];
        }
      } else {
        x = renderView[offset];
        y = renderView[offset + 1];
      }

      // C-180: Expose player world coordinates for E2E collision testing.
      // Playwright reads window.__AIKAMI_DEBUG__.playerPosition to verify
      // that the spatial grid bitmask collision clamps movement at walls.
      // C-379: also exposes playerEid (so E2E can exclude the player from
      // NPC-movement assertions) and playerVisibleByMask (AC-2 — the
      // player's VisionVisible.visibleByMask, forwarded from the worker).
      if (eid === this._playerEntityId && typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ = {
          playerX: x,
          playerY: y,
          playerEid: eid,
          playerVisibleByMask: this._playerVisibleByMask,
          // C-400 AC-1: spawned NPC count for the loaded map — asserted by
          // game_boot.spec.ts against the manifest-derived count.
          npcCount: this._npcMeta.size,
        };
      }

      // C-379 AC-7: expose every rendered entity's position so E2E can
      // assert NPCs/companions actually moved (emergent-world integration
      // spec reads this to verify distributed positions over time).
      if (typeof window !== 'undefined') {
        const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
          | Record<string, unknown>
          | undefined;
        if (debug) {
          const positions = (debug.entityPositions ?? {}) as Record<
            string,
            { x: number; y: number }
          >;
          positions[String(eid)] = { x, y };
          debug.entityPositions = positions;
        }
      }

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

      // C-376 AC-4: y-depth via in-place zIndex. Raw float — the stable
      // sort + never-reparented containers give the tie-break free. The
      // lower bound is clamped to MIN_ENTITY_Y so the documented band
      // invariant (bands below MIN_ENTITY_Y) holds even for negative
      // spawn coordinates (CodeRabbit review, C-376).
      entry.displayObject.zIndex = computeEntityZIndex(y);

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

    // ── C-376 AC-4: y-depth entity sort via in-place zIndex ──
    // Entity containers carry `zIndex = displayObject.y` and the world
    // container has `sortableChildren = true`, so PixiJS sorts the display
    // list in place with a stable sort every frame — no removeChild/addChild
    // churn, no O(n²) reparenting, no `_entityRenderOrder` cache. The camera
    // transform is applied to _worldContainer itself, so z-sorting children
    // does not affect it.

    // Camera transform: center the world container at the camera position
    // computed by the CameraSystem in the worker (lerp + clamping).
    // Applied once per frame after all entity display objects are positioned.
    if (this._app && this._worldContainer) {
      // Apply dynamic zoom to the world container scale (C-161).
      // Base scale is 4× for pixel-art, multiplied by lerped zoom (1.0–1.5).
      const dynamicScale = 4 * this._cameraZoom;
      if (this._worldContainer.scale.x !== dynamicScale) {
        this._worldContainer.scale.set(dynamicScale);
      }

      // ── C-380 AC-2: Interpolated camera position ──
      // Blend the camera position between previous and current states,
      // matching the entity interpolation alpha.
      const interpCameraX = hasTwoStates
        ? interpolateValue({
            previous: this._previousCameraX,
            current: this._cameraX,
            alpha,
          })
        : this._cameraX;
      const interpCameraY = hasTwoStates
        ? interpolateValue({
            previous: this._previousCameraY,
            current: this._cameraY,
            alpha,
          })
        : this._cameraY;

      // ── C-377 AC-3: device-pixel snap (applied AFTER blending) ──
      // The world container position is the single place where continuous
      // world coordinates become device pixels. Snap the final x/y to whole
      // device pixels (accounting for renderer resolution) so the tile grid
      // does not shimmer while the camera lerps across fractional positions.
      const resolution = this._app.renderer.resolution || 1;
      this._worldContainer.x = snapToDevicePixels(
        this._app.screen.width / 2 - interpCameraX * this._worldContainer.scale.x,
        resolution,
      );
      this._worldContainer.y = snapToDevicePixels(
        this._app.screen.height / 2 - interpCameraY * this._worldContainer.scale.y,
        resolution,
      );

      // ── C-171: CPU-side frustum culling for tilemap chunks ──
      // Camera position is in world-space pixels; viewport dimensions
      // are divided by the world scale to convert screen-space → world-space.
      const viewportWorldW = this._app.screen.width / dynamicScale;
      const viewportWorldH = this._app.screen.height / dynamicScale;

      if (this._tilemapChunks && this._tilemapChunks.length > 0) {
        const culled = frustumCullChunks(
          this._tilemapChunks,
          interpCameraX - viewportWorldW / 2,
          interpCameraY - viewportWorldH / 2,
          viewportWorldW,
          viewportWorldH,
        );
        if (culled.total > 0) {
          this._lastCulledChunkCounts = culled;
        }
      }
    }

    // Throttled per-second render diagnostic (only when BaseEngineClass.setRenderDebug(true))
    if (totalCount > 0 && performance.now() - this._lastRenderLog > 1000) {
      this._lastRenderLog = performance.now();
      const chunkSummary = this._lastCulledChunkCounts
        ? `, chunks ${this._lastCulledChunkCounts.visible}/${this._lastCulledChunkCounts.total} visible`
        : '';
      this.render(
        `${visibleCount}/${totalCount} visible, stage ${stageBounds.width}x${stageBounds.height}${chunkSummary}`,
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
  /**
   * Merges equipment layer recipes into the base character recipe.
   *
   * Equipment slots that overlap base layers (torso, feet) replace the
   * base entry so unequipping reveals the persona's default clothing;
   * all other equipment layers (hat, shoulders, weapon, shield) are
   * appended on top.
   *
   * @param baseRecipes - Recipes resolved from the player's base Appearance
   * @param equipmentRecipes - Recipes for currently equipped items
   * @returns Merged recipe array (base + equipment)
   */
  private _mergeEquipmentRecipes(
    baseRecipes: readonly LpcLayerRecipe[],
    equipmentRecipes: readonly LpcLayerRecipe[],
  ): LpcLayerRecipe[] {
    const merged = [...baseRecipes];
    for (const equipmentRecipe of equipmentRecipes) {
      // C-431: key on (slot, layerRole) so behind and front entries for the same
      // slot coexist (e.g. weapon behind + weapon front).
      const overlapIndex = merged.findIndex(
        (r) => r.slot === equipmentRecipe.slot && r.layerRole === equipmentRecipe.layerRole,
      );
      if (overlapIndex >= 0) {
        merged[overlapIndex] = equipmentRecipe;
      } else {
        merged.push(equipmentRecipe);
      }
    }
    return merged;
  }

  private async _loadEntityRecipes(
    eid: number,
    recipes: LpcLayerRecipe[],
    revision: number,
  ): Promise<void> {
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

    let layerSprites: NonNullable<RenderEntry['layerSprites']> = [];
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

        // C-428: resolve sheet geometry from actual dimensions
        const geometry = resolveLpcSheetGeometry(texture);

        // C-168: Create a cached Spritesheet from the loaded texture
        // so _applyLpcFrame can use WebGPU-compatible UV sub-textures.
        let spritesheet: Spritesheet | undefined;
        if (this._textureManager) {
          const columns = geometry.columns;
          const rows = geometry.rows;
          if (columns > 0 && rows > 0) {
            spritesheet = await this._textureManager.getOrCreateSpritesheet({
              baseTexture: texture,
              layout: {
                frameWidth: geometry.pitch,
                frameHeight: geometry.pitch,
                columns,
                rows,
                keyPrefix: stateStr,
              },
              cacheKey: `${url}::${geometry.pitch}`,
            });
          }
        }

        // Remove debug sprites on first successful texture load
        if (!texturesLoaded) {
          texturesLoaded = true;
          container.removeChildren();
        }

        const sprite = new Sprite(Texture.WHITE);
        sprite.eventMode = 'none';
        // C-428: Apply geometry-based anchor to center the 64px logical body region.
        // The entity position represents the character's feet (bottom-center of the
        // logical body). For standard 64px cells, this is (0.5, 1.0). For oversize
        // 128px cells, the logical body is centered within the cell, so feet are at
        // (64, 96) in sprite coordinates → anchor (0.5, 0.75).
        const anchorX = 0.5; // Always horizontally centered
        const anchorY = geometry.pitch === 64 ? 1.0 : 0.75; // Bottom of logical body
        sprite.anchor.set(anchorX, anchorY);

        container.addChild(sprite);
        layerSprites.push({ sprite, recipe, texture, spritesheet });
      } catch (err) {
        this.debug('lpc-load-error', { url, error: String(err) });
      }
    });

    await Promise.all(loadPromises);

    // Check if this load is stale (a newer load started while we were loading).
    const currentRevision = this._entityLoadRevisions.get(eid) ?? 0;
    if (revision < currentRevision) {
      // Stale load — discard sprites and destroy textures to avoid memory leak.
      this.debug('lpc-load-stale', { eid, revision, currentRevision });
      for (const { sprite } of layerSprites) {
        sprite.destroy();
      }
      return;
    }

    if (texturesLoaded) {
      this.debug('lpc-loaded', { eid, layers: layerSprites.length });
    }

    // Sort by depth from the canonical LPC_LAYER_ORDER table (C-430).
    // This replaces the local SlotZ definition — the canonical table is
    // the ONLY slot→depth mapping in the repo.
    // Preserve original recipe order when depths are equal (stable sort tie-breaker).
    const spritesWithIndex = layerSprites.map((layer, index) => ({ layer, index }));
    spritesWithIndex.sort((a, b) => {
      const zA = resolveLayerDepth({
        slot: a.layer.recipe.slot,
        layerRole: a.layer.recipe.layerRole ?? 'front',
        direction: 2, // default facing (down)
      });
      const zB = resolveLayerDepth({
        slot: b.layer.recipe.slot,
        layerRole: b.layer.recipe.layerRole ?? 'front',
        direction: 2,
      });
      if (zA !== zB) {
        return zA - zB;
      }
      // Equal depth: preserve original recipe order
      return a.index - b.index;
    });
    layerSprites = spritesWithIndex.map((item) => item.layer);

    // Re-add in correct order
    for (const { sprite } of layerSprites) {
      container.addChild(sprite); // Re-adds and bumps to top, effectively sorting them.
    }

    if (this._renderEntries.get(eid) === entry) {
      entry.layerSprites = layerSprites;
    }
  }

  /**
   * Applies the current animation frame from the loaded LPC walk
   * spritesheets to the layer sprites.
   *
   * Uses the PixiJS `Spritesheet` API (C-168) instead of manual
   * `new Texture({ source, frame: rect })` to ensure correct
   * WebGPU-compatible UV mappings on every sub-texture.
   *
   * Spritesheet instances are created once in {@link _loadEntityRecipes}
   * and cached via {@link TextureManager._spritesheetCache} — this
   * method performs only synchronous `spritesheet.textures[key]`
   * lookups each frame.
   */
  private _applyLpcFrame(entry: RenderEntry, controller: AnimationController): void {
    if (!entry.layerSprites || entry.layerSprites.length === 0) {
      return;
    }

    const direction = controller.direction;
    const row = direction as number; // Up=0, Left=1, Down=2, Right=3

    for (const layer of entry.layerSprites) {
      if (!layer.texture) {
        continue;
      }

      // C-428: resolve sheet geometry from the loaded texture dimensions
      const geometry = resolveLpcSheetGeometry(layer.texture);
      const columns = geometry.columns;
      const pitch = geometry.pitch;

      // C-428: use the real per-sheet column count, not a global constant
      const column = controller.getFrameColumn(columns);

      // C-168: prefer the parsed Spritesheet for WebGPU-safe UV lookups.
      // Fall back to getFrameAt when no spritesheet was created
      // (e.g., dimensions don't align to the standard grid).
      if (layer.spritesheet) {
        const rows = geometry.rows;

        let effectiveRow = row;
        if (rows === 1) {
          effectiveRow = 0;
        }

        const frameCol = column % columns;
        const frameKey = `walk_${effectiveRow}_${frameCol}`;

        const frameTexture = layer.spritesheet.textures[frameKey];
        if (frameTexture) {
          layer.sprite.texture = frameTexture;
        }
      } else if (this._textureManager) {
        // Legacy fallback — manual frame slicing via Rectangle.
        // This path is kept for spritesheets that don't conform to
        // the standard LPC grid (e.g., odd-sized props).
        const rows = geometry.rows;

        let effectiveRow = row;
        if (rows === 1) {
          effectiveRow = 0;
        }

        const frameCol = column % columns;
        const dynamicFrameIndex = effectiveRow * columns + frameCol;

        const frameTexture = this._textureManager.getFrameAt({
          texture: layer.texture,
          layout: { frameWidth: pitch, frameHeight: pitch, columns, rows },
          frameIndex: dynamicFrameIndex,
        });

        if (frameTexture) {
          layer.sprite.texture = frameTexture;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // C-380 AC-4: Screen → world unprojection
  // -----------------------------------------------------------------------

  /**
   * Converts a screen-space (CSS pixel) coordinate to a world-space pixel
   * coordinate by inverting the camera transform.
   *
   * Uses the UN-SNAPPED camera position — pixel snap is a render-only
   * adjustment and inverting the snapped value drifts by up to a device pixel.
   *
   * @param screenX - Screen-space X in CSS pixels.
   * @param screenY - Screen-space Y in CSS pixels.
   * @returns World-space pixel coordinates.
   */
  unprojectScreenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    if (!this._app) {
      return { x: screenX, y: screenY };
    }
    const scale = 4 * this._cameraZoom;
    return unprojectScreenPoint({
      screenX,
      screenY,
      screenWidth: this._app.screen.width,
      screenHeight: this._app.screen.height,
      cameraX: this._cameraX,
      cameraY: this._cameraY,
      scale,
    });
  }

  /**
   * Converts a screen-space coordinate to a tile cell (column, row).
   *
   * @param screenX - Screen-space X in CSS pixels.
   * @param screenY - Screen-space Y in CSS pixels.
   * @returns The tile cell coordinates.
   */
  screenToCell(screenX: number, screenY: number): { cellX: number; cellY: number } {
    const world = this.unprojectScreenToWorld(screenX, screenY);
    const tileSize = this._activeTileSize ?? 32;
    return {
      cellX: Math.floor(world.x / tileSize),
      cellY: Math.floor(world.y / tileSize),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { GameWorld };
