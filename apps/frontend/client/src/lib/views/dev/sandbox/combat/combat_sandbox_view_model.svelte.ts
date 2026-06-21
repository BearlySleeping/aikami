// apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Combat Encounter sandbox route.
// Creates a GameWorld bound to a canvas, loads the sandbox_combat
// tilemap with an enemy spawn point, and wires up the CombatViewModel
// when the player triggers an encounter.
//
// Contract: C-144 Task 5, C-147 Progression & Persistence

import type { EngineBridge, GameWorldOptions, LpcLayerRecipe } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { ttsService } from '$lib/services/audio/tts_service.svelte.ts';
import {
  CombatDevViewModel,
  type CombatDevViewModelOptions,
} from '$lib/views/combat/combat_dev_view_model.svelte';
import { gameStateService } from '$services';

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

export type CombatSandboxViewModelInterface = BaseViewModelInterface & {
  /** Whether the game engine is initialized and running. */
  readonly engineReady: boolean;
  /** Engine initialization error, surfaced to the user. */
  readonly engineError: string | undefined;
  /** Whether the sandbox map has been loaded. */
  readonly mapLoaded: boolean;
  /** The active CombatViewModel, or undefined when combat is not active. */
  readonly combatViewModel: CombatDevViewModel | undefined;
  /** Whether the Game Over overlay is visible (player defeated). */
  readonly isGameOver: boolean;
  /** Player XP from combat victories (C-147). */
  readonly playerXp: number;
  /** Player level (C-147). */
  readonly playerLevel: number;
  /** XP needed for next level (C-147). */
  readonly playerXpToNextLevel: number;
  /** Spawn point IDs of defeated enemies (C-147). */
  readonly defeatedEnemyIds: string[];
  /** Last level-up event data for display (C-147). */
  readonly lastLevelUpEvent: string | undefined;
  /** Initializes the game engine, binding it to the given canvas. */
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  /** Dismisses the combat overlay after the encounter ends. */
  dismissCombat: () => void;
  /** Respaws the player after defeat (reloads map). */
  respawnPlayer: () => Promise<void>;
  /** Destroys the engine, releasing WebGL and worker resources. */
  destroyEngine: () => void;
  /** DEV: force game over overlay (C-147). */
  devForceGameOver: () => void;
  /** DEV: grant XP directly (C-147). */
  devGrantXp: () => void;
  /** DEV: simulate COMBAT_ENDED victory with a specific enemy ID. */
  devSimulateVictoryWithEnemy: () => void;
  /** DEV: toggle real AI services (text + image generation). */
  devToggleRealAi: (enabled: boolean) => void;
  /** Whether real AI services (vs mock) are enabled. */
  readonly useRealAi: boolean;
  /** DEV: initialize the native Kokoro WebGPU TTS engine. */
  devInitTts: () => Promise<void>;
  /** DEV: check for a running Kokoro REST API server (Docker/binary). */
  devCheckKokoroServer: () => Promise<void>;
  /** DEV: speak a test enemy voice taunt via TTS. */
  devTestEnemyVoice: () => void;
  /** Current TTS engine status (for debug display). */
  readonly devTtsStatus: string;
  /** DEV: trigger floating damage text + screen shake for visual testing. */
  devTriggerFloatingDamage: () => void;
  /** DEV: play equip SFX for audio testing. */
  devTriggerEquipSfx: () => Promise<void>;

  /** Active floating damage text instances (C-163). */
  readonly floatingTexts: Array<{
    readonly id: number;
    readonly amount: number;
    readonly x: number;
    readonly y: number;
    readonly isCritical: boolean;
  }>;
  /** Whether screen shake is active (C-163). */
  readonly isShaking: boolean;
  /** Removes a floating text by ID (C-163). */
  removeFloatingText: (id: number) => void;
};

export type CombatSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map URL for the combat sandbox. */
const COMBAT_MAP_URL = '/assets/maps/sandbox_combat.json';

/** Player spawn position on the combat map. */
const PLAYER_SPAWN_X = 100;
const PLAYER_SPAWN_Y = 200;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class CombatSandboxViewModel
  extends BaseViewModel<CombatSandboxViewModelOptions>
  implements CombatSandboxViewModelInterface
{
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);
  mapLoaded = $state<boolean>(false);
  combatViewModel = $state<CombatDevViewModel | undefined>(undefined);
  isGameOver = $state<boolean>(false);
  playerXp = $state<number>(0);
  playerLevel = $state<number>(1);
  playerXpToNextLevel = $state<number>(100);
  defeatedEnemyIds = $state<string[]>([]);
  lastLevelUpEvent = $state<string | undefined>(undefined);

  /** Whether real AI services (text + image) are enabled. */
  useRealAi = $state<boolean>(false);

  /** Active floating damage text instances (C-163). */
  floatingTexts: Array<{
    id: number;
    amount: number;
    x: number;
    y: number;
    isCritical: boolean;
  }> = $state([]);

  /** Screen shake flag (C-163). */
  isShaking = $state(false);

  private _floatingTextIdCounter = 0;
  private _shakeTimeout: ReturnType<typeof setTimeout> | undefined;

  private _gameWorld: GameWorld | undefined;
  private _bridge: EngineBridge | undefined;
  private _textureManager: TextureManager | undefined;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    if (this._gameWorld) {
      return;
    }

    try {
      const workerCtor = await _resolveEcsWorker();

      this._bridge = createEngineBridge();

      this._textureManager = new TextureManager({});

      const worldOptions: GameWorldOptions = {
        className: 'CombatSandboxGameWorld',
        bridge: this._bridge,
        workerFactory: () => new workerCtor(),
        recipeResolver: _recipeResolver,
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(
            slot,
            assetId,
            state as unknown as import('$lib/data/lpc_models').LpcAnimationState,
          ),
        textureManager: this._textureManager,
      };

      this._gameWorld = GameWorld.create(worldOptions);

      await this._gameWorld.initialize({
        canvas,
        playerData: { name: 'Adventurer' },
      });

      this._registerBridgeListeners();

      // Load the combat sandbox map
      await this._gameWorld.loadMap(COMBAT_MAP_URL, PLAYER_SPAWN_X, PLAYER_SPAWN_Y);
      this.mapLoaded = true;
      this.engineReady = true;
    } catch (error) {
      this.engineError = error instanceof Error ? error.message : String(error);
      this.debug('initializeEngine:error', { error: this.engineError });
    }
  }

  /** @inheritdoc */
  dismissCombat(): void {
    // Reset engine mode and unlock input so the player can move again
    this._bridge?.send({ type: 'SET_GAME_MODE', mode: 'EXPLORE' } as never);
    this._gameWorld?.setInputLocked(false);
    gameStateService.setMode('EXPLORE');
    void this.combatViewModel?.dispose();
    this.combatViewModel = undefined;
  }

  /** @inheritdoc */
  async destroyEngine(): Promise<void> {
    if (this._textureManager) {
      this._textureManager.destroy();
      this._textureManager = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._bridge = undefined;
    this.engineReady = false;
    this.mapLoaded = false;
    this.combatViewModel = undefined;
  }

  // -----------------------------------------------------------------------
  // Bridge event listeners
  // -----------------------------------------------------------------------

  /**
   * Registers listeners for COMBAT_STARTED, COMBAT_ENDED, and
   * PLAYER_LEVELED_UP events from the engine bridge so the sandbox
   * can mount/dismiss the CombatViewModel and track progression.
   */
  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('COMBAT_STARTED', (event) => {
      this.debug('combat-started', {
        enemyId: event.enemyId,
        enemyName: event.enemyName,
        enemyHp: event.enemyHp,
      });

      // Lock input and set engine mode to COMBAT so WASD/E keys
      // pass through to the combat dialog's text input (C-148 fix)
      this._gameWorld?.setInputLocked(true);
      this._bridge?.send({ type: 'SET_GAME_MODE', mode: 'COMBAT' } as never);
      gameStateService.setMode('COMBAT');

      this.combatViewModel = new CombatDevViewModel({
        className: 'CombatSandboxCombatViewModel',
        onDismissOverlay: () => this.dismissCombat(),
        useRealAi: this.useRealAi,
      } satisfies CombatDevViewModelOptions);

      // Feed enemy data into the combat VM — skip initialize()
      // because CombatDevViewModel.initialize() overwrites with mock data.
      // The sandbox VM handles COMBAT_STARTED/COMBAT_ENDED at its own level.
      this.combatViewModel.enemyName = event.enemyName ?? 'Unknown Enemy';
      this.combatViewModel.enemyHp = event.enemyHp ?? 80;
      this.combatViewModel.enemyMaxHp = event.enemyMaxHp ?? 80;
      this.combatViewModel.activeEntities = event.participantIds;
      this.combatViewModel.currentTurnEntity = event.firstTurnEntityId;
      this.combatViewModel.totalParticipants = event.participantIds.length;
      this.combatViewModel.isPlayerTurn = true;
      this.combatViewModel.playerHp = 100;
      this.combatViewModel.playerMaxHp = 100;
    });

    bridge.on('COMBAT_ENDED', (event) => {
      this.debug('combat-ended', event);

      // Track defeated enemy for persistence demo (C-147)
      if (event.victory && event.defeatedEnemyId) {
        if (!this.defeatedEnemyIds.includes(event.defeatedEnemyId)) {
          this.defeatedEnemyIds = [...this.defeatedEnemyIds, event.defeatedEnemyId];
        }
      }

      if (event.victory) {
        // Delay dismiss so the victory banner is visible (C-147)
        setTimeout(() => this.dismissCombat(), 2500);
      } else {
        // Player defeated — show Game Over, unlock input
        this._gameWorld?.setInputLocked(false);
        this._bridge?.send({ type: 'SET_GAME_MODE', mode: 'EXPLORE' } as never);
        gameStateService.setMode('EXPLORE');
        this.isGameOver = true;
        void this.combatViewModel?.dispose();
        this.combatViewModel = undefined;
      }
    });

    // Listen for level-up events (C-147)
    bridge.on('PLAYER_LEVELED_UP', (event) => {
      this.debug('player-leveled-up', event);
      this.playerLevel = event.newLevel;
      this.playerXpToNextLevel = event.xpToNextLevel;
      this.lastLevelUpEvent = `Level ${event.newLevel}! HP: ${event.maxHp}, ATK: ${event.attack}, DEF: ${event.defense}`;

      // Clear the notification after 4 seconds
      setTimeout(() => {
        this.lastLevelUpEvent = undefined;
      }, 4000);
    });

    // Listen for damage events — spawn floating text + screen shake (C-163)
    bridge.on('DAMAGE_DEALT', (event) => {
      const id = ++this._floatingTextIdCounter;
      // Use center-screen positioning since canvas scale may not match world coords
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      this.floatingTexts = [
        ...this.floatingTexts,
        {
          id,
          amount: event.amount,
          x: centerX,
          y: centerY - 60,
          isCritical: event.isCritical,
        },
      ];

      if (event.entityId === 1) {
        this._triggerScreenShake();
      }

      void this._playHitSfx();
    });
  }
  /** @inheritdoc */
  async respawnPlayer(): Promise<void> {
    this.isGameOver = false;
    this.engineReady = false;
    this.mapLoaded = false;

    // Unlock input before reloading map
    this._gameWorld?.setInputLocked(false);

    // Reload the combat sandbox map — defeated enemies are filtered
    await this._gameWorld?.loadMap(
      COMBAT_MAP_URL,
      PLAYER_SPAWN_X,
      PLAYER_SPAWN_Y,
      this.defeatedEnemyIds,
    );
    this.mapLoaded = true;
    this.engineReady = true;
  }

  /** @inheritdoc */
  devForceGameOver(): void {
    this.isGameOver = true;
    void this.combatViewModel?.dispose();
    this.combatViewModel = undefined;
  }

  /** @inheritdoc */
  devGrantXp(): void {
    this.playerXp += 50;
    if (this.playerXp >= this.playerXpToNextLevel) {
      // Simulate level-up manually since this is dev-only
      this.playerLevel += 1;
      this.playerXp -= this.playerXpToNextLevel;
      this.playerXpToNextLevel = Math.floor(this.playerXpToNextLevel * 1.5);
      this.lastLevelUpEvent = `[DEV] Level ${this.playerLevel}! (Manual grant)`;
      setTimeout(() => {
        this.lastLevelUpEvent = undefined;
      }, 4000);
    }
  }

  /** @inheritdoc */
  devSimulateVictoryWithEnemy(): void {
    const testEnemyId = `enemy_dev_${Date.now()}`;
    this.defeatedEnemyIds = [...this.defeatedEnemyIds, testEnemyId];
    this.playerXp += 25;
  }

  /** @inheritdoc */
  devToggleRealAi(enabled: boolean): void {
    this.useRealAi = enabled;
    // Push to existing combat VM so toggle takes effect mid-combat
    this.combatViewModel?.setUseRealAi(enabled);
    this.debug('devToggleRealAi', { enabled });
  }

  /** @inheritdoc */
  get devTtsStatus(): string {
    const status = ttsService.status;
    if (ttsService.errorMessage) {
      return `${status} (${ttsService.errorMessage})`;
    }
    return status;
  }

  /** @inheritdoc */
  async devInitTts(): Promise<void> {
    this.debug('devInitTts', { currentStatus: ttsService.status });
    // checkKokoroServer is called automatically inside initialize()
    await ttsService.initialize();
  }

  /** @inheritdoc */
  async devCheckKokoroServer(): Promise<void> {
    this.debug('devCheckKokoroServer');
    await ttsService.checkKokoroServer();
    this.debug('devCheckKokoroServer:result', {
      available: ttsService.isKokoroServerAvailable,
      status: ttsService.status,
    });
  }

  /** @inheritdoc */
  devTriggerFloatingDamage(): void {
    this.debug('devTriggerFloatingDamage');
    // Use center-screen coordinates since combat focuses on center
    const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
    const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;
    this._bridge?.emit({
      type: 'DAMAGE_DEALT',
      entityId: 1,
      amount: 15,
      isCritical: false,
      screenX: centerX,
      screenY: centerY - 40, // offset above center for readability
    } as never);
  }

  /** @inheritdoc */
  async devTriggerEquipSfx(): Promise<void> {
    this.debug('devTriggerEquipSfx');
    try {
      const { audioContextManager } = await import('$lib/services/audio/audio_context_manager.ts');
      // Resume AudioContext directly — unlock() only attaches future listeners
      if (audioContextManager.context.state === 'suspended') {
        await audioContextManager.context.resume();
      }
      const { audioService } = await import('$lib/services/audio/audio_service.svelte.ts');
      await audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
      this.debug('devTriggerEquipSfx:played');
    } catch (error) {
      this.debug('devTriggerEquipSfx:failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  devTestEnemyVoice(): void {
    this.debug('devTestEnemyVoice', { status: ttsService.status });
    const phrases = [
      'You dare challenge me, mortal?!',
      'I shall feast on your bones!',
      'Pathetic! Is that all you have?',
      'A worthy opponent... but not worthy enough!',
    ];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    void ttsService.synthesize({ text: phrase, voice: 'af_heart' });
  }

  /** @inheritdoc */
  removeFloatingText(id: number): void {
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.id !== id);
  }

  /** Triggers a brief screen shake (C-163). */
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

  /** Plays combat hit SFX (C-163). */
  private async _playHitSfx(): Promise<void> {
    try {
      const { audioContextManager } = await import('$lib/services/audio/audio_context_manager.ts');
      if (audioContextManager.context.state === 'suspended') {
        await audioContextManager.context.resume();
      }
      const { audioService } = await import('$lib/services/audio/audio_service.svelte.ts');
      await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
    } catch (error) {
      this.debug('_playHitSfx:failed', { error: String(error) });
    }
  }
}

// ---------------------------------------------------------------------------
// LPC helpers
// ---------------------------------------------------------------------------

/**
 * Resolves layer IDs to LPC layer recipes for the sandbox engine.
 */
const _recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const recipes: LpcLayerRecipe[] = [];
  for (const id of layerIds) {
    if (id > 0) {
      recipes.push({
        slot: `layer_${id}`,
        assetId: String(id),
        hexPalette: new Uint8Array(1024),
      });
    }
  }
  return recipes;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating CombatSandboxViewModel instances.
 *
 * @param options - ViewModel options.
 * @returns A CombatSandboxViewModel instance.
 */
export const getCombatSandboxViewModel = (
  options: CombatSandboxViewModelOptions,
): CombatSandboxViewModel => {
  return new CombatSandboxViewModel(options);
};
