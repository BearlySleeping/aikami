// packages/frontend/engine/src/game_world.ts

import { BASE_WORLD_SCALE } from '@aikami/constants';
import type { PackConfig } from '@aikami/types';
import type { Application, Ticker } from 'pixi.js';
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
} from './assets/map_loader.ts';
import { loadMapCanonical } from './assets/scene/scene_loader.ts';
import { BaseEngineClass, type BaseEngineClassOptions } from './base_engine_class.ts';
import type { LpcLayerRecipe } from './components/appearance.ts';
import type { InteractableStateMap } from './components/interactable_state.ts';
import { COMPONENT_STRIDE } from './config/memory_config.ts';
import type { EngineBridge } from './engine_bridge.ts';
import { COLOR_INTERIOR, ENV_UBO_OFFSETS } from './environment/environment_ubo.ts';
import {
  computeInterpolationAlpha,
  interpolateValue,
  unprojectScreenPoint,
} from './frame_pacing.ts';
import {
  exposeEngineState,
  isE2ETestMode,
  isVisualScreenshotMode,
  publishEntityPosition,
  publishPlayerDebug,
  publishPlayerVisibleByMask,
  resetEntityPositions,
} from './game_world/diagnostics.ts';
import { type AppearanceLayer, EntityAppearanceLoader } from './game_world/entity_appearance.ts';
import { InputController } from './game_world/input_controller.ts';
import { RenderBufferPool } from './game_world/render_buffer_pool.ts';
import {
  type HeartbeatEvent,
  type WorkerFailure,
  type WorkerOutboundMessage,
  WorkerSession,
} from './game_world/worker_session.ts';
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
import { type LpcSlotCatalog, mergeLpcRecipes } from './rendering/lpc_appearance_resolver.ts';
import { resolveLpcSheetGeometry } from './rendering/lpc_sheet_geometry.ts';
import { snapToDevicePixels } from './rendering/pixel_snap.ts';
import type { PropTextureResolver } from './rendering/prop_texture_resolver.ts';
import type { TextureManager } from './rendering/texture_manager.ts';
import { frustumCullChunks, type TilemapChunk } from './rendering/tilemap_chunk_renderer.ts';
import { resolveDefinitionFrameAtTime } from './rendering/visual_definition_playback.ts';
import { buildWalkabilityStyles } from './rendering/walkability_overlay.ts';
import { WeatherOverlay } from './rendering/weather_overlay.ts';
import type { GameAiService } from './services/ai_service.ts';
import type { GameApiService } from './services/api_service.ts';
import { buildActorPathGrid, findNearestPathableCell } from './systems/actor_footprint.ts';
import type { CollisionGrid } from './systems/collision_system.ts';
import { dirtyCheckAppearance } from './systems/render_system.ts';
import { type FrameUvResolver, renderTilemap } from './systems/tilemap_render_system.ts';
import type { GameCommand } from './types.ts';
import type {
  EntityCreatedMessage,
  StateUpdateMessage,
  WorkerMessage,
} from './worker/worker_protocol.ts';

// The Vite `?worker&type=module` bootstrap import now lives in
// ./game_world/worker_session.ts, which owns worker creation. It stays a lazy
// dynamic import so non-Vite runtimes (e.g. bun's test runner) can evaluate
// this module without resolving the `?worker` query.

/**
 * Milliseconds the hover cell highlight stays visible after the last pointer
 * move before auto-hiding. The highlight is cursor feedback, not a persistent
 * selection — it fades when the pointer rests.
 */
const HOVER_HIGHLIGHT_TIMEOUT_MS = 1000;

// ---------------------------------------------------------------------------
// GameWorld — worker-based bitECS + PixiJS lifecycle manager
//
// The worker owns the bitECS world and all game systems. The main thread
// owns the PixiJS renderer and the EngineBridge for UI communication.
// Entity state flows worker → main via transferable ArrayBuffers (the
// zero-copy SharedArrayBuffer path was removed).
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
  /** Active layer sprites (owned by the appearance loader). */
  layerSprites?: AppearanceLayer[];
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

/**
 * LPC direction names keyed by {@link LpcDirection} row offset (C-496 AC-3).
 * Used to derive clip names like `walk.down` when resolving frames through the
 * shared visual definition.
 */
const DIRECTION_NAMES: Record<number, string> = {
  0: 'up',
  1: 'left',
  2: 'down',
  3: 'right',
} as const;

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

  /** Owns worker creation, typed messaging, correlation, and heartbeat. */
  private readonly _session: WorkerSession;
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

  /** Loads/orders entity appearance layers off-scene for atomic swaps. */
  private readonly _appearanceLoader: EntityAppearanceLoader;

  /** Projected LPC slot catalog forwarded to the worker (C-400). */
  private readonly _lpcCatalog?: readonly LpcSlotCatalog[];

  /** Registry-backed tag resolver (C-434). */
  private readonly _resolveTag?: AssetTagResolver;
  /** Blob URL release function (C-434). */
  private readonly _releaseUrl?: (url: string) => void;

  /** Weather overlay quad for procedural rain/fog (C-213). */
  private _weatherOverlay: WeatherOverlay | undefined;

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

  /** The Web Worker running the bitECS simulation (owned by the session). */
  private get _worker(): Worker | undefined {
    return this._session.worker;
  }

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

  /**
   * C-504 AC-5: resolved per-NPC appearance (npcId → slot → assetId), exposed
   * on `__AIKAMI_DEBUG__.npcAppearance` for E2E identity assertions. Populated
   * on APPEARANCE_CHANGED (not per frame) and carried on the per-frame debug
   * object.
   */
  private _debugNpcAppearance: Record<string, Record<string, string>> = {};

  /** Public read-only access to NPC metadata for sandbox ViewModels. */
  get npcMeta(): ReadonlyMap<number, NpcMetaEntry> {
    return this._npcMeta;
  }

  /** Owns keyboard listeners, held keys, and the global input lock. */
  private readonly _inputController: InputController;

  /** Callback invoked when the interaction key is pressed near an NPC. */
  private _interactRequestCallback: InteractRequestCallback | undefined;

  /** Whether the game loop is currently running. */
  private _running = false;

  // ── Worker heartbeat (C-332) — owned by WorkerSession ──

  /** Unsubscribe function for the MAP_LOADED listener. */
  private _mapLoadedUnsubscribe: (() => void) | undefined;

  /** Unsubscribe function for the pointer input listener (C-380). */
  private _pointerInputTeardown: (() => void) | undefined;

  /** Bridge command registrations owned by this world (released on destroy). */
  private _commandUnsubscribes: Array<() => void> = [];

  /** PixiJS ticker callback reference for teardown. */
  private _tickerCallback: ((ticker: Ticker) => void) | undefined;

  /** Real wall-clock delta (ms) captured from the ticker on the last frame. */
  private _lastFrameDeltaMs = 16.7;

  // -- Render debug throttle ---------------------------------------------

  /** Timestamp of the last render frame log (ms). */
  private _lastRenderLog = 0;

  // -- Buffer state --------------------------------------------------------

  /** Owns the N transfer buffers and retained interpolation history. */
  private readonly _renderBufferPool: RenderBufferPool;

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraX = 0;

  /** Current camera position received from the worker (world-space pixels). */
  private _cameraY = 0;

  /** Current camera zoom received from the worker (1.0–1.5). */
  private _cameraZoom = 1.0;

  /**
   * Monotonic scene generation.
   *
   * Bumped at the start of every scene transition (loadMap/restore). Async
   * prepare phases capture the generation they started under and abort
   * before applying anything if a newer transition has superseded them —
   * a stale load can never mutate a newer scene.
   */
  private _sceneGeneration = 0;

  // -- C-380 AC-6: Cursor feedback ----------------------------------------

  /** Graphics overlay for the tile hover highlight. */
  private _hoverHighlight: Graphics | undefined;

  /** Graphics overlay for the click destination marker. */
  private _destinationMarker: Graphics | undefined;

  /** Last hovered cell coordinates (for dirty-checking). */
  private _lastHoverCell: { cellX: number; cellY: number } | undefined;

  /** Pending timer that auto-hides the hover highlight when the pointer rests. */
  private _hoverHighlightTimeout: ReturnType<typeof setTimeout> | undefined;

  /** Target cell of the active click-to-move destination, if any. */
  private _destinationCell: { cellX: number; cellY: number } | undefined;

  /** Tile size for the active map; undefined until terrain is loaded. */
  private _activeTileSize: number | undefined;

  /**
   * Authoritative TerrainGrid for the active map (C-506 AC-4). Kept so the
   * debug walkability overlay reflects the exact movement authority the
   * pathfinding systems consult, not a separately inferred grid.
   */
  private _activeTerrainGrid: import('./systems/terrain_grid.ts').TerrainGrid | undefined;

  /**
   * Footprint-aware copy of {@link _activeTerrainGrid} for click resolution.
   *
   * Built once per map. `screenToCell` clamps a click to the nearest cell
   * the actor's 32×32 box can stand in, so the destination marker and the
   * worker's path goal agree (both use the same footprint grid).
   */
  private _activePathGrid: import('./systems/terrain_grid.ts').TerrainGrid | undefined;

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

  constructor(options: GameWorldOptions) {
    super(options);
    this._bridge = options.bridge;
    this._apiService = options.apiService;
    this._aiService = options.aiService;
    this._recipeResolver = options.recipeResolver;
    this._assetUrlResolver = options.assetUrlResolver;
    this._equipmentRecipeProvider = options.equipmentRecipeProvider;
    this._textureManager = options.textureManager;
    this._appearanceLoader = new EntityAppearanceLoader({
      resolveAssetUrl: (slot, assetId, state) =>
        this._assetUrlResolver?.(slot, assetId, state) ?? null,
      textureManager: options.textureManager,
      onLoadError: (info) => this.debug('lpc-load-error', info),
    });
    this._propFrameResolver = options.propFrameResolver;
    this._lpcCatalog = options.lpcCatalog;
    this._resolveTag = options.resolveTag;
    this._releaseUrl = options.releaseUrl;

    this._renderBufferPool = new RenderBufferPool();

    this._inputController = new InputController({
      onVelocity: ({ x, y }) => {
        this._postToWorker({
          type: 'BRIDGE_COMMAND',
          command: { type: 'SET_PLAYER_VELOCITY', velocity: { x, y } },
        });
      },
      onInteract: () => this._handleInteractKey(),
      onMovementStart: () => this._cancelClickPath(),
      onTelemetry: (label, detail) => this.debug(label, detail),
    });

    this._session = new WorkerSession({
      workerFactory: options.workerFactory,
      onMessage: (message) => this._handleWorkerMessage(message),
      onFailure: (failure) => this._handleWorkerFailure(failure),
      onHeartbeat: (event) => this._handleHeartbeatEvent(event),
      shouldCheckStall: () => !this._inputController.locked,
    });
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

    // Scale everything so pixel-art sprites are visible. Base scale is a named
    // policy constant (C-497) — each world unit renders as BASE_WORLD_SCALE CSS px.
    this._worldContainer.scale.set(BASE_WORLD_SCALE);

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
    this._renderBufferPool.allocate();

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
    this._inputController.attach();

    // ---- 4b. Set up pointer input (C-380) ------------------------------
    this._pointerInputTeardown = this._setupPointerInput();

    // ---- 5. Start the render loop (main thread) -----------------------
    const stage = this._app.stage;

    this._tickerCallback = (ticker: Ticker): void => {
      const renderView = this._renderBufferPool.activeView;
      if (!this._running || !this._app || !renderView) {
        return;
      }
      // C-496 AC-5: capture the real wall-clock delta for the elapsed-time
      // actor clock; the per-entity AnimationController advances by this
      // value (never by display refresh count).
      this._lastFrameDeltaMs = ticker.deltaMS;

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

      this._updateRenderFromBuffer(renderView, stage);
      this._updateDestinationArrival();
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
    this._session.post({
      type: 'SET_SCREEN_SIZE',
      width: safeWidth,
      height: safeHeight,
      scale: this._worldContainer?.scale.x ?? BASE_WORLD_SCALE,
    });
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

    // ── C-332: Tear the worker session down ──
    // Rejects every pending worker request exactly once, stops the
    // heartbeat, detaches handlers, and terminates the worker.
    this._session.terminate();
    this._stopHeartbeat();

    // Release only the bridge registrations this world owns — command
    // forwarders and snapshot/restore delegates. Never reset() the bridge:
    // that would also drop UI listeners registered by other consumers.
    for (const unsubscribe of this._commandUnsubscribes) {
      unsubscribe();
    }
    this._commandUnsubscribes = [];
    this._bridge.setSnapshotHandler(undefined);
    this._bridge.setRestoreHandler(undefined);

    if (this._app && this._tickerCallback) {
      this._app.ticker.remove(this._tickerCallback);
      this._tickerCallback = undefined;
    }

    // Tear down keyboard listeners
    this._inputController.detach();

    // Tear down pointer input (C-380)
    if (this._pointerInputTeardown) {
      this._pointerInputTeardown();
      this._pointerInputTeardown = undefined;
    }

    // Release buffer references
    this._renderBufferPool.clear();

    // Clear render entries
    this._renderEntries.clear();
    resetEntityPositions();

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
   * Delegates to the diagnostics boundary; see {@link isE2ETestMode}.
   */
  private _isE2ETestMode(): boolean {
    return isE2ETestMode();
  }

  /**
   * True in visual-screenshot mode. Delegates to the diagnostics boundary,
   * which memoizes the immutable URL check.
   */
  private _isVisualScreenshotMode(): boolean {
    return isVisualScreenshotMode();
  }

  /**
   * Exposes engine state on `window.__AIKAMI_ENGINE_STATE__` so Playwright
   * can await specific bitECS conditions before capturing screenshots.
   */
  private _exposeEngineState(): void {
    exposeEngineState({
      frozen: !this._running,
      entityCount: this._renderEntries.size,
      // C-400 AC-1: spawned NPC count (entities created with npcData — authored
      // manifest NPCs plus restored/programmatic NPCs) — asserted by
      // game_boot.spec.ts against the manifest-derived count.
      npcCount: this._npcMeta.size,
      playerEntityId: this._playerEntityId,
      cameraX: this._cameraX,
      cameraY: this._cameraY,
    });
  }

  /**
   * Drops retained interpolation/camera history at a scene discontinuity.
   *
   * Without this, the first STATE_UPDATE after a map switch or restore
   * would blend the previous map's entity positions and camera with the new
   * scene's, producing a one-frame smear. Camera history is reseeded from
   * the current camera so the world does not jump on resume.
   */
  private _resetInterpolationHistory(): void {
    this._renderBufferPool.resetHistory({ x: this._cameraX, y: this._cameraY });
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
    try {
      await this._session.start({
        canvasWidth,
        canvasHeight,
        buffers: this._renderBufferPool.takeInitialBuffers(),
        loadPayload,
        playerData,
        collisionGrid,
        lpcCatalog,
      });
    } catch (error) {
      this.error('spawnWorker:failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      this._renderBufferPool.clear();
      throw error;
    }

    // Abort if destroy() ran during the async worker import — never
    // resurrect a disposed world's event wiring.
    if (this._disposed || !this._session.worker) {
      this.warn('spawnWorker:aborted-after-import', {
        reason: 'GameWorld was destroyed during worker initialization',
      });
      this._renderBufferPool.clear();
      return;
    }

    // Forward bridge commands to the worker
    this._setupCommandForwarding();

    // ── C-332: Start heartbeat on first MAP_LOADED ──
    // The heartbeat is deferred until the first map finishes loading because
    // the worker's tick loop is paused/restarted during LOAD_MAP in the boot
    // pipeline. MAP_LOADED signals the game is fully interactive.
    this._mapLoadedUnsubscribe = this._bridge.on('MAP_LOADED', () => {
      this._session.startHeartbeat();
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
  private _handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'STATE_UPDATE': {
        this._handleStateUpdate(message);
        break;
      }

      case 'SYNC': {
        // Events-only sync (no buffer swap) — normalize to the shared handler.
        this._handleStateUpdate({ ...message, type: 'STATE_UPDATE' });
        break;
      }

      case 'ENTITY_CREATED': {
        this._handleEntityCreated(message);
        break;
      }

      case 'ENGINE_READY': {
        // Correlated completion is settled by WorkerSession. This path keeps
        // the UI-visible ready signal for boot and restores.
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
        this._bridge.emit({
          type: 'GAME_ERROR',
          message: message.message ?? 'Unknown engine error',
        });
        break;
      }

      case 'ENGINE_FATAL': {
        // ── RC-2: Unrecoverable — terminate the worker ──
        this.error('[GameWorld] ENGINE_FATAL', { message: message.message });
        this._bridge.emit({
          type: 'GAME_ERROR',
          message: `FATAL: ${message.message ?? 'unknown'}`,
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
          timestamp: message.timestamp,
        });
        break;
      }

      case 'DIAGNOSTIC_WORKER_EVALUATED': {
        // Phase 2: all 56 ECS worker imports resolved successfully
        this.debug('[GameWorld] worker fully evaluated — all imports OK', {
          timestamp: message.timestamp,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  /**
   * Surfaces a worker transport failure on the bridge and logs it.
   *
   * Pending requests are already rejected by {@link WorkerSession}; this
   * only translates the failure into the engine's error event.
   */
  private _handleWorkerFailure(failure: WorkerFailure): void {
    if (failure.kind === 'error') {
      this.error('[GameWorld] Worker error', failure.detail);
      this._bridge.emit({
        type: 'GAME_ERROR',
        message: `Worker: ${failure.detail.message} @ ${failure.detail.filename}:${failure.detail.lineno}:${failure.detail.colno}`,
      });
      return;
    }
    this.error('[GameWorld] Worker transport failure', { kind: failure.kind });
    this._bridge.emit({ type: 'GAME_ERROR', message: failure.message });
  }

  /** Logs heartbeat observations (control flow stays in WorkerSession). */
  private _handleHeartbeatEvent(event: HeartbeatEvent): void {
    if (event.kind === 'stall') {
      this.warn('[GameWorld] WARN: Simulation stalled — tickCount unchanged for 3 heartbeats', {
        tickCount: event.tickCount,
        staleCycles: event.staleCycles,
        writableBufferCount: event.writableBufferCount,
        syncWithBuffer: event.syncWithBuffer,
        syncWithoutBuffer: event.syncWithoutBuffer,
        recycled: event.recycled,
      });
      return;
    }
    this.warn('[GameWorld] WARN: Worker engine heartbeat missed!', {
      elapsedMs: event.elapsedMs,
      missedCount: event.missedCount,
    });
  }

  /**
   * Handles a STATE_UPDATE message from the worker.
   *
   * Swaps the active render view, stores the camera position, and
   * re-emits bridged events.
   */
  private _handleStateUpdate(message: StateUpdateMessage): void {
    // Adopt the transferred buffer and snapshot the outgoing state for
    // interpolation — using the pre-update camera — before the new camera is
    // applied below. A SYNC-only message (no buffer) skips the swap but its
    // events are still processed, otherwise the player stays a tinted
    // placeholder on every portal transition (C-378).
    this._renderBufferPool.ingest({
      message,
      previousCamera: { x: this._cameraX, y: this._cameraY },
      now: performance.now(),
      recycle: (buffer) => this._session.recycleBuffer(buffer),
    });

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

    // C-379 AC-2: forward the player's vision mask onto the debug bridge
    // so E2E can assert the vision system actually marks the player visible.
    if (typeof message.playerVisibleByMask === 'number') {
      this._playerVisibleByMask = message.playerVisibleByMask;
      publishPlayerVisibleByMask(message.playerVisibleByMask);
    }

    // Re-emit events through the bridge
    const events = message.events;
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
            // C-504 AC-5: record the RESOLVED per-NPC appearance (slot →
            // assetId) so E2E can assert named identities in the live game.
            const npcId = this._npcMeta.get(gameEvent.eid)?.npcId;
            if (npcId) {
              this._debugNpcAppearance[npcId] = Object.fromEntries(
                recipes.filter((r) => r.assetId).map((r) => [r.slot, r.assetId]),
              );
            }
            // Bump revision to invalidate any in-flight loads for this entity.
            const nextRevision = (this._entityLoadRevisions.get(gameEvent.eid) ?? 0) + 1;
            this._entityLoadRevisions.set(gameEvent.eid, nextRevision);
            // Fire async load, ignoring promise result.
            void this._loadEntityRecipes(gameEvent.eid, recipes, nextRevision);
          }
          dirtyCheckAppearance(gameEvent.eid, gameEvent.layerIds);
        }
        if (
          gameEvent.type === 'PLAYER_PATH_REJECTED' &&
          this._destinationCell?.cellX === gameEvent.cellX &&
          this._destinationCell.cellY === gameEvent.cellY
        ) {
          // The worker rejected the click (target cell not standable or
          // unreachable) — clear the marker so it does not linger.
          this._clearDestinationMarker();
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
  private _handleEntityCreated(message: EntityCreatedMessage): void {
    const eid = message.eid;
    const tint = message.tint ?? 0xffffff;

    if (eid === undefined || !this._app) {
      return;
    }

    this.debug('ENTITY_CREATED', { eid, tint: `0x${tint.toString(16)}` });

    // Track player entity ID (first entity created is the player)
    if (this._playerEntityId === 0) {
      this._playerEntityId = eid;
    } else {
      // Non-player entities are NPCs — store metadata if provided
      const npcData = message.npcData;
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
    // The worker posts a numeric tint; guard NaN from a malformed message
    // rather than rendering an invisible (NaN-tinted) placeholder.
    const safeTint = Number.isNaN(tint) ? 0xff00ff : tint;
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 32;
    sprite.height = 32;
    sprite.anchor.set(0.5, 1.0);
    sprite.tint = safeTint;
    container.addChild(sprite);

    // Props carry their named atlas frame from the worker — swap the white
    // placeholder for the real tileset sprite (e.g. "well.png"). The atlas
    // spritesheet is preloaded at boot so Texture.from(frame) resolves.
    const frame = message.frame;
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
    // Register each forwarder through the typed engine-facing capability.
    // The session owns the transport; this only translates bridge commands
    // into worker messages.
    this._registerBridgeCommand('SET_PLAYER_VELOCITY', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_PLAYER_VELOCITY', velocity: cmd.velocity },
      });
    });

    this._registerBridgeCommand('SPAWN_NPC', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SPAWN_NPC', npcData: cmd.npcData },
      });
    });

    this._registerBridgeCommand('SET_ENTITY_VELOCITY', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_ENTITY_VELOCITY',
          entityId: cmd.entityId,
          velocity: cmd.velocity,
        },
      });
    });

    this._registerBridgeCommand('TRIGGER_MACRO', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'TRIGGER_MACRO',
          macro: cmd.macro,
          args: cmd.args,
          entityId: cmd.entityId,
        },
      });
    });

    // Forward SET_GAME_MODE commands (C-140)
    this._registerBridgeCommand('SET_GAME_MODE', (cmd) => {
      // C-380 AC-7: Mode changes cancel click-path
      if (cmd.mode !== 'EXPLORE') {
        this._cancelClickPath();
      }
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'SET_GAME_MODE', mode: cmd.mode },
      });
    });

    // Forward COMBAT_ACTION commands (C-145)
    this._registerBridgeCommand('COMBAT_ACTION', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'COMBAT_ACTION',
          action: cmd.action,
          targetId: cmd.targetId,
        },
      });
    });

    // Forward UPDATE_PLAYER_APPEARANCE commands (C-163)
    this._registerBridgeCommand('UPDATE_PLAYER_APPEARANCE', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'UPDATE_PLAYER_APPEARANCE',
          slots: cmd.slots,
        },
      });
    });

    // Forward INTERACT commands (C-161 camera zoom)
    this._registerBridgeCommand('INTERACT', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: { type: 'INTERACT', targetEntityId: cmd.targetEntityId },
      });
    });

    // Forward SET_ENVIRONMENT_CONFIG commands (C-213)
    this._registerBridgeCommand('SET_ENVIRONMENT_CONFIG', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_ENVIRONMENT_CONFIG',
          timeScale: cmd.timeScale,
          windVelocity: cmd.windVelocity,
          rainIntensity: cmd.rainIntensity,
          startHour: cmd.startHour,
        },
      });
    });

    // Forward SET_COMPANION_RECRUITED commands (C-212, C-340)
    this._registerBridgeCommand('SET_COMPANION_RECRUITED', (cmd) => {
      this._postToWorker({
        type: 'BRIDGE_COMMAND',
        command: {
          type: 'SET_COMPANION_RECRUITED',
          entityId: cmd.entityId,
          recruited: cmd.recruited,
        },
      });
    });
  }

  /**
   * Registers a bridge command forwarder and retains its unsubscribe so
   * {@link destroy} can release exactly the registrations this world owns.
   */
  private _registerBridgeCommand<T extends GameCommand['type']>(
    type: T,
    handler: (command: Extract<GameCommand, { type: T }>) => void,
  ): void {
    this._commandUnsubscribes.push(this._bridge.onCommand(type, handler));
  }

  /**
   * Posts a message to the worker, if it exists.
   */
  private _postToWorker(message: WorkerOutboundMessage): void {
    this._session.post(message);
  }

  // -----------------------------------------------------------------------
  // Public: input locking & interaction
  // -----------------------------------------------------------------------

  /**
   * Registers snapshot and restore handler callbacks on the engine bridge
   * so the UI can request serialization without direct access to the worker.
   */
  private _setupSnapshotHandlers(): void {
    this._bridge.setSnapshotHandler((scope?: 'player' | 'world') => this.snapshotWorld(scope));
    this._bridge.setRestoreHandler((payload: string) => this.restoreWorld(payload));
  }

  /**
   * Sets the global input lock state.
   *
   * When `true`, keyboard movement keys (WASD/arrows) are suppressed.
   * Interaction keys ('E', 'Enter') continue to work.
   */
  setInputLocked(locked: boolean): void {
    // The controller always posts zero velocity on a lock transition so the
    // worker has a clean slate — prevents sticky movement across pause/unpause.
    this._inputController.setLocked(locked);
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
    this._inputController.flush();
    this.debug('[GameWorld] flushInput:cleared');
  }

  /** Returns the current input lock state. */
  get isInputLocked(): boolean {
    return this._inputController.locked;
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
  // Internal: Worker heartbeat (C-332) — transport owned by WorkerSession
  // -----------------------------------------------------------------------

  /**
   * Unsubscribes the bridge's MAP_LOADED heartbeat trigger.
   *
   * The PING/PONG + tick-stall loop itself lives in {@link WorkerSession};
   * this only releases the bridge registration this world owns.
   */
  private _stopHeartbeat(): void {
    if (this._mapLoadedUnsubscribe) {
      this._mapLoadedUnsubscribe();
      this._mapLoadedUnsubscribe = undefined;
    }
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
      if (this._inputController.locked) {
        return;
      }
      if (!this._running || !this._renderBufferPool.activeView) {
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
      if (this._inputController.locked) {
        return;
      }
      if (!this._running || !this._renderBufferPool.activeView) {
        return;
      }

      const { x: screenX, y: screenY } = getCanvasCoords(event);
      const { cellX, cellY } = this.screenToCell(screenX, screenY);

      // Restart the idle-hide timer on ANY pointer movement so the highlight
      // tracks an active cursor but fades once the pointer rests.
      this._resetHoverHighlightTimeout();

      // Throttle to cell changes only
      if (this._lastHoverCell?.cellX === cellX && this._lastHoverCell?.cellY === cellY) {
        return;
      }
      this._lastHoverCell = { cellX, cellY };

      this._updateHoverHighlight(cellX, cellY);
    };

    const handlePointerLeave = (): void => {
      this._lastHoverCell = undefined;
      this._clearHoverHighlightTimeout();
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
      this._clearHoverHighlightTimeout();
    };
  }

  // -----------------------------------------------------------------------
  // C-380 AC-6: Cursor feedback helpers
  // -----------------------------------------------------------------------

  /**
   * Restarts the hover-highlight idle-hide timer.
   *
   * Called on every pointer move. After {@link HOVER_HIGHLIGHT_TIMEOUT_MS}
   * without movement the highlight is hidden and the dirty-check reset, so a
   * small move within the same cell redraws it again.
   */
  private _resetHoverHighlightTimeout(): void {
    this._clearHoverHighlightTimeout();
    this._hoverHighlightTimeout = setTimeout(() => {
      this._hoverHighlightTimeout = undefined;
      if (this._hoverHighlight) {
        this._hoverHighlight.visible = false;
      }
      this._lastHoverCell = undefined;
    }, HOVER_HIGHLIGHT_TIMEOUT_MS);
  }

  /** Cancels a pending hover-highlight idle-hide timer. */
  private _clearHoverHighlightTimeout(): void {
    if (this._hoverHighlightTimeout !== undefined) {
      clearTimeout(this._hoverHighlightTimeout);
      this._hoverHighlightTimeout = undefined;
    }
  }

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
    this._destinationCell = { cellX, cellY };
  }

  /**
   * Hides the click destination marker once the player has stepped onto the
   * target cell. The worker's PathFollow stops the player at the cell centre;
   * mirroring that arrival here prevents the green crosshair from lingering
   * after the walk completes.
   */
  private _updateDestinationArrival(): void {
    if (!this._destinationMarker?.visible || !this._destinationCell) {
      return;
    }

    const renderView = this._renderBufferPool.activeView;
    if (!renderView || this._playerEntityId <= 0) {
      return;
    }

    const offset = this._playerEntityId * COMPONENT_STRIDE;
    const playerX = renderView[offset];
    const playerY = renderView[offset + 1];
    if (playerX === undefined || playerY === undefined) {
      return;
    }

    const tileSize = this._activeTileSize ?? 32;
    const cellX = Math.floor(playerX / tileSize);
    const cellY = Math.floor(playerY / tileSize);

    if (cellX === this._destinationCell.cellX && cellY === this._destinationCell.cellY) {
      this._clearDestinationMarker();
    }
  }

  /** Hides the click destination marker and forgets its target cell. */
  private _clearDestinationMarker(): void {
    if (this._destinationMarker) {
      this._destinationMarker.visible = false;
    }
    this._destinationCell = undefined;
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
    this._clearDestinationMarker();
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
    if (this._inputController.locked || !this._renderBufferPool.activeView) {
      return;
    }

    // Read player position from the render buffer
    const pOffset = this._playerEntityId * COMPONENT_STRIDE;
    const playerX = this._renderBufferPool.activeView[pOffset];
    const playerY = this._renderBufferPool.activeView[pOffset + 1];

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
      const npcX = this._renderBufferPool.activeView[nOffset];
      const npcY = this._renderBufferPool.activeView[nOffset + 1];

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
    if (!this._renderBufferPool.activeView || this._playerEntityId <= 0) {
      return undefined;
    }
    const offset = this._playerEntityId * COMPONENT_STRIDE;
    const x = this._renderBufferPool.activeView[offset];
    const y = this._renderBufferPool.activeView[offset + 1];
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
    return this._session
      .request({
        message: { type: 'REQUEST_SNAPSHOT', scope },
        expect: 'SNAPSHOT_RESPONSE',
      })
      .then((message) => message.payload ?? '');
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
  async restoreWorld(payload: string): Promise<void> {
    if (!this._worker) {
      throw new Error('Worker not running — cannot restore');
    }

    // A full-world restore is a scene discontinuity: supersede any in-flight
    // transition and drop cross-scene interpolation history.
    ++this._sceneGeneration;
    this._resetInterpolationHistory();

    // Clear all existing render entries (PixiJS display objects) before the
    // worker hydrates the world. Done synchronously so the scene is empty
    // the moment the restore is requested.
    for (const entry of this._renderEntries.values()) {
      entry.displayObject.destroy({ children: true });
    }
    this._renderEntries.clear();
    this._npcMeta.clear();
    this._playerEntityId = 0;
    resetEntityPositions();

    // Wait for the worker to finish restoring. WorkerSession correlates the
    // reply and rejects on timeout/crash/disposal exactly once.
    await this._session.request({
      message: { type: 'LOAD_GAME', payload },
      expect: 'ENGINE_READY',
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
  async restorePlayer(payload: string): Promise<void> {
    if (!this._worker) {
      throw new Error('Worker not running — cannot restore player');
    }
    // The player teleports — reseed interpolation so the camera/entity blend
    // does not smear from the pre-restore position.
    ++this._sceneGeneration;
    this._resetInterpolationHistory();
    await this._session.request({
      message: { type: 'RESTORE_PLAYER', payload },
      expect: 'ENGINE_READY',
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

    // Supersede any in-flight scene transition. The captured generation is
    // re-checked after every await so a stale prepare phase can never mutate
    // a newer scene.
    const generation = ++this._sceneGeneration;
    // A map switch is a discontinuity — drop cross-scene interpolation data.
    this._resetInterpolationHistory();

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
      // C-504 AC-5: reset the debug per-NPC appearance map on map switch so a
      // stale map's NPCs never leak into the next map's debug state.
      this._debugNpcAppearance = {};
      this._playerEntityId = 0;
      resetEntityPositions();
      this._activeTileSize = undefined;
      this._activeTerrainGrid = undefined;
      this._activePathGrid = undefined;

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

      // 4. Load and parse the new tilemap through the CANONICAL scene
      //    pipeline (C-505 AC-1): the legacy map is normalized, validated and
      //    compiled into a canonical TilemapData so /game and the preview
      //    share one interpretation. Packless dev maps fall back to the
      //    legacy parse so the game still boots.
      const baseTerrain = packConfig?.terrains?.length
        ? [...packConfig.terrains].sort((a, b) => a.precedence - b.precedence)[0]?.name
        : undefined;
      const { tilemap } = await loadMapCanonical({
        url: mapUrl,
        resolveTag: this._resolveTag,
        releaseUrl: this._releaseUrl,
        assetLock: 'pack:emberwatch',
        baseTerrain,
        terrains: packConfig?.terrains,
      });
      if (generation !== this._sceneGeneration) {
        this.debug('loadMap:superseded-after-parse', { mapUrl, generation });
        return;
      }
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
      this._activeTerrainGrid = terrainGrid;
      this._activePathGrid = { ...terrainGrid, cost: buildActorPathGrid(terrainGrid) };
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
        if (generation !== this._sceneGeneration) {
          // Superseded mid-render — release the just-built GPU resources
          // and leave the newer scene untouched.
          if (result.bandContainers.length > 0) {
            for (const band of result.bandContainers) {
              band.container.destroy({ children: true, texture: true });
            }
          } else {
            result.container.destroy({ children: true, texture: true });
          }
          this.debug('loadMap:superseded-after-render', { mapUrl, generation });
          return;
        }
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
        terrainGrid,
      });

      // 6. Post LOAD_MAP to worker and wait for completion
      if (generation !== this._sceneGeneration) {
        this.debug('loadMap:superseded-before-worker', { mapUrl, generation });
        return;
      }
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

      // A newer transition may have started while the worker loaded this map.
      if (generation !== this._sceneGeneration) {
        this.debug('loadMap:superseded-after-worker', { mapUrl, generation });
        return;
      }

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
      // A superseded load must not resume/unlock the engine or surface an
      // error — the newer transition owns engine state now.
      if (generation !== this._sceneGeneration) {
        this.debug('loadMap:superseded-error', { mapUrl, generation });
        return;
      }
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
    if (!this._worker) {
      return Promise.reject(new Error('Worker not running — cannot load map'));
    }

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

    // WorkerSession correlates MAP_LOADED / ENGINE_ERROR and enforces the
    // timeout, so the worker-bootstrap window is covered without a bespoke
    // per-call listener.
    return this._session
      .request({
        message: {
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
        },
        expect: 'MAP_LOADED',
      })
      .then(() => undefined);
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
  private _drawDebugGrid(opts?: {
    width: number;
    height: number;
    tileSize: number;
    terrainGrid?: import('./systems/terrain_grid.ts').TerrainGrid;
  }): void {
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

    // C-506 AC-4: when the authoritative TerrainGrid is available, paint each
    // cell with the walkability style projected from `grid.cost` — the exact
    // movement authority pathfinding reads — so the overlay and the real game
    // agree by construction. Falls back to gridlines only when no grid exists.
    const authority = opts?.terrainGrid ?? this._activeTerrainGrid;
    if (authority) {
      const styles = buildWalkabilityStyles(authority);
      for (let row = 0; row < gridH; row++) {
        for (let col = 0; col < gridW; col++) {
          const i = row * gridW + col;
          const style = styles[i];
          if (!style) {
            continue;
          }
          grid.rect(col * tileSize, row * tileSize, tileSize, tileSize).fill({
            color: style.fill,
            alpha: style.alpha,
          });
          grid.rect(col * tileSize, row * tileSize, tileSize, tileSize).stroke({
            width: 1,
            color: style.stroke,
          });
        }
      }
    } else {
      for (let col = 0; col <= gridW; col++) {
        const x = col * tileSize;
        grid.moveTo(x, 0).lineTo(x, pixelH).stroke({ width: 1, color: strokeColor });
      }
      for (let row = 0; row <= gridH; row++) {
        const y = row * tileSize;
        grid.moveTo(0, y).lineTo(pixelW, y).stroke({ width: 1, color: strokeColor });
      }
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
    const timing = this._renderBufferPool.timing;
    const hasTwoStates =
      this._renderBufferPool.previousView !== undefined &&
      timing !== undefined &&
      this._renderBufferPool.previousSimTimeMs < timing.simTimeMs;
    const stepMs = timing?.stepMs ?? 16.667;
    const stateReceivedAt = this._renderBufferPool.currentStateReceivedAt;
    const elapsedSinceCurrent = stateReceivedAt > 0 ? performance.now() - stateReceivedAt : 0;
    const alpha = hasTwoStates
      ? computeInterpolationAlpha({ elapsedMs: elapsedSinceCurrent, stepMs })
      : 1;
    const prevView = this._renderBufferPool.previousView;

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

      if (x === undefined || y === undefined) {
        continue;
      }

      // C-180: Expose player world coordinates for E2E collision testing.
      // Playwright reads window.__AIKAMI_DEBUG__.playerPosition to verify
      // that the spatial grid bitmask collision clamps movement at walls.
      // C-379: also exposes playerEid (so E2E can exclude the player from
      // NPC-movement assertions) and playerVisibleByMask (AC-2 — the
      // player's VisionVisible.visibleByMask, forwarded from the worker).
      // Published only once x/y resolved — a NaN/undefined frame must not
      // poison the debug read.
      if (eid === this._playerEntityId) {
        publishPlayerDebug({
          playerX: x,
          playerY: y,
          playerEid: eid,
          playerVisibleByMask: this._playerVisibleByMask,
          // C-400 AC-1: spawned NPC count for the loaded map — asserted by
          // game_boot.spec.ts against the manifest-derived count.
          npcCount: this._npcMeta.size,
          // C-504 AC-5: resolved per-NPC appearance for E2E identity assertions.
          npcAppearance: this._debugNpcAppearance,
        });
      }

      // C-379 AC-7: expose every rendered entity's position so E2E can
      // assert NPCs/companions actually moved (emergent-world integration
      // spec reads this to verify distributed positions over time).
      publishEntityPosition(eid, { x, y });

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

      // Drive per-entity animation controller from positional deltas and the
      // real elapsed wall-clock delta (C-496 AC-5).
      entry.animationController?.update({ x, y, deltaMs: this._lastFrameDeltaMs });

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
      // Base scale is the named policy constant, multiplied by lerped zoom
      // (1.0–1.5). Each world unit renders as BASE_WORLD_SCALE CSS px.
      const dynamicScale = BASE_WORLD_SCALE * this._cameraZoom;
      if (this._worldContainer.scale.x !== dynamicScale) {
        this._worldContainer.scale.set(dynamicScale);
      }

      // ── C-380 AC-2: Interpolated camera position ──
      // Blend the camera position between previous and current states,
      // matching the entity interpolation alpha.
      const previousCamera = this._renderBufferPool.previousCamera;
      const interpCameraX = hasTwoStates
        ? interpolateValue({
            previous: previousCamera.x,
            current: this._cameraX,
            alpha,
          })
        : this._cameraX;
      const interpCameraY = hasTwoStates
        ? interpolateValue({
            previous: previousCamera.y,
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
    // C-504: delegate to the shared, tested merge (normalizes missing
    // layerRole to 'front' before the (slot, layerRole) match).
    return mergeLpcRecipes(baseRecipes, equipmentRecipes);
  }

  private async _loadEntityRecipes(
    eid: number,
    recipes: LpcLayerRecipe[],
    revision: number,
  ): Promise<void> {
    const entry = this._renderEntries.get(eid);
    if (!entry) {
      return;
    }

    // Prepare off-scene: nothing is added to the live container until the
    // whole load succeeds, so replacement is atomic and a superseded load
    // never blanks the entity.
    const prepared = await this._appearanceLoader.prepare({ recipes, state: 'walk' });

    // Abort if the entity was replaced or the world was torn down mid-load.
    if (this._disposed || this._renderEntries.get(eid) !== entry) {
      this._appearanceLoader.disposePrepared(prepared);
      return;
    }

    // Abort if a newer load started while we were loading.
    const currentRevision = this._entityLoadRevisions.get(eid) ?? 0;
    if (revision < currentRevision) {
      this.debug('lpc-load-stale', { eid, revision, currentRevision });
      this._appearanceLoader.disposePrepared(prepared);
      return;
    }

    // No texture resolved — keep the existing placeholder rather than
    // replacing it with nothing.
    if (prepared.layers.length === 0) {
      this._appearanceLoader.disposePrepared(prepared);
      return;
    }

    this._appearanceLoader.commit({
      target: entry.displayObject as Container,
      prepared,
    });
    entry.layerSprites = prepared.layers;
    this.debug('lpc-loaded', { eid, layers: prepared.layers.length });
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
    const directionName = DIRECTION_NAMES[direction];

    for (const layer of entry.layerSprites) {
      if (!layer.texture) {
        continue;
      }

      // C-496 AC-3/AC-6: when a shared visual definition was compiled at load,
      // resolve the frame through it (elapsed-time clock + actor-level
      // fallback) instead of hard-coding the 'walk' row. The resolved frame
      // maps back to a cached spritesheet key so steady playback still
      // allocates no new render objects.
      if (layer.definition) {
        const clipName = controller.isIdle ? `idle.${directionName}` : `walk.${directionName}`;
        const resolved = resolveDefinitionFrameAtTime({
          definition: layer.definition,
          clipName,
          elapsedMs: controller.elapsedMs,
        });
        if (resolved) {
          const frame = resolved.frame;
          const geometry = resolveLpcSheetGeometry(layer.texture);
          const fCol = Math.floor(frame.x / geometry.pitch);
          const fRow = Math.floor(frame.y / geometry.pitch);
          if (layer.spritesheet) {
            const frameKey = `walk_${fRow}_${fCol}`;
            const frameTexture = layer.spritesheet.textures[frameKey];
            if (frameTexture) {
              layer.sprite.texture = frameTexture;
              continue;
            }
          } else if (this._textureManager) {
            const frameTexture = this._textureManager.getFrameAt({
              texture: layer.texture,
              layout: {
                frameWidth: geometry.pitch,
                frameHeight: geometry.pitch,
                columns: geometry.columns,
                rows: geometry.rows,
              },
              frameIndex: fRow * geometry.columns + fCol,
            });
            if (frameTexture) {
              layer.sprite.texture = frameTexture;
              continue;
            }
          }
        }
        // Fall through to the legacy row/column path if the definition path
        // could not slice a texture.
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
    const scale = BASE_WORLD_SCALE * this._cameraZoom;
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
   * The raw cell is clamped to the map bounds, then snapped to the nearest
   * cell the actor's footprint can stand in. This makes clicks in the void
   * outside the map, or on walls/props, resolve to the closest enterable
   * cell instead of being refused, and keeps the destination marker on the
   * same cell the worker will path to.
   *
   * @param screenX - Screen-space X in CSS pixels.
   * @param screenY - Screen-space Y in CSS pixels.
   * @returns The resolved tile cell coordinates.
   */
  screenToCell(screenX: number, screenY: number): { cellX: number; cellY: number } {
    const world = this.unprojectScreenToWorld(screenX, screenY);
    const tileSize = this._activeTileSize ?? 32;
    let cellX = Math.floor(world.x / tileSize);
    let cellY = Math.floor(world.y / tileSize);

    const terrain = this._activeTerrainGrid;
    if (terrain) {
      cellX = Math.max(0, Math.min(terrain.width - 1, cellX));
      cellY = Math.max(0, Math.min(terrain.height - 1, cellY));
    }

    const pathGrid = this._activePathGrid;
    if (pathGrid) {
      const nearest = findNearestPathableCell(pathGrid, cellX, cellY);
      if (nearest) {
        return { cellX: nearest.x, cellY: nearest.y };
      }
    }

    return { cellX, cellY };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export { GameWorld };
