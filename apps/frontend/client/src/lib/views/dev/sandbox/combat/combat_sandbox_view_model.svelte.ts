// apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Combat Encounter sandbox route.
// Creates a GameWorld bound to a canvas, loads the sandbox_combat
// tilemap with an enemy spawn point, and wires up the CombatViewModel
// when the player triggers an encounter.
//
// Contract: C-144 Task 5

import type { EngineBridge, GameWorldOptions, LpcLayerRecipe } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { CombatDevViewModel } from '$lib/views/combat/combat_dev_view_model.svelte';

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
  /** Initializes the game engine, binding it to the given canvas. */
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  /** Dismisses the combat overlay after the encounter ends. */
  dismissCombat: () => void;
  /** Destroys the engine, releasing WebGL and worker resources. */
  destroyEngine: () => void;
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
   * Registers listeners for COMBAT_STARTED and COMBAT_ENDED events
   * from the engine bridge so the sandbox can mount/dismiss the
   * CombatViewModel in response to encounter triggers.
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

      this.combatViewModel = new CombatDevViewModel({
        className: 'CombatSandboxCombatViewModel',
      });

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

    bridge.on('COMBAT_ENDED', () => {
      this.debug('combat-ended');
      this.dismissCombat();
    });
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
