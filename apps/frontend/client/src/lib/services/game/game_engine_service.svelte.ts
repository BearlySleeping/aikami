// apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts

import type { EngineBridge, GameCommand, GameWorld, LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { audioContextManager } from '$lib/services/audio/audio_context_manager.ts';
import { personaService } from '$lib/services/persona/persona_repository.svelte';
import { logger } from '$logger';
import { audioService } from '$services';
import { authService } from '$services/auth/auth_service.svelte';
import type { ActiveContextEntry } from '$types';

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

// ── Re-exported types (used by ViewModel and View) ──

/** A single floating damage text instance rendered in the Svelte UI layer. */
export type FloatingTextInstance = {
  readonly id: number;
  readonly amount: number;
  readonly x: number;
  readonly y: number;
  readonly isCritical: boolean;
};

/** Screen-space state for a combatant — used by diegetic health bars (C-166). */
export type CombatantScreenState = {
  readonly entityId: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly isActiveTurn: boolean;
};

/** Data passed to the engine for player entity initialization. */
type PlayerInitData = {
  name: string;
  appearanceLayers?: number[];
};

export type GameEngineServiceInterface = BaseFrontendClassInterface & {
  // ── Reactive state ──

  /** The player's current scene name. */
  readonly playerScene: string;

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

  /** Loads a new map at the given coordinates (C-147, C-172, C-199). */
  loadMap(options: {
    mapUrl: string;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    targetSpawnHash?: number;
    disableClamping?: boolean;
  }): Promise<void>;

  /** Restores the game world from a saved ECS snapshot payload. */
  loadSave(payload: string): Promise<void>;

  /** Destroys the engine and resets all state (on route navigation). */
  destroyEngine(): void;

  /** Boots the engine with the given canvas (called by ViewModel after canvas bind). */
  bootWithCanvas(canvas: HTMLCanvasElement): Promise<void>;

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

  /** Content pack ID set by the composition root before boot. */
  contentPackId = $state<string>('emberwatch');

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
      return;
    }
    this._initialized = true;

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      this._bridge = createEngineBridge();
      this._registerBridgeListeners();
      await this._loadActivePersona();

      // Reactive canvas → engine boot effect
      this._setupCanvasEffect();
    } catch (error) {
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
    if (this._gameWorld) {
      this._gameWorld.pause();
      this._gameWorld.setInputLocked(true);
    }
  }

  /** @inheritdoc */
  resumeEngine(): void {
    if (this._gameWorld) {
      this._gameWorld.setInputLocked(false);
      this._gameWorld.resume();
    }
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
    targetSpawnHash?: number;
    disableClamping?: boolean;
  }): Promise<void> {
    if (this._gameWorld) {
      await this._gameWorld.loadMap(options);
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
  destroyEngine(): void {
    if (this._resizeCleanup) {
      this._resizeCleanup();
      this._resizeCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this.isGameReady = false;

    if (this._shakeTimeout) {
      clearTimeout(this._shakeTimeout);
      this._shakeTimeout = undefined;
    }

    // Clear content pack cache so the next boot re-fetches the manifest (C-315)
    if (this._clearContentPackCache) {
      this._clearContentPackCache();
      this._clearContentPackCache = undefined;
    }
  }

  // ── Private: bridge event registration ──

  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('GAME_READY', () => {
      this.isGameReady = true;
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
      const { GameWorld, TextureManager } = await import('@aikami/frontend/engine');
      const { getLpcAssetPath } = await import('$lib/data/lpc_asset_catalog');
      const { GENERATED_LPC_SLOTS: generatedLpcSlots } = await import(
        '$lib/data/lpc_asset_catalog_generated'
      );

      const playerData = this._buildPlayerData();
      const textureManager = new TextureManager();

      const { recipeResolver, assetUrlResolver } = this._buildLpcPipeline(
        generatedLpcSlots,
        (slot, assetId, state) => getLpcAssetPath(slot, assetId, state as unknown as number),
      );

      this._gameWorld = (GameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
        className: 'GameWorld',
        bridge,
        recipeResolver,
        assetUrlResolver,
        textureManager,
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
      const { loadContentPack: loadPack, clearContentPackCache: clearCacheFn } = await import(
        '@aikami/frontend/engine'
      );
      this._clearContentPackCache = clearCacheFn;
      const pack = await loadPack({ packId: this.contentPackId });
      const startingMap = pack.getStartingMap();

      // ── C-327 AC-3: Load onboarding hints from the content pack ──
      if (pack.manifest.onboarding) {
        const { onboardingHintService: svc } = await import('./onboarding_hint_service.svelte.ts');
        svc.loadOnboarding({
          packId: this.contentPackId,
          onboarding: pack.manifest.onboarding,
        });
        // Also refresh keybindings when loading the pack (for current bindings)
        const { inputActionService: inputSvc } = await import('./input_action_service.svelte.ts');
        inputSvc.refreshBindings();
      }

      await this._gameWorld.loadMap({
        mapUrl: pack.resolveMapUrl(pack.manifest.startingMapId),
        targetX: startingMap.defaultX ?? 160,
        targetY: startingMap.defaultY ?? 192,
      });

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

    if (!lpcRecipe) {
      return playerData;
    }

    const { generatedLpcSlots } = this._getLpcCatalogSync();
    if (!generatedLpcSlots) {
      return playerData;
    }

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;
    const slotIndexMap = new Map<string, number>();
    for (let i = 0; i < generatedLpcSlots.length; i++) {
      slotIndexMap.set(generatedLpcSlots[i].slot, i);
    }

    const appearanceLayers: number[] = [];
    for (const slotName of EngineSlots) {
      const assetId = lpcRecipe[slotName];
      if (!assetId) {
        appearanceLayers.push(1);
        continue;
      }
      const catalogIdx = slotIndexMap.get(slotName);
      if (catalogIdx === undefined) {
        appearanceLayers.push(1);
        continue;
      }
      const slotDef = generatedLpcSlots[catalogIdx];
      if (!slotDef) {
        appearanceLayers.push(1);
        continue;
      }
      const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
      appearanceLayers.push(variantIdx >= 0 ? variantIdx + 1 : 1);
    }
    playerData.appearanceLayers = appearanceLayers;

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
    getLpcAssetPath: (_slot: string, assetId: string, state: string) => string,
  ): {
    recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
    assetUrlResolver: (_slot: string, assetId: string, state: string) => string;
  } {
    this._cachedLpcSlots = generatedLpcSlots;

    const SlotCatalogIndex: Record<string, number> = {};
    for (let idx = 0; idx < generatedLpcSlots.length; idx++) {
      SlotCatalogIndex[generatedLpcSlots[idx].slot] = idx;
    }

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

    const recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
      const recipes: LpcLayerRecipe[] = [];
      for (let i = 0; i < EngineSlots.length; i++) {
        const rawId = layerIds[i];
        const slotName = EngineSlots[i] ?? `layer_${i}`;
        const catalogIdx = SlotCatalogIndex[slotName];
        if (catalogIdx === undefined) {
          continue;
        }
        const slotDef = generatedLpcSlots[catalogIdx];
        let effectiveIdx = typeof rawId === 'number' ? rawId - 1 : slotName === 'head' ? 94 : -1;
        if (slotName === 'head' && effectiveIdx < 0) {
          effectiveIdx = 94;
        }
        const variant = slotDef?.variants[effectiveIdx];
        if (!variant) {
          continue;
        }
        recipes.push({
          slot: slotName,
          assetId: variant.assetId,
          hexPalette: new Uint8Array(1024),
        });
      }
      return recipes;
    };

    const assetUrlResolver = (_slot: string, assetId: string, state: string): string => {
      return getLpcAssetPath(_slot, assetId, state);
    };

    return { recipeResolver, assetUrlResolver };
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
      logger.debug('GameEngineService:loadActivePersona:firestore-failed', {
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
      await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
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
