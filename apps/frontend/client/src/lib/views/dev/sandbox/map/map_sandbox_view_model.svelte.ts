// apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Map & Zoning sandbox route.
// Creates a GameWorld bound to a canvas and loads the debug JTON
// tilemap for visual pipeline validation (C-178). Zone B falls back
// to the legacy sandbox_zone_b.json.
//
// Contracts: C-139 Task 2, C-178

import type { EngineBridge, GameWorldOptions, LpcLayerRecipe } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';

/** Lazily-resolved ECS worker constructor (SSR-safe dynamic import). */
let _ecsWorkerCtor: (new () => Worker) | undefined;

const _resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker;
  return _ecsWorkerCtor;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MapSandboxViewModelInterface = BaseViewModelInterface & {
  /** Whether the game engine is initialized and running. */
  readonly engineReady: boolean;
  /** Engine initialization error, surfaced to the user. */
  readonly engineError: string | undefined;
  /** URL of the currently loaded map, or undefined if none loaded yet. */
  readonly currentMap: string | undefined;
  /** Interaction hint shown when player is near an NPC. */
  readonly interactionHint: string | undefined;
  /** Whether the NPC dialog overlay is visible. */
  readonly showDialog: boolean;
  /** Current NPC dialog text. */
  readonly dialogText: string;
  /** Name of the NPC in the active dialog. */
  readonly dialogNpcName: string;
  /** Whether AI streaming is in progress. */
  readonly isStreaming: boolean;
  /** Initializes the game engine, binding it to the given canvas. */
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  /** Loads debug_map.jton via the engine's loadMap. Optional spawn coords. */
  loadZoneA: (spawnX?: number, spawnY?: number, disableClamping?: boolean) => Promise<void>;
  /** Loads sandbox_zone_b.json via the engine's loadMap (legacy fallback). */
  loadZoneB: (spawnX?: number, spawnY?: number, disableClamping?: boolean) => Promise<void>;
  /** Closes the NPC dialog overlay and resumes the game. */
  dismissDialog: () => void;
  /** Destroys the engine, releasing WebGL and worker resources. */
  destroyEngine: () => void;
};

export type MapSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class MapSandboxViewModel
  extends BaseViewModel<MapSandboxViewModelOptions>
  implements MapSandboxViewModelInterface
{
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);
  currentMap = $state<string | undefined>(undefined);
  interactionHint = $state<string | undefined>(undefined);
  showDialog = $state<boolean>(false);
  dialogText = $state<string>('');
  dialogNpcName = $state<string>('');
  isStreaming = $state<boolean>(false);

  private _engineBridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _readyCleanup: (() => void) | undefined;
  private _dialogEndCleanup: (() => void) | undefined;
  private _initialMapLoaded = false;

  /**
   * Creates the GameWorld, starts the Web Worker simulation, and binds the
   * PixiJS renderer to the given canvas element.
   *
   * Idempotent — subsequent calls after the first are no-ops.
   */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld) {
      return;
    }

    this.debug('map-sandbox:initializeEngine:start', {
      canvasW: canvas.clientWidth,
      canvasH: canvas.clientHeight,
    });

    try {
      this._engineBridge = createEngineBridge();

      // Listen for GAME_READY — auto-load sandbox_zone_a on first boot
      this._readyCleanup = this._engineBridge.on('GAME_READY', () => {
        this.debug('map-sandbox:event:GAME_READY');
        this.engineReady = true;

        // Only load the initial map on the first GAME_READY.
        // Subsequent GAME_READY events (e.g., from save/load or worker
        // reinitialization) must not trigger another loadMap call.
        if (this._initialMapLoaded) {
          return;
        }
        this._initialMapLoaded = true;

        // Read ?zone=a|b and ?position_x=&position_y= query parameters
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const zone = params.get('zone');

          // Parse optional spawn coordinates (C-180 corner testing).
          // Passed as pixel coordinates; collision system clamps OOB values.
          const rawX = params.get('position_x');
          const rawY = params.get('position_y');
          const spawnX = rawX !== null ? Number.parseInt(rawX, 10) : undefined;
          const spawnY = rawY !== null ? Number.parseInt(rawY, 10) : undefined;

          // C-199: Camera clamping bypass for visual testing.
          // When `true`, the camera can track the player to map corners
          // without the viewport being forced to the map center.
          const disableClamping = params.get('disable_clamping') === 'true';

          if (zone === 'b') {
            void this.loadZoneB(spawnX, spawnY, disableClamping);
            return;
          }

          void this.loadZoneA(spawnX, spawnY, disableClamping);
          return;
        }
        // Default: auto-load debug_map.jton for visual pipeline validation
        void this.loadZoneA();
      });

      // Listen for game errors
      this._engineBridge.on('GAME_ERROR', (event) => {
        this.debug('map-sandbox:event:GAME_ERROR', { message: event.message });
        this.engineError = event.message;
      });

      // Proximity: show "Press E to interact" hint when near NPC
      this._engineBridge.on('NPC_DIALOG_START', (event) => {
        this.debug('map-sandbox:event:NPC_DIALOG_START', { npcName: event.npcName });
        this.interactionHint = `Press E to interact with ${event.npcName}`;
      });

      // Proximity exit: hide hint
      this._dialogEndCleanup = this._engineBridge.on('NPC_DIALOG_END', () => {
        this.debug('map-sandbox:event:NPC_DIALOG_END');
        this.interactionHint = undefined;
      });

      // Manual key interact (E/Enter): open dialog overlay
      this._engineBridge.on('NPC_INTERACTED', (event) => {
        this.debug('map-sandbox:event:NPC_INTERACTED', { npcName: event.npcName });
        this.dialogNpcName = event.npcName;
        this.dialogText = event.dialog;
        this.showDialog = true;
      });

      const EcsWorker = await _resolveEcsWorker();
      const tm = new TextureManager();
      const paletteBytes = new Uint8Array(1024);

      const SANDBOX_RECIPES: Record<number, LpcLayerRecipe> = {
        // Player — 6-layer stack
        1: { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        2: { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        5: { slot: 'torso', assetId: 'torso/chainmail_male', hexPalette: paletteBytes },
        3: { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        6: { slot: 'feet', assetId: 'feet/shoes/male', hexPalette: paletteBytes },
        4: { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
        // NPC — 6-layer stack
        10: { slot: 'body', assetId: 'body/bodies_female', hexPalette: paletteBytes },
        11: { slot: 'hair', assetId: 'hair/long_adult', hexPalette: paletteBytes },
        14: { slot: 'torso', assetId: 'torso/chainmail_female', hexPalette: paletteBytes },
        12: { slot: 'legs', assetId: 'legs/pants_female', hexPalette: paletteBytes },
        15: { slot: 'feet', assetId: 'feet/shoes/female', hexPalette: paletteBytes },
        13: { slot: 'head', assetId: 'head/heads/human_female', hexPalette: paletteBytes },
      };

      const worldOptions: GameWorldOptions = {
        className: 'GameWorld',
        bridge: this._engineBridge,
        textureManager: tm,
        recipeResolver: (layerIds) =>
          layerIds.map((id) => SANDBOX_RECIPES[id]).filter(Boolean) as LpcLayerRecipe[],
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(
            slot,
            assetId,
            state as unknown as import('$lib/data/lpc_models').LpcAnimationState,
          ),
        workerFactory: () => new EcsWorker(),
      };
      this._gameWorld = GameWorld.create(worldOptions);

      // Key press (E): open full dialog via NPC_INTERACTED bridge event
      // (emitted by _handleInteractKey in GameWorld)
      this._gameWorld.onInteractRequest((npc) => {
        this.debug('map-sandbox:interact-request', { npcName: npc.npcName });
        this.dialogNpcName = npc.npcName;
        this.dialogText = npc.dialog || `You approach ${npc.npcName}.`;
        this.showDialog = true;
      });

      this.debug('map-sandbox:initializeEngine:creating-app');
      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });

      this.debug('map-sandbox:initializeEngine:complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.debug('map-sandbox:initializeEngine:error', {
        error: message,
        stack: (err as Error).stack,
      });
      this.engineError = message;
    }
  }

  /**
   * Loads debug_map.jton — 10x10 colour-coded collision test map with
   * grass, water boundary, grey house, and brown door.
   *
   * Contract: C-178 Visual Pipeline Validation
   * Contract: C-180 — accepts optional spawn coordinates via query params
   *
   * @param spawnX - Optional pixel X spawn coordinate (default: 288).
   * @param spawnY - Optional pixel Y spawn coordinate (default: 160).
   * @param disableClamping - Bypass camera viewport clamping (C-199).
   */
  async loadZoneA(spawnX?: number, spawnY?: number, disableClamping?: boolean): Promise<void> {
    const gw = this._gameWorld;
    if (!gw) {
      return;
    }

    const x = spawnX ?? 288;
    const y = spawnY ?? 160;

    try {
      this.debug('map-sandbox:loadDebugJton', { spawnX: x, spawnY: y, disableClamping });
      await gw.loadMap({
        mapUrl: '/assets/maps/debug_map.jton',
        targetX: x,
        targetY: y,
        disableClamping,
      });
      this.currentMap = '/assets/maps/debug_map.jton';
      this.debug('map-sandbox:loadDebugJton:complete');
    } catch (err) {
      this.debug('map-sandbox:loadDebugJton:error', { error: String(err) });
    }
  }

  /**
   * Loads sandbox_zone_b.json — tan indoor chamber with water feature and
   * transition back to zone_a.
   *
   * @param spawnX - Optional pixel X spawn coordinate (default: 128).
   * @param spawnY - Optional pixel Y spawn coordinate (default: 128).
   * @param disableClamping - Bypass camera viewport clamping (C-199).
   */
  async loadZoneB(spawnX?: number, spawnY?: number, disableClamping?: boolean): Promise<void> {
    const gw = this._gameWorld;
    if (!gw) {
      return;
    }

    const x = spawnX ?? 128;
    const y = spawnY ?? 128;

    try {
      this.debug('map-sandbox:loadZoneB', { spawnX: x, spawnY: y, disableClamping });
      await gw.loadMap({
        mapUrl: '/assets/maps/sandbox_zone_b.json',
        targetX: x,
        targetY: y,
        disableClamping,
      });
      this.currentMap = '/assets/maps/sandbox_zone_b.json';
      this.debug('map-sandbox:loadZoneB:complete');
    } catch (err) {
      this.debug('map-sandbox:loadZoneB:error', { error: String(err) });
    }
  }

  /**
   * Destroys the game engine and releases all resources.
   */
  destroyEngine(): void {
    if (this._readyCleanup) {
      this._readyCleanup();
      this._readyCleanup = undefined;
    }
    if (this._dialogEndCleanup) {
      this._dialogEndCleanup();
      this._dialogEndCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._engineBridge = undefined;
    this.engineReady = false;
    this.engineError = undefined;
    this.currentMap = undefined;
    this._initialMapLoaded = false;
    this.showDialog = false;
    this.dialogText = '';
    this.dialogNpcName = '';
    this.interactionHint = undefined;
  }

  /**
   * Closes the NPC dialog overlay and resumes the game.
   */
  dismissDialog(): void {
    this.showDialog = false;
    this.dialogText = '';
    this.dialogNpcName = '';
    this.isStreaming = false;
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this.destroyEngine();
    await super.dispose();
  }
}

export const getMapSandboxViewModel = (
  options: MapSandboxViewModelOptions,
): MapSandboxViewModelInterface => new MapSandboxViewModel(options);
