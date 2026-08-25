// apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type {
  EngineBridge,
  GameCommand,
  GameWorld,
  InteractableStateMap,
} from '@aikami/frontend/engine';
import { createLpcPipeline, projectLpcCatalog } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ContentPackManifest, PackConfig, PersonaData } from '@aikami/types';
import { logger } from '$logger';
import { audioContextManager, equipmentService, personaService } from '$services';
import { authService } from '$services/auth/auth_service.svelte';
import type { ActiveContextEntry, CombatantScreenState, FloatingTextInstance } from '$types';
import { playSfxByName } from '../audio/audio_asset_resolver';

// ---------------------------------------------------------------------------
// GameEngineService — owns the PixiJS engine bridge, world, and game state
//
// Singleton service that manages the entire game engine lifecycle:
// bridge creation, engine initialization, LPC rendering pipeline,
// persona loading, map transitions, save/load, pause/resume,
// combat visual feedback (floating text, screen shake, diegetic HP bars),
// and audio cues.
//
// The ViewModel layer reads reactive state directly from this service.
// ---------------------------------------------------------------------------

/**
 * C-378 AC-9: how long the visual-ready fallback waits for the worker to
 * confirm the requested gameHour before raising __AIKAMI_VISUAL_READY__
 * anyway. The visual runner waits 10s — this bound keeps the capture from
 * timing out when the worker never applies the hour (degraded
 * determinism: whatever tint is in effect gets captured).
 */
const VISUAL_READY_FALLBACK_MS = 5000;

// ---------------------------------------------------------------------------

/** Data passed to the engine for player entity initialization. */
type PlayerInitData = {
  name: string;
  appearanceLayers?: number[];
};

export type GameEngineServiceInterface = BaseFrontendClassInterface & {
  // ── Reactive state ──

  /** The player's current scene name. */
  readonly playerScene: string;

  /**
   * ID of the currently loaded map (derived from the map URL on load,
   * e.g. "emberwatch_village"). Empty before the first map load.
   */
  readonly currentMapId: string;

  /** Whether the PixiJS game engine has initialized and is running. */
  readonly isGameReady: boolean;

  /** Last error message from the game engine, if any. */
  readonly gameError: string | undefined;

  /** Entities the player is currently within proximity of. */
  readonly activeContexts: readonly ActiveContextEntry[];

  /** The logged-in player's display name, or fallback. */
  readonly playerDisplayName: string;

  /** Active floating damage text instances (C-163). */
  readonly floatingTexts: readonly FloatingTextInstance[];

  /** Screen-space HP bar positions for active combatants (C-166). */
  readonly combatantScreenStates: readonly CombatantScreenState[];

  /** Whether the screen is shaking (player hit feedback). */
  readonly isShaking: boolean;

  /**
   * Canvas element that PixiJS renders into.
   * Set by the View via bind:this — the service reacts via $effect.
   */
  canvasElement: HTMLCanvasElement | undefined;

  // ── Commands ──

  /** Removes a floating text instance by ID. */
  removeFloatingText(id: number): void;

  /** Sends a command to the game engine across the EngineBridge. */
  sendCommand(command: GameCommand): void;

  /** Pauses the game engine (stops tick loop, locks input). */
  pauseEngine(): void;

  /** Resumes the game engine (restarts tick loop, unlocks input). */
  resumeEngine(): void;

  /** Forces a PixiJS resize to current canvas dimensions (C-164). */
  triggerResize(): void;

  /** Loads a new map at the given coordinates (C-147, C-172, C-199, C-331). */
  loadMap(options: {
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
     * Content pack owning the map. Defaults to the engine's contentPackId;
     * a v3 save restore may target a different pack than the boot default.
     */
    packId?: string;
  }): Promise<void>;

  /** Restores the game world from a saved ECS snapshot payload. */
  loadSave(payload: string): Promise<void>;

  /**
   * Applies a player-scoped ECS snapshot onto the live world.
   *
   * Used by the map-authoritative restore pipeline: loadMap rebuilds the
   * map's entities, then this merges the player's saved components without
   * clearing the freshly spawned world.
   */
  restorePlayer(payload: string): Promise<void>;

  /**
   * Returns the player's current world-space pixel position, or undefined
   * if the engine has not booted. Used by the save pipeline for the
   * envelope map block (v3+).
   */
  getPlayerPosition(): { x: number; y: number } | undefined;

  /** Destroys the engine and resets all state (on route navigation). */
  destroyEngine(): void;

  /** Boots the engine with the given canvas (called by ViewModel after canvas bind). */
  bootWithCanvas(canvas: HTMLCanvasElement): Promise<void>;

  /** Registers a GameWorld created by the boot pipeline for pause/resume control. */
  registerWorld(world: GameWorld): void;

  /**
   * Flushes all tracked keyboard state (C-332).
   *
   * Clears activeKeys in the main-thread keyboard handler and sends
   * {0,0} velocity to the worker. Call on overlay open/close and window
   * blur to prevent key-state poisoning.
   */
  flushInput(): void;

  /** Initializes the engine bridge and registers listeners (call once before use). */
  initializeEngine(): Promise<void>;

  /**
   * Content pack ID to load on boot.
   * Set by the composition root from the active campaign. Defaults to 'emberwatch'.
   */
  contentPackId: string;
};

export type GameEngineServiceOptions = BaseFrontendClassOptions;

/**
 * Singleton service that owns the entire game engine lifecycle.
 *
 * All engine-internal types (PixiJS, bitECS) are confined here.
 * The ViewModel layer only reads reactive $state fields and calls
 * public methods — it never imports engine code directly.
 */
class GameEngineService
  extends BaseFrontendClass<GameEngineServiceOptions>
  implements GameEngineServiceInterface
{
  // ── Public reactive state ──

  playerScene = $state<string>('unknown');
  currentMapId = $state<string>('');
  isGameReady = $state<boolean>(false);
  gameError = $state<string | undefined>(undefined);
  activeContexts: ActiveContextEntry[] = $state([]);

  /**
   * Canvas element bound via bind:this from the View.
   * Uses $state.raw so Svelte doesn't deep-proxy the WebGL canvas.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  floatingTexts: FloatingTextInstance[] = $state([]);
  combatantScreenStates: CombatantScreenState[] = $state([]);
  isShaking = $state(false);

  // ── Private state ──

  private _bridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _floatingTextIdCounter = 0;
  private _shakeTimeout: ReturnType<typeof setTimeout> | undefined;
  private _personaPlayerName = $state<string>('');
  private _activePersona: PersonaData | undefined;
  private _resizeCleanup: (() => void) | undefined;
  private _initialized = false;
  private _clearContentPackCache: (() => void) | undefined;

  /**
   * C-378 AC-9: whether the gameHour visual-ready subscription is armed.
   * GAME_READY re-fires after every worker restore (LOAD_MAP and
   * RESTORE_PLAYER both re-emit ENGINE_READY) — this guard prevents
   * duplicate ENVIRONMENT_UPDATED listener registration and duplicate
   * SET_ENVIRONMENT_CONFIG sends. Set once per page load and never
   * cleared: the visual runner is a one-shot capture.
   */
  private _visualReadyPending = false;

  /**
   * Content-pack prop frame resolver (C-375 AC-1) — built + preloaded in
   * bootWithCanvas, passed into GameWorld at creation.
   */
  private _propFrameResolverHandle:
    | import('@aikami/frontend/engine').PropFrameResolverHandle
    | undefined;

  /** Content pack ID set by the composition root before boot. */
  contentPackId = $state<string>('emberwatch');

  /**
   * Whether the engine is currently in a boot/pause state.
   * Used by input suppression logging to explain WHY input is blocked.
   */
  get isEnginePaused(): boolean {
    return !this._gameWorld || !this.isGameReady;
  }

  /**
   * Registers a GameWorld instance created by the boot pipeline.
   *
   * Called by {@link GameBootService} after creating the GameWorld so
   * {@link pauseEngine} and {@link resumeEngine} can reach the worker.
   * Without this, all pause/resume calls silently no-op with `:no-world`.
   */
  registerWorld(world: GameWorld): void {
    this._gameWorld = world;
    this.debug('registerWorld:bound');
  }

  /**
   * Flushes all tracked keyboard state (C-332).
   *
   * Delegates to {@link GameWorld.flushInput} to clear activeKeys and
   * send {0,0} velocity. Called on overlay open/close and window blur.
   */
  flushInput(): void {
    this._gameWorld?.flushInput();
  }

  // ── Computed ──

  get playerDisplayName(): string {
    if (this._personaPlayerName) {
      return this._personaPlayerName;
    }
    return authService.currentUser?.displayName || authService.currentUser?.email || 'Unknown';
  }

  // ── Public methods ──

  /**
   * Initializes the engine bridge and registers all game-state listeners.
   *
   * Must be called once when the GameView mounts. PixiJS modules are
   * lazy-imported because they are SSR-incompatible.
   *
   * After calling this, set {@link canvasElement} to trigger engine boot.
   */
  async initializeEngine(): Promise<void> {
    if (this._initialized) {
      this.debug('initializeEngine:already-initialized');
      return;
    }

    // Guard against parallel initialization — set before any await
    this._initialized = true;
    this.debug('initializeEngine:start');

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      this._bridge = createEngineBridge();
      this._registerBridgeListeners();
      await this._loadActivePersona();

      // Reactive canvas → engine boot effect
      this._setupCanvasEffect();
      this.debug('initializeEngine:complete');
    } catch (error) {
      this._initialized = false;
      logger.debug('GameEngineService:bridge-init-failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  removeFloatingText(id: number): void {
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.id !== id);
  }

  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    this._bridge?.send(command);
  }

  /** @inheritdoc */
  pauseEngine(): void {
    if (!this._gameWorld) {
      this.debug('pauseEngine:no-world');
      return;
    }
    this.debug('pauseEngine:locking-input');
    this._gameWorld.pause();
    this._gameWorld.setInputLocked(true);
    // Send explicit PAUSE_ENGINE to worker so the tick loop gates properly
    this._bridge?.send({ type: 'PAUSE_ENGINE' } as unknown as GameCommand);
  }

  /** @inheritdoc */
  resumeEngine(): void {
    if (!this._gameWorld) {
      this.debug('resumeEngine:no-world');
      return;
    }
    // ── Send UNPAUSE_ENGINE first so the worker restores its tick loop
    // before we unlock input — prevents a frame where input arrives
    // before the worker is ready to process it. ──
    this._bridge?.send({ type: 'UNPAUSE_ENGINE' } as unknown as GameCommand);
    this._gameWorld.resume();
    this._gameWorld.setInputLocked(false);
    this.debug('resumeEngine:unlocked-input');
  }

  /** @inheritdoc */
  triggerResize(): void {
    if (this._gameWorld && this.canvasElement) {
      this._gameWorld.resize(this.canvasElement.clientWidth, this.canvasElement.clientHeight);
    }
  }

  /** @inheritdoc */
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
    packId?: string;
  }): Promise<void> {
    if (this._gameWorld) {
      // C-376 AC-2: resolve the pack manifest (cached) and pass a validated
      // packConfig (tiles + props) so the worker can honor `isWalkable` props
      // and derive terrain solidity. The pack is resolved from the
      // map-specific packId (a v3 save restore can target a different pack
      // than the engine's boot default); load failures degrade to
      // `packConfig: undefined` while the map load continues — all props stay
      // solid, matching the pre-C-375 behavior (reviewer-explicit: a manifest
      // fetch hiccup must never become a LOAD_MAP failure).
      const packId = options.packId ?? this.contentPackId;
      // Derive the map id from the URL (e.g. .../village.json → 'village')
      // so the manifest's per-map `interior` flag can be projected (C-417
      // AC-2). Both supported map extensions (.json and .jton) are stripped,
      // case-insensitively, so e.g. inn.jton resolves the manifest key `inn`.
      const mapId = (options.mapUrl.split('/').pop() ?? '').replace(/\.(?:json|jton)$/i, '');
      let packConfig: PackConfig | undefined;
      try {
        const { loadContentPack } = await import('@aikami/frontend/engine');
        const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
        const pack = await loadContentPack({ packId, resolveTag: assetTagResolver });
        packConfig = this._buildPackConfig(pack.manifest, mapId);
      } catch (error) {
        this.error('loadMap:pack-config-failed', {
          packId,
          error: error instanceof Error ? error.message : String(error),
          hint: 'Manifest resolution failed — map loads with all props solid and collision-layer fallback.',
        });
      }
      await this._gameWorld.loadMap({
        ...options,
        packConfig,
      });
      this.currentMapId = mapId;
      this.debug('loadMap:map-id', { currentMapId: this.currentMapId });
    }
  }

  /** @inheritdoc */
  async loadSave(payload: string): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized — cannot load save');
    }
    await this._gameWorld.restoreWorld(payload);
  }

  /** @inheritdoc */
  async restorePlayer(payload: string): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized — cannot restore player');
    }
    await this._gameWorld.restorePlayer(payload);
  }

  /** @inheritdoc */
  getPlayerPosition(): { x: number; y: number } | undefined {
    return this._gameWorld?.getPlayerPosition();
  }

  /** @inheritdoc */
  destroyEngine(): void {
    this.debug('destroyEngine:start', { wasReady: this.isGameReady });

    if (this._resizeCleanup) {
      this._resizeCleanup();
      this._resizeCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    // C-375: drop the prop frame resolver handle.
    this._propFrameResolverHandle?.clearCache();
    this._propFrameResolverHandle = undefined;

    this.isGameReady = false;
    this.playerScene = 'unknown';
    this.currentMapId = '';
    this.gameError = undefined;
    this.activeContexts = [];
    this.floatingTexts = [];
    this.combatantScreenStates = [];

    if (this._shakeTimeout) {
      clearTimeout(this._shakeTimeout);
      this._shakeTimeout = undefined;
    }
    this.isShaking = false;

    // ── Reset initialization guard so re-mounts can reinit (C-332 AC-fix) ──
    this._initialized = false;
    this._personaPlayerName = '';
    this._activePersona = undefined;
    this._floatingTextIdCounter = 0;

    // Clear content pack cache so the next boot re-fetches the manifest (C-315)
    if (this._clearContentPackCache) {
      this._clearContentPackCache();
      this._clearContentPackCache = undefined;
    }

    this.debug('destroyEngine:complete');
  }

  /**
   * Builds the runtime pack config (tiles + props) from the manifest (C-376 AC-2).
   *
   * The manifest lives on the main thread; only this validated projection
   * crosses the worker boundary once per map load. Replaces the C-375
   * `propWalkability` side channel — future manifest-driven properties
   * (collision rects, movement cost, interaction radius) ride the same field.
   *
   * C-417 AC-2: the map's `interior` flag is projected too, so the engine can
   * pin interior lighting independent of the world clock. The property is
   * declared per-map in the manifest — no hard-coding in engine code.
   */
  private _buildPackConfig(
    manifest: Pick<ContentPackManifest, 'tiles' | 'props' | 'terrains' | 'npcs' | 'maps'>,
    mapId: string,
  ): PackConfig {
    return {
      // C-417 AC-2: carry the current map's interior flag (declared in the
      // manifest's per-map entry) only when the map is declared interior —
      // never emit explicit undefined.
      ...(manifest.maps?.[mapId]?.interior === true ? { interior: true } : {}),
      tiles: Object.fromEntries(
        Object.entries(manifest.tiles ?? {}).map(([gid, def]) => [
          gid,
          {
            name: def.name,
            frame: def.frame,
            isWalkable: def.isWalkable,
            // Optional schema fields are carried only when present — never
            // emitted as explicit undefined, which would fail the worker's
            // TypeBox validation after structured clone (CodeRabbit review,
            // C-376 round 2).
            ...(def.isWall === undefined ? {} : { isWall: def.isWall }),
            ...(def.movementCost === undefined ? {} : { movementCost: def.movementCost }),
          },
        ]),
      ),
      props: Object.fromEntries(
        Object.entries(manifest.props ?? {}).map(([propId, def]) => {
          const projected: {
            name: string;
            frame: string;
            isWalkable?: boolean;
            anchor?: { x: number; y: number };
            collision?:
              | { type: 'rect'; width: number; height: number }
              | { type: 'circle'; radius: number };
          } = { name: def.name, frame: def.frame };
          if (def.isWalkable !== undefined) {
            projected.isWalkable = def.isWalkable;
          }
          // C-378 AC-7: the manifest anchor must cross the worker boundary
          // so the engine can apply custom prop anchors (non-default pivot)
          // — without it, multi-tile props silently fall back to (0.5, 1).
          if (def.anchor !== undefined) {
            projected.anchor = def.anchor;
          }
          if (def.collision) {
            projected.collision = def.collision;
          }
          return [propId, projected];
        }),
      ),
      // C-378: terrains cross the worker boundary so the autotiler can run
      // inside the world (map load). Carried only when the pack declares
      // them — a terrain-less pack stays legacy (AC-8).
      ...(manifest.terrains === undefined ? {} : { terrains: manifest.terrains }),
      // C-400: NPC appearance crosses the worker boundary so the entity
      // spawner reads appearance from the manifest (npcId → appearanceLayers)
      // instead of Tiled spawn-point properties. Carried only when the pack
      // declares NPCs — legacy packs keep the spawner's default stack.
      ...(manifest.npcs === undefined
        ? {}
        : {
            npcs: Object.fromEntries(
              Object.entries(manifest.npcs).map(([npcId, def]) => [
                npcId,
                {
                  // Optional appearanceLayers is carried only when present.
                  ...(def.appearanceLayers === undefined
                    ? {}
                    : { appearanceLayers: def.appearanceLayers }),
                },
              ]),
            ),
          }),
    };
  }

  // ── Private: bridge event registration ──

  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('GAME_READY', () => {
      this.isGameReady = true;
      // C-378 AC-9 visual hook: `?gameHour=<0-23>` pre-configures the
      // environment hour once the world is ready (the SET_ENVIRONMENT_CONFIG
      // command handler is registered at world creation). Purely additive —
      // absent the param (or an empty one), the game boots at its default
      // hour and no command is dispatched.
      if (typeof window !== 'undefined') {
        const rawHour = new URLSearchParams(window.location.search).get('gameHour');
        const hour = rawHour === null || rawHour.trim() === '' ? Number.NaN : Number(rawHour);
        if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
          // C-378 visual determinism: the visual runner waits for this flag
          // instead of a blind sleep, so the gameHour tint (and the scene
          // state) is applied before the capture. The worker applies the
          // start hour asynchronously, so the flag is raised only once an
          // ENVIRONMENT_UPDATED event confirms the environment is at the
          // requested hour.
          //
          // Guard: GAME_READY re-fires after worker restores (LOAD_MAP and
          // RESTORE_PLAYER both re-emit ENGINE_READY). Only the FIRST fire
          // registers the subscription and dispatches the config — repeated
          // fires would leak listeners and re-send SET_ENVIRONMENT_CONFIG.
          if (this._visualReadyPending) {
            return;
          }
          this._visualReadyPending = true;
          const offReady = bridge.on('ENVIRONMENT_UPDATED', (event) => {
            if (event.gameHour === hour) {
              window.clearTimeout(fallback);
              offReady();
              (window as unknown as Record<string, unknown>).__AIKAMI_VISUAL_READY__ = true;
            }
          });
          // Bounded fallback: if the worker never confirms the requested
          // hour (fractional gameHour drift, missing STATE_UPDATEs, or a
          // worker that never applies the config), still raise the flag so
          // the visual runner's 10s wait does not time out. The capture
          // then proceeds with whatever tint is in effect (degraded
          // determinism instead of a hard failure).
          const fallback = window.setTimeout(() => {
            offReady();
            (window as unknown as Record<string, unknown>).__AIKAMI_VISUAL_READY__ = true;
          }, VISUAL_READY_FALLBACK_MS);
          bridge.send({
            type: 'SET_ENVIRONMENT_CONFIG',
            startHour: hour,
          } as unknown as GameCommand);
          return;
        }
        // Normal boot / empty param — the default environment is already in
        // effect, so the world is immediately ready for capture.
        (window as unknown as Record<string, unknown>).__AIKAMI_VISUAL_READY__ = true;
      }
    });

    bridge.on('GAME_ERROR', (event) => {
      this.gameError = event.message;
    });

    bridge.on('PLAYER_POSITION_CHANGED', (event) => {
      this.playerScene = event.scene;
    });

    bridge.on('SCENE_LOADED', (event) => {
      this.playerScene = event.sceneId;
    });

    bridge.on('CONTEXT_ENTERED', (event) => {
      const entry: ActiveContextEntry = {
        entityId: event.entityId,
        npcId: event.contextPayload.npcId,
        npcName: event.contextPayload.npcName,
        dialog: event.contextPayload.dialog,
        interactionRadius: event.contextPayload.interactionRadius,
      };
      this.activeContexts = [...this.activeContexts, entry];
    });

    bridge.on('CONTEXT_EXITED', (event) => {
      this.activeContexts = this.activeContexts.filter((ctx) => ctx.entityId !== event.entityId);
    });

    bridge.on('DAMAGE_DEALT', (event) => {
      const id = ++this._floatingTextIdCounter;
      const instance: FloatingTextInstance = {
        id,
        amount: event.amount,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2 - 60,
        isCritical: event.isCritical,
      };
      this.floatingTexts = [...this.floatingTexts, instance];

      if (event.entityId === 1) {
        this._triggerScreenShake();
      }

      void this._playHitSfx();
    });

    bridge.on('COMBAT_STATE_UPDATE', (event) => {
      const screenX = event.entityScreenX as Record<number, number> | undefined;
      const screenY = event.entityScreenY as Record<number, number> | undefined;
      const hpMap = event.entityHpMap as Record<number, number> | undefined;
      const maxHpMap = event.entityMaxHpMap as Record<number, number> | undefined;
      const activeTurn = event.activeTurnEntity as number | undefined;
      if (!screenX || !screenY || !hpMap || !maxHpMap) {
        this.combatantScreenStates = [];
        return;
      }
      const states: CombatantScreenState[] = [];
      for (const key of Object.keys(screenX)) {
        const eid = Number(key);
        states.push({
          entityId: eid,
          hp: hpMap[eid] ?? 0,
          maxHp: maxHpMap[eid] ?? 0,
          screenX: screenX[eid] ?? 0,
          screenY: screenY[eid] ?? 0,
          isActiveTurn: eid === activeTurn,
        });
      }
      this.combatantScreenStates = states;
    });
  }

  // ── Private: canvas → engine boot effect ──

  private _setupCanvasEffect(): void {
    // We use a simple reactive pattern: when canvasElement is set,
    // boot the engine. When it's cleared, tear down.
    // This is done via a reactive watch since BaseFrontendClass
    // doesn't have registerEffectRoot (ViewModel only).
    // Track canvas changes manually via a polling pattern or let
    // the ViewModel bridge handle this. Since this is a service
    // (not a ViewModel), we expose `bootWithCanvas` as a public hook.
    //
    // The ViewModel's registerEffectRoot will call bootWithCanvas
    // and destroyEngine reactively.
  }

  /**
   * Boots the game engine with the given canvas element.
   * Called by the ViewModel when the canvas is first bound.
   */
  async bootWithCanvas(canvas: HTMLCanvasElement): Promise<void> {
    const bridge = this._bridge;
    if (!bridge || this._gameWorld) {
      return;
    }

    try {
      // Resolve starting map + build the prop frame resolver from the
      // content pack (C-375 AC-1). The pack must be loaded BEFORE GameWorld
      // is created so the resolver is ready for the first ENTITY_CREATED.
      const { GameWorld: EngineGameWorld, TextureManager } = await import(
        '@aikami/frontend/engine'
      );
      const { getLpcAssetPath, wireLpcUrlResolver } = await import('$lib/data/lpc_asset_catalog');
      // C-372: ensure the manifest-backed LPC resolver is wired and the manifest
      // is loaded before the engine boots (idempotent — catalog module scope
      // also wires it).
      await wireLpcUrlResolver();
      const { GENERATED_LPC_SLOTS: generatedLpcSlots } = await import(
        '$lib/data/lpc_asset_catalog_generated'
      );

      const textureManager = new TextureManager();

      const pipeline = this._buildLpcPipeline(generatedLpcSlots, (slot, assetId, state) =>
        getLpcAssetPath(slot, assetId, state as unknown as number),
      );

      const playerData = this._buildPlayerData();

      // ── C-375: load the pack before world creation for prop wiring ──
      const { loadContentPack: loadPack, clearContentPackCache: clearCacheFn } = await import(
        '@aikami/frontend/engine'
      );
      this._clearContentPackCache = clearCacheFn;
      const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
      const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
      const releaseUrl = (url: string) => assetManager.releaseUrl(url);
      const pack = await loadPack({
        packId: this.contentPackId,
        resolveTag: assetTagResolver,
        releaseUrl,
      });
      const { buildPropFrameResolver } = await import('./prop_frame_resolver');
      this._propFrameResolverHandle = await buildPropFrameResolver(pack.manifest);

      this._gameWorld = (EngineGameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
        className: 'GameWorld',
        bridge,
        recipeResolver: pipeline.recipeResolver,
        assetUrlResolver: pipeline.assetUrlResolver,
        // C-400: forward the projected catalog so the worker resolves the
        // same slot/assetId sequences as the main-thread resolver.
        lpcCatalog: pipeline.catalog,
        // C-374: merge equipped items onto the player's base LPC render
        equipmentRecipeProvider: () => equipmentService.buildLpcRecipes(),
        textureManager,
        // C-375 AC-1: deterministic prop frame resolution.
        propFrameResolver: this._propFrameResolverHandle?.resolver,
        // C-434: registry-backed tag resolver for maps and tilesets.
        resolveTag: assetTagResolver,
        releaseUrl,
      });

      // Campaign data drives world initialization via the composition root.
      // When no campaign is active (first boot), the world starts with defaults.
      const initialPayload = undefined;

      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        initialPayload,
        playerData,
      });

      // Resolve starting map from the content pack (C-315).
      // Falls back to emberwatch sandbox zone A when no campaign is active.
      const startingMap = pack.getStartingMap();

      // ── C-327 AC-3: Load onboarding hints from the content pack ──
      if (pack.manifest.onboarding) {
        const { onboardingHintService: svc } = await import('./onboarding_hint_service.svelte.ts');
        svc.loadOnboarding({
          packId: this.contentPackId,
          onboarding: pack.manifest.onboarding,
        });
      } else {
        // Clear stale hints from a previous pack that had onboarding
        const { onboardingHintService: svc } = await import('./onboarding_hint_service.svelte.ts');
        svc.resetOnboarding();
      }
      // Also refresh keybindings when loading the pack (for current bindings)
      {
        const { inputActionService: inputSvc } = await import('./input_action_service.svelte.ts');
        inputSvc.refreshBindings();
      }

      await this._gameWorld.loadMap({
        mapUrl: pack.resolveMapUrl(pack.manifest.startingMapId),
        targetX: startingMap.defaultX ?? 160,
        targetY: startingMap.defaultY ?? 192,
        // C-376 AC-2: pass the resolved pack config (tiles + props) so the
        // worker's spawner can skip blocking for walkable props (e.g.
        // village_gate) and derive terrain solidity from the manifest.
        // C-417 AC-2: the starting map's `interior` flag rides the same
        // projection so the engine pins interior lighting on boot.
        packConfig: this._buildPackConfig(pack.manifest, pack.manifest.startingMapId),
      });
      // Track the starting map id for scene/vibe context.
      this.currentMapId = pack.manifest.startingMapId;
      this.debug('loadMap:starting-map-id', { currentMapId: this.currentMapId });

      this._registerResizeHandler();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.gameError = message;
    }
  }

  // ── Private: LPC pipeline ──

  private _buildPlayerData(): PlayerInitData | undefined {
    if (!this._activePersona?.name) {
      return undefined;
    }

    const playerData: PlayerInitData = { name: this._activePersona.name };

    const lpcRecipe = (this._activePersona.appearance as Record<string, unknown> | undefined)
      ?.lpcRecipe as Record<string, string> | undefined;

    const { generatedLpcSlots } = this._getLpcCatalogSync();
    if (generatedLpcSlots.length === 0) {
      this.warn('lpc.engine.noCatalog');
      return playerData;
    }

    // Build slot → catalog index lookup first
    const slotIndexMap = new Map<string, number>();
    for (let i = 0; i < generatedLpcSlots.length; i++) {
      slotIndexMap.set(generatedLpcSlots[i].slot, i);
    }

    // Use DEFAULT_LPC_RECIPE as the base. Only allow persona's recipe
    // to override slots where the asset ID is valid in the catalog.
    const effectiveRecipe: Record<string, string> = { ...DEFAULT_LPC_RECIPE };
    if (lpcRecipe) {
      for (const [slot, assetId] of Object.entries(lpcRecipe)) {
        const catalogIdx = slotIndexMap.get(slot);
        if (catalogIdx !== undefined) {
          const slotDef = generatedLpcSlots[catalogIdx];
          const found = slotDef?.variants.some((v) => v.assetId === assetId);
          if (found) {
            effectiveRecipe[slot] = assetId;
          }
        }
      }
    }

    this.debug('lpc.engine.PlayerData', {
      personaId: this._activePersona.id,
      personaName: this._activePersona.name,
      hasRecipe: !!lpcRecipe,
      recipeSlots: lpcRecipe ? Object.keys(lpcRecipe).join(',') : 'none',
      recipeRaw: lpcRecipe ?? {},
      effectiveRecipe,
    });

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

    const SlotFallbacks: Record<string, number> = {
      body: 3,
      hair: 3,
      torso: 0,
      legs: 22,
      feet: 0,
      head: 95,
    };

    const appearanceLayers: number[] = [];
    for (const slotName of EngineSlots) {
      const assetId = effectiveRecipe[slotName];
      if (!assetId) {
        appearanceLayers.push(SlotFallbacks[slotName] ?? 1);
        continue;
      }
      const catalogIdx = slotIndexMap.get(slotName);
      if (catalogIdx === undefined) {
        appearanceLayers.push(SlotFallbacks[slotName] ?? 1);
        continue;
      }
      const slotDef = generatedLpcSlots[catalogIdx];
      if (!slotDef) {
        appearanceLayers.push(SlotFallbacks[slotName] ?? 1);
        continue;
      }
      const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
      appearanceLayers.push(variantIdx >= 0 ? variantIdx + 1 : (SlotFallbacks[slotName] ?? 1));
    }

    // C-430: zeroEquipmentOwnedAppearanceSlots removed — variable-length slots
    // replace the fixed six-slot ceiling. Equipment adds its own layers.
    playerData.appearanceLayers = appearanceLayers;

    // C-374: seed the base outfit (chainmail + boots by default) into the
    // equipment service so the paperdoll reflects what the character wears.
    equipmentService.seedBaseOutfit(effectiveRecipe);

    this.debug('lpc.engine.appearanceLayers', { appearanceLayers });

    return playerData;
  }

  /**
   * Synchronous LPC catalog accessor — for use in _buildPlayerData
   * where we can't await the dynamic import inside a non-async function.
   */
  private _getLpcCatalogSync(): {
    generatedLpcSlots: readonly { slot: string; variants: readonly { assetId: string }[] }[];
  } {
    // Import at module level is not possible since it's dynamically resolved.
    // We cache the result after first bootWithCanvas call.
    if (this._cachedLpcSlots) {
      return { generatedLpcSlots: this._cachedLpcSlots };
    }
    return { generatedLpcSlots: [] };
  }

  private _cachedLpcSlots:
    | readonly { slot: string; variants: readonly { assetId: string }[] }[]
    | undefined;

  private _buildLpcPipeline(
    generatedLpcSlots: readonly { slot: string; variants: readonly { assetId: string }[] }[],
    getLpcAssetPath: (_slot: string, assetId: string, state: string) => string | null,
  ) {
    // C-400: single source of truth — the engine's shared createLpcPipeline
    // (projected catalog + pure resolver + asset URL resolver). The
    // hard-coded head override and the numeric-string asset IDs are gone;
    // worker and main thread share this exact function.
    this._cachedLpcSlots = generatedLpcSlots;
    return createLpcPipeline({
      catalog: projectLpcCatalog(generatedLpcSlots),
      getLpcAssetPath,
    });
  }

  // ── Private: persona loading ──

  private async _loadActivePersona(): Promise<void> {
    try {
      const activePersona = await personaService.getActivePersona();
      if (activePersona) {
        this._activePersona = activePersona;
        this._personaPlayerName = activePersona.name || activePersona.race || '';
        return;
      }
    } catch (error) {
      logger.debug('GameEngineService:loadActivePersona:local-failed', {
        error: String(error),
      });
    }

    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const characters = JSON.parse(stored) as Array<{ persona: PersonaData }>;
        if (characters.length > 0) {
          const persona = characters[characters.length - 1].persona;
          this._activePersona = persona;
          this._personaPlayerName = persona.name || persona.race || '';
        }
      }
    } catch (error) {
      logger.debug('GameEngineService:loadActivePersona:localStorage-failed', {
        error: String(error),
      });
    }
  }

  // ── Private: screen shake ──

  private _triggerScreenShake(): void {
    if (this._shakeTimeout) {
      clearTimeout(this._shakeTimeout);
    }
    this.isShaking = true;
    this._shakeTimeout = setTimeout(() => {
      this.isShaking = false;
      this._shakeTimeout = undefined;
    }, 300);
  }

  // ── Private: audio ──

  private async _playHitSfx(): Promise<void> {
    try {
      if (audioContextManager.context.state === 'suspended') {
        await audioContextManager.context.resume();
      }
      await playSfxByName('sfx_hit');
    } catch (error) {
      logger.debug('GameEngineService:_playHitSfx:failed', { error: String(error) });
    }
  }

  // ── Private: resize ──

  private _registerResizeHandler(): void {
    const handleResize = (): void => {
      if (this._gameWorld && this.canvasElement) {
        this._gameWorld.resize(this.canvasElement.clientWidth, this.canvasElement.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    this._resizeCleanup = (): void => {
      window.removeEventListener('resize', handleResize);
    };
  }
}

/** Singleton instance of the game engine service. */
export const gameEngineService: GameEngineServiceInterface = GameEngineService.create({
  className: 'GameEngineService',
}) as GameEngineServiceInterface;
