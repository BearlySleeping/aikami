// apps/frontend/client/src/lib/views/dev/sandbox/environment/environment_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Environment Time/Weather sandbox route.
// Creates a minimal GameWorld to exercise the diurnal cycle, weather
// overlay, and clock HUD. Exposes dev controls for rain, wind, and
// time scale via the SET_ENVIRONMENT_CONFIG bridge command.
//
// Contract: C-213 Environment, Time, and Weather Core System

import type { EngineBridge, GameWorldOptions, LpcLayerRecipe } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import type { LpcAnimationState } from '$lib/data/lpc_models';

// ---------------------------------------------------------------------------
// Lazily-resolved ECS worker constructor (SSR-safe dynamic import)
// ---------------------------------------------------------------------------

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

export type EnvironmentSandboxViewModelInterface = BaseViewModelInterface & {
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly mapLoaded: boolean;
  readonly gameHour: number;
  readonly gameMinute: number;
  readonly rainIntensity: number;
  readonly windVelocity: number;
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  setRainIntensity: (value: number) => void;
  setWindVelocity: (value: number) => void;
  setTimeScale: (value: number) => void;
  setStartHour: (value: number) => void;
  destroyEngine: () => void;
};

export type EnvironmentSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAP_URL = '/assets/maps/sandbox_zone_a.json';
const PLAYER_SPAWN_X = 160;
const PLAYER_SPAWN_Y = 192;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class EnvironmentSandboxViewModel
  extends BaseViewModel<EnvironmentSandboxViewModelOptions>
  implements EnvironmentSandboxViewModelInterface
{
  engineReady = $state<boolean>(false);
  engineError = $state<string | undefined>(undefined);
  mapLoaded = $state<boolean>(false);

  // ── Environment state (C-213) ──
  gameHour = $state<number>(12);
  gameMinute = $state<number>(0);
  rainIntensity = $state<number>(0);
  windVelocity = $state<number>(0);

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

      const paletteBytes = new Uint8Array(1024);

      const SANDBOX_RECIPES: Record<number, LpcLayerRecipe> = {
        1: { slot: 'body', assetId: 'body/bodies_male', hexPalette: paletteBytes },
        2: { slot: 'hair', assetId: 'hair/plain_adult', hexPalette: paletteBytes },
        5: { slot: 'torso', assetId: 'torso/chainmail_male', hexPalette: paletteBytes },
        3: { slot: 'legs', assetId: 'legs/pants_male', hexPalette: paletteBytes },
        6: { slot: 'feet', assetId: 'feet/shoes/male', hexPalette: paletteBytes },
        4: { slot: 'head', assetId: 'head/heads/human_male', hexPalette: paletteBytes },
      };

      const worldOptions: GameWorldOptions = {
        className: 'EnvironmentSandboxGameWorld',
        bridge: this._bridge,
        workerFactory: () => new workerCtor(),
        recipeResolver: (layerIds) =>
          layerIds.map((id) => SANDBOX_RECIPES[id]).filter(Boolean) as LpcLayerRecipe[],
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState),
        textureManager: this._textureManager,
      };

      this._gameWorld = GameWorld.create(worldOptions);

      await this._gameWorld.initialize({
        canvas,
        playerData: { name: 'Adventurer' },
      });

      this._registerBridgeListeners();

      await this._gameWorld.loadMap({
        mapUrl: MAP_URL,
        targetX: PLAYER_SPAWN_X,
        targetY: PLAYER_SPAWN_Y,
      });

      this.mapLoaded = true;
      this.engineReady = true;
    } catch (error) {
      this.engineError = error instanceof Error ? error.message : String(error);
      this.debug('initializeEngine:error', { error: this.engineError });
    }
  }

  /** @inheritdoc */
  setRainIntensity(value: number): void {
    this.rainIntensity = value;
    this._bridge?.send({ type: 'SET_ENVIRONMENT_CONFIG', rainIntensity: value });
  }

  /** @inheritdoc */
  setWindVelocity(value: number): void {
    this.windVelocity = value;
    this._bridge?.send({ type: 'SET_ENVIRONMENT_CONFIG', windVelocity: value });
  }

  /** @inheritdoc */
  setTimeScale(value: number): void {
    this._bridge?.send({ type: 'SET_ENVIRONMENT_CONFIG', timeScale: value });
  }

  /** @inheritdoc */
  setStartHour(value: number): void {
    this.gameHour = value;
    this.gameMinute = 0;
    this._bridge?.send({ type: 'SET_ENVIRONMENT_CONFIG', startHour: value });
  }

  /** @inheritdoc */
  destroyEngine(): void {
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
  }

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    this.destroyEngine();
    await super.dispose();
  }

  // -----------------------------------------------------------------------
  // Bridge listeners
  // -----------------------------------------------------------------------

  private _registerBridgeListeners(): void {
    const bridge = this._bridge;
    if (!bridge) {
      return;
    }

    bridge.on('ENVIRONMENT_UPDATED', (event) => {
      this.gameHour = event.gameHour;
      this.gameMinute = event.gameMinute;
      // Don't overwrite rain/wind from sliders — those are user-controlled
    });

    bridge.on('GAME_ERROR', (event) => {
      this.engineError = event.message;
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getEnvironmentSandboxViewModel = (
  options: EnvironmentSandboxViewModelOptions,
): EnvironmentSandboxViewModel => {
  return new EnvironmentSandboxViewModel(options);
};
