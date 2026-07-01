// apps/frontend/client/src/lib/views/game/canvas/game_view_model.svelte.ts

import type { EngineBridge, GameCommand, GameWorld } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { authService, consumePendingGameLoad } from '$services';
import type { ActiveContextEntry } from '$types';

// ---------------------------------------------------------------------------
// GameViewModel — Svelte 5 ViewModel for the game canvas
// ---------------------------------------------------------------------------

/** Data passed to the engine for player entity initialization. */
type PlayerInitData = {
  /** The player character's name (from persona). */
  name: string;
  /**
   * LPC appearance layer indices from character creation.
   * 1-indexed variant numbers: [body, hair, torso, legs, feet, head].
   *
   * Contract: C-158 LPC Avatar Integration
   */
  appearanceLayers?: number[];
};

export type GameViewModelOptions = BaseViewModelOptions;

/** A single floating damage text instance rendered in the Svelte UI layer. */
export type FloatingTextInstance = {
  /** Unique ID for Svelte {#each} keying. */
  readonly id: number;
  /** Damage amount to display. */
  readonly amount: number;
  /** Screen-space X coordinate (CSS pixels). */
  readonly x: number;
  /** Screen-space Y coordinate (CSS pixels). */
  readonly y: number;
  /** Whether this was a critical hit. */
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

export type GameViewModelInterface = BaseViewModelInterface & {
  /** The player's current scene name. */
  readonly playerScene: string;

  /** Whether the PixiJS game engine has initialized and is running. */
  readonly isGameReady: boolean;

  /** Last error message from the game engine, if any. */
  readonly gameError: string | undefined;

  /**
   * Array of active spatial contexts — entities the player is currently
   * within proximity of. Updated reactively via bridge events.
   */
  readonly activeContexts: ActiveContextEntry[];

  /** The logged-in player's display name, or 'Unknown' if not available. */
  readonly playerDisplayName: string;

  /**
   * Active floating damage text instances to render in the UI.
   * Each entry auto-removes after its animation completes (~1.2s).
   *
   * Contract: C-163 Visceral Feedback Juice
   */
  readonly floatingTexts: readonly FloatingTextInstance[];

  /** Screen-space HP bar positions for active combatants (C-166). */
  readonly combatantScreenStates: readonly CombatantScreenState[];

  /**
   * Whether the screen is currently shaking from a player hit.
   * Triggers a brief CSS animation on the game viewport container.
   */
  readonly isShaking: boolean;

  /** Removes a floating text instance by ID (called when animation completes). */
  removeFloatingText(id: number): void;

  /**
   * The canvas element that PixiJS renders into.
   * Set by the View via bind:this — the ViewModel reacts via $effect.
   */
  canvasElement: HTMLCanvasElement | undefined;

  /**
   * Sends a command to the game engine across the EngineBridge boundary.
   * All UI→Game communication flows through this method.
   */
  sendCommand(command: GameCommand): void;

  /** Pauses the game engine (stops the tick loop). Called when an overlay opens. */
  pauseEngine(): void;

  /** Resumes the game engine (restarts the tick loop). Called when an overlay closes. */
  resumeEngine(): void;

  /**
   * Forces a PixiJS resize to the canvas element's current client dimensions.
   *
   * Called when the CSS grid layout changes (combat split-screen transition)
   * so the engine doesn't render stretched or blurry pixels. Also used by
   * the window resize handler.
   *
   * Contract: C-164 Combat Split-Screen Layout
   */
  triggerResize(): void;

  /**
   * Loads a new map at the given coordinates.
   * Accepts an optional list of defeated enemy spawn IDs to filter out,
   * and an optional targetSpawnHash for C-172 spawn point resolution.
   *
   * Contract: C-147 Progression & Persistence, C-172 Staging World Transitions, C-199
   */
  loadMap(options: {
    mapUrl: string;
    targetX: number;
    targetY: number;
    defeatedEnemies?: string[];
    targetSpawnHash?: number;
    disableClamping?: boolean;
  }): Promise<void>;

  /**
   * Restores the game world from a saved ECS snapshot payload.
   *
   * Clears all current entities and hydrates from the serialized state.
   * The engine must be initialized before calling this method.
   *
   * @param payload - The serialized ECS snapshot JSON string from IndexedDB.
   * @throws If the engine is not yet initialized.
   */
  loadSave(payload: string): Promise<void>;
};

/**
 * ViewModel for the `/game` route.
 *
 * Follows the Svelte 5 ViewModel pattern: all reactive state lives here
 * via `$state` runes. The View (.svelte) is a thin wrapper.
 *
 * **Critical boundary rule**: This ViewModel NEVER imports PixiJS, bitECS,
 * or any game-internal types. All communication with the game engine goes
 * through the typed {@link import('@aikami/frontend/engine').EngineBridge}.
 */
class GameViewModel extends BaseViewModel<GameViewModelOptions> implements GameViewModelInterface {
  playerScene = $state<string>('unknown');

  isGameReady = $state<boolean>(false);

  gameError = $state<string | undefined>(undefined);

  activeContexts: ActiveContextEntry[] = $state([]);

  /**
   * Canvas element that PixiJS renders into — set by the View via bind:this.
   *
   * Uses {@link $state.raw} so Svelte stores the canvas by reference without
   * deep-proxying it. WebGL contexts cannot survive Svelte's Proxy wrapper —
   * proxied canvas elements silently fail to render.
   */
  canvasElement = $state.raw<HTMLCanvasElement | undefined>(undefined);

  /**
   * The player character's name.
   * Uses the active persona name if loaded, otherwise falls back to auth display name.
   */
  get playerDisplayName() {
    if (this._personaPlayerName) {
      return this._personaPlayerName;
    }
    return authService.currentUser?.displayName || authService.currentUser?.email || 'Unknown';
  }

  /**
   * Active floating damage text instances — populated by DAMAGE_DEALT bridge events.
   * Each instance auto-removes after its CSS animation completes (~1.2s).
   *
   * Contract: C-163 Visceral Feedback Juice
   */
  floatingTexts: FloatingTextInstance[] = $state([]);

  /** Diegetic HP bar positions for active combatants (C-166). */
  combatantScreenStates: CombatantScreenState[] = $state([]);

  /**
   * Screen shake flag — set to true when the player takes damage,
   * cleared after the shake animation completes (~300ms).
   */
  isShaking = $state(false);

  /** Incrementing counter for floating text instance IDs. */
  private _floatingTextIdCounter = 0;

  /** Screen shake timeout handle for cleanup. */
  private _shakeTimeout: ReturnType<typeof setTimeout> | undefined;

  /** Player character name loaded from the active persona. */
  private _personaPlayerName = $state<string>('');

  /** Active persona data loaded during initialization. */
  private _activePersona: PersonaData | undefined;

  /** Cached bridge instance — created lazily on first use. */
  private _bridge: EngineBridge | undefined;

  /** Cached GameWorld instance — created lazily after bridge init. */
  private _gameWorld: GameWorld | undefined;

  /** Window resize handler cleanup function. */
  private _resizeCleanup: (() => void) | undefined;

  /** @inheritdoc */
  async initialize(): Promise<void> {
    try {
      // Lazy-import game modules — PixiJS is SSR-incompatible.
      // `BaseViewModelContainer` ensures `initialize()` runs only client-side.
      const { createEngineBridge } = await import('@aikami/frontend/engine');

      this._bridge = createEngineBridge();

      // Register bridge event listeners
      this._bridge.on('GAME_READY', () => {
        this.isGameReady = true;
      });

      this._bridge.on('GAME_ERROR', (event) => {
        this.gameError = event.message;
      });

      this._bridge.on('PLAYER_POSITION_CHANGED', (event) => {
        this.playerScene = event.scene;
      });

      this._bridge.on('SCENE_LOADED', (event) => {
        this.playerScene = event.sceneId;
      });

      // ── Spatial context events ──
      this._bridge.on('CONTEXT_ENTERED', (event) => {
        const entry: ActiveContextEntry = {
          entityId: event.entityId,
          npcId: event.contextPayload.npcId,
          npcName: event.contextPayload.npcName,
          dialog: event.contextPayload.dialog,
          interactionRadius: event.contextPayload.interactionRadius,
        };
        // Update ViewModel's reactive state
        this.activeContexts = [...this.activeContexts, entry];
      });

      this._bridge.on('CONTEXT_EXITED', (event) => {
        // Update ViewModel's reactive state
        this.activeContexts = this.activeContexts.filter((ctx) => ctx.entityId !== event.entityId);
      });

      // ── Visceral combat feedback: floating damage text + screen shake (C-163) ──
      this._bridge.on('DAMAGE_DEALT', (event) => {
        const id = ++this._floatingTextIdCounter;
        // Use center-screen positioning since canvas scale may not match world coords
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const instance: FloatingTextInstance = {
          id,
          amount: event.amount,
          x: centerX,
          y: centerY - 60,
          isCritical: event.isCritical,
        };
        this.floatingTexts = [...this.floatingTexts, instance];

        // Player entity is always eid 1 — shake the screen when the player is hit
        if (event.entityId === 1) {
          this._triggerScreenShake();
        }

        // Play hit SFX on every damage event
        void this._playHitSfx();
      });

      // ── Diegetic combat stage HP bar positions (C-166) ──
      this._bridge.on('COMBAT_STATE_UPDATE', (event) => {
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

      // ── Load active persona for player name + data ──
      await this._loadActivePersona();

      // ── Reactive canvas attachment via $effect ──
      // This replaces the old pendingCanvas pattern. When the View binds
      // the canvas element, this $effect fires and initializes the game world.
      // The return cleanup destroys PixiJS when the canvas unmounts, preventing
      // WebGL context leaks on HMR and route navigation.
      //
      // NOTE: canvasElement is $state.raw, so Svelte does NOT proxy the canvas.
      // Only top-level reference changes trigger this effect — WebGL is safe.
      this.registerEffectRoot(() => {
        $effect(() => {
          const canvas = this.canvasElement;
          if (canvas && this._bridge) {
            void this.initializeEngine(canvas);
          }

          return () => {
            this.destroyEngine();
          };
        });
      });

      await super.initialize();
    } catch (error) {
      this.debug('Failed to initialize game bridge', error);
    }
  }

  /** @inheritdoc */
  removeFloatingText(id: number): void {
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.id !== id);
  }

  /**
   * Triggers a brief screen shake animation when the player takes damage.
   *
   * Sets {@link isShaking} to true for ~300ms, then clears it so the CSS
   * animation can replay on subsequent hits.
   */
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

  /**
   * Plays the combat hit SFX asynchronously.
   *
   * Fire-and-forget — errors are logged but never propagated.
   *
   * Contract: C-163 Visceral Feedback Juice
   */
  private async _playHitSfx(): Promise<void> {
    try {
      const { audioContextManager } = await import('$lib/services/audio/audio_context_manager.ts');
      if (audioContextManager.context.state === 'suspended') {
        await audioContextManager.context.resume();
      }
      const { audioService } = await import('$services');
      await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
    } catch (error) {
      this.debug('_playHitSfx:failed', { error: String(error) });
    }
  }
  /** @inheritdoc */
  sendCommand(command: GameCommand): void {
    if (!this._bridge) {
      return;
    }

    this._bridge.send(command);
  }

  /**
   * Loads the active persona (from Firestore or localStorage) so the
   * player character name and data are available for engine initialization.
   */
  private async _loadActivePersona(): Promise<void> {
    try {
      const { personaService } = await import('$lib/services/persona/persona_repository.svelte');
      const activePersona = await personaService.getActivePersona();
      if (activePersona) {
        this._activePersona = activePersona;
        this._personaPlayerName = activePersona.name || activePersona.race || '';
        this.debug('loadActivePersona', {
          name: activePersona.name,
          id: activePersona.id,
        });
        return;
      }
    } catch (error) {
      this.debug('loadActivePersona:firestore-failed', error);
    }

    // Fallback: load most recent character from localStorage
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const characters = JSON.parse(stored) as Array<{ persona: PersonaData }>;
        if (characters.length > 0) {
          const persona = characters[characters.length - 1].persona;
          this._activePersona = persona;
          this._personaPlayerName = persona.name || persona.race || '';
          this.debug('loadActivePersona:localStorage', {
            name: persona.name,
            id: persona.id,
          });
        }
      }
    } catch (error) {
      this.debug('loadActivePersona:localStorage-failed', error);
    }
  }

  /**
   * Creates the GameWorld and attaches to the canvas.
   * Public so the View can call it inside `untrack()` to prevent Svelte
   * from intercepting engine state changes through the reactivity graph.
   * Assumes this._bridge is already initialized.
   */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    try {
      const { GameWorld } = await import('@aikami/frontend/engine');

      const initialPayload = consumePendingGameLoad();

      // Wire up the LPC rendering pipeline so APPEARANCE_CHANGED events
      // from the worker produce visible character sprites.
      //
      // Uses the same LPC asset resolution as the sandbox — Firebase
      // Storage URLs in live mode, local filesystem in dev mode
      // (PUBLIC_LPC_USE_LOCAL=true).
      const { TextureManager } = await import('@aikami/frontend/engine');
      const { getLpcAssetPath } = await import('$lib/data/lpc_asset_catalog');
      const { GENERATED_LPC_SLOTS } = await import('$lib/data/lpc_asset_catalog_generated');

      // Build player data from the active persona, including LPC appearance
      // layers from character creation (C-158).
      let playerData: PlayerInitData | undefined;
      if (this._activePersona?.name) {
        playerData = { name: this._activePersona.name };

        // Extract lpcRecipe from the persona's appearance metadata and
        // convert string asset IDs to 1-indexed layer variant numbers.
        const lpcRecipe = (this._activePersona.appearance as Record<string, unknown> | undefined)
          ?.lpcRecipe as Record<string, string> | undefined;
        if (lpcRecipe) {
          // Slot ordering must match ENGINE_SLOTS in the recipeResolver below
          // and WORKER_SLOT_NAMES in ecs_worker.ts.
          const ENGINE_SLOTS = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;
          const slotIndexMap = new Map<string, number>();
          for (let i = 0; i < GENERATED_LPC_SLOTS.length; i++) {
            slotIndexMap.set(GENERATED_LPC_SLOTS[i].slot, i);
          }

          const appearanceLayers: number[] = [];
          for (const slotName of ENGINE_SLOTS) {
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
            const slotDef = GENERATED_LPC_SLOTS[catalogIdx];
            if (!slotDef) {
              appearanceLayers.push(1);
              continue;
            }
            const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
            // 1-indexed: variant 0 → layerId 1, variant -1 (not found) → default to 1
            appearanceLayers.push(variantIdx >= 0 ? variantIdx + 1 : 1);
          }
          playerData.appearanceLayers = appearanceLayers;
          this.debug('initializeEngine:resolved-appearance', {
            lpcRecipe,
            appearanceLayers,
          });
        }
      }

      // Slot name → index in GENERATED_LPC_SLOTS
      const SLOT_CATALOG_INDEX: Record<string, number> = {};
      for (let idx = 0; idx < GENERATED_LPC_SLOTS.length; idx++) {
        SLOT_CATALOG_INDEX[GENERATED_LPC_SLOTS[idx].slot] = idx;
      }

      // Worker slot ordering must match WORKER_SLOT_NAMES in ecs_worker.ts
      const ENGINE_SLOTS = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

      const recipeResolver = (
        layerIds: readonly number[],
      ): import('@aikami/frontend/engine').LpcLayerRecipe[] => {
        const recipes: import('@aikami/frontend/engine').LpcLayerRecipe[] = [];
        // Iterate ALL engine slots so head is always included even when
        // the worker sends fewer layers (backward compat while worker reloads).
        for (let i = 0; i < ENGINE_SLOTS.length; i++) {
          const rawId = layerIds[i];
          const slotName = ENGINE_SLOTS[i] ?? `layer_${i}`;
          const catalogIdx = SLOT_CATALOG_INDEX[slotName];
          if (catalogIdx === undefined) {
            continue;
          }
          const slotDef = GENERATED_LPC_SLOTS[catalogIdx];
          // For head, default to human_male (index 94) when no variant is set.
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
        return getLpcAssetPath(
          _slot,
          assetId,
          state as unknown as import('$lib/data/lpc_models').LpcAnimationState,
        );
      };

      const textureManager = new TextureManager();

      this._gameWorld = (GameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
        className: 'GameWorld',
        bridge,
        recipeResolver,
        assetUrlResolver,
        textureManager,
      });
      await this._gameWorld.initialize({
        canvas,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        initialPayload,
        playerData,
      });

      // ── Load the starting map after engine initialization ──
      // New Game: loads the default starting zone so the canvas is not empty.
      // Loaded Save: the ECS snapshot restores entity state; the map renders
      //              underneath it. The saved player position is preserved
      //              because loadMap does NOT clobber existing entities that
      //              came from the snapshot.
      //
      // TODO(C-139): track mapId in save metadata so loaded games restore to
      //              the correct room instead of always loading the default.
      const DEFAULT_STARTING_MAP = '/assets/maps/sandbox_zone_a.json';
      await this._gameWorld.loadMap({ mapUrl: DEFAULT_STARTING_MAP, targetX: 160, targetY: 192 });

      // Register window resize handler — keep the PixiJS canvas filling its container.
      // Uses canvas client dimensions so it works correctly in split-screen combat
      // mode where the canvas occupies only 65% of the viewport width.
      const handleResize = (): void => {
        if (this._gameWorld && this.canvasElement) {
          this._gameWorld.resize(this.canvasElement.clientWidth, this.canvasElement.clientHeight);
        }
      };
      window.addEventListener('resize', handleResize);
      this._resizeCleanup = (): void => {
        window.removeEventListener('resize', handleResize);
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.gameError = message;
    }
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

  /**
   * Destroys the game engine (PixiJS app, worker, input listeners)
   * and resets all engine-related state.
   *
   * Called by the View's `$effect` cleanup and by {@link dispose}.
   *
   * ⚠️  Does NOT clear {@link _bridge} — the bridge must survive the
   * `$effect` cleanup so {@link initializeEngine} can use it on the next
   * run. Only {@link dispose} clears the bridge for final teardown.
   */
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
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this.destroyEngine();
    this._bridge = undefined;

    if (this._shakeTimeout) {
      clearTimeout(this._shakeTimeout);
      this._shakeTimeout = undefined;
    }

    await super.dispose();
  }
}

export { GameViewModel };
