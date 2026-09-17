// apps/frontend/client/src/lib/views/dev/sandbox/environment/environment_sandbox_view_model.svelte.ts
//
// ViewModel for the isolated Environment Time/Weather sandbox route.
// Creates a minimal GameWorld to exercise the diurnal cycle, weather
// overlay, and clock HUD. Exposes dev controls for rain, wind, and
// time scale via the SET_ENVIRONMENT_CONFIG bridge command.
//
// Contract: C-213 Environment, Time, and Weather Core System

import type { EngineBridge, GameWorldOptions } from '@aikami/frontend/engine';
import {
  createEngineBridge,
  GameWorld,
  readWeatherFxDebug,
  TextureManager,
} from '@aikami/frontend/engine';
import type { AssetTagResolver } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { LpcAnimationState } from '@aikami/lpc';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';

// ---------------------------------------------------------------------------
// Lazily-resolved ECS worker constructor (SSR-safe dynamic import)
// ---------------------------------------------------------------------------

let _ecsWorkerCtor: (new () => Worker) | undefined;

const _resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker; // guard-ignore lint/type-safety/casting: worker constructor cast - Vite worker import type is opaque
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
  /** Renderer state published by the engine for dev iteration. */
  readonly fxDiagnostics: WeatherFxDiagnosticsView | undefined;
  initializeEngine: (canvas: HTMLCanvasElement) => Promise<void>;
  setRainIntensity: (value: number) => void;
  setWindVelocity: (value: number) => void;
  setTimeScale: (value: number) => void;
  setStartHour: (value: number) => void;
  destroyEngine: () => void;
};

/**
 * What the renderer is actually drawing, as opposed to what was requested.
 *
 * Surfaced so weather can be art-directed against real numbers (live drop
 * counts, smoothed intensity, haze strength) instead of guesswork. Dev-only:
 * the engine only publishes it when diagnostics are enabled.
 */
export type WeatherFxDiagnosticsView = {
  targetRainIntensity: number;
  currentRainIntensity: number;
  farCount: number;
  nearCount: number;
  poolSize: number;
  /** Mean streak length of each depth layer, in texture-scale units. */
  farMeanScaleY: number;
  nearMeanScaleY: number;
  atmosphereStrength: number;
  visible: boolean;
};

/** How often the sandbox refreshes its renderer diagnostics readout. */
const DIAGNOSTICS_POLL_MS = 250;

export type EnvironmentSandboxViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

  // ── Renderer diagnostics (dev only) ──
  fxDiagnostics = $state<WeatherFxDiagnosticsView | undefined>(undefined);

  private _gameWorld: GameWorld | undefined;
  private _bridge: EngineBridge | undefined;
  private _textureManager: TextureManager | undefined;
  private _assetTagResolver: AssetTagResolver | undefined;
  private _releaseUrl: ((url: string) => void) | undefined;
  private _diagnosticsTimer: ReturnType<typeof setInterval> | undefined;

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

      const _paletteBytes = new Uint8Array(1024);

      const { sandboxRecipeResolver } = await import('../shared/lpc_sandbox_resolver');

      const { assetTagResolver, awaitRegistryReady } = await import(
        '$lib/services/assets/registry_resolver'
      );
      const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
      this._assetTagResolver = assetTagResolver;
      this._releaseUrl = (url: string) => assetManager.releaseUrl(url);

      const worldOptions: GameWorldOptions = {
        className: 'EnvironmentSandboxGameWorld',
        bridge: this._bridge,
        workerFactory: () => new workerCtor(),
        recipeResolver: sandboxRecipeResolver,
        assetUrlResolver: (slot, assetId, state) =>
          getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState), // guard-ignore lint/type-safety/casting: worker constructor cast - Vite worker import type is opaque
        textureManager: this._textureManager,
        // C-434: registry-backed tag resolver for maps and tilesets.
        resolveTag: this._assetTagResolver,
        releaseUrl: this._releaseUrl,
      };

      this._gameWorld = GameWorld.create(worldOptions);

      await this._gameWorld.initialize({
        canvas,
        playerData: { name: 'Adventurer' },
      });

      this._registerBridgeListeners();
      // The sandbox's sliders are authoritative: put the worker's weather into
      // manual mode so a value set on a slider is never fought by the automatic
      // decay/drift cycle. Without this, dragging Rain to 70% and letting go
      // would watch the rain quietly fade out.
      this._bridge.send({ type: 'SET_ENVIRONMENT_CONFIG', weatherMode: 'manual' });
      this._startDiagnosticsPolling();

      // Load the content pack through the asset manager (R2-backed registry)
      // The registry resolver can only resolve the pack manifest once the boot
      // seed has loaded. Without this the sandbox races the catalog fetch and
      // falls back to a bundled `/emberwatch/manifest.json`, which a de-bundled
      // client (C-435) does not ship — the sandbox then dies with
      // "ContentPackLoader: manifest not found (HTTP 404)" and never renders a
      // scene. The map sandbox already awaits this for the same reason.
      await awaitRegistryReady();

      const { loadContentPack } = await import('@aikami/frontend/engine');

      const pack = await loadContentPack({
        packId: 'emberwatch',
        resolveTag: this._assetTagResolver,
        releaseUrl: this._releaseUrl,
      });

      // Re-check after async gap — the GameWorld may have been destroyed.
      if (!this._gameWorld) {
        return;
      }

      await this._gameWorld.loadMap({
        mapUrl: pack.resolveMapUrl('village'),
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
    this._stopDiagnosticsPolling();

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
      // The worker is authoritative for weather in manual mode: it echoes the
      // slider values back unchanged. Mirroring them keeps the displayed value
      // honest if anything else ever changes the weather.
      this.rainIntensity = event.rainIntensity;
      this.windVelocity = event.windVelocity;
    });

    bridge.on('GAME_ERROR', (event) => {
      this.engineError = event.message;
    });
  }

  /**
   * Starts polling the engine's weather-FX renderer diagnostics.
   *
   * A low-frequency interval, not a ticker subscription: the ViewModel must
   * never touch the Pixi loop, and renderer state changes on human timescales
   * once a transition settles.
   */
  private _startDiagnosticsPolling(): void {
    if (this._diagnosticsTimer) {
      return;
    }
    this._diagnosticsTimer = setInterval(() => {
      const snapshot = readWeatherFxDebug();
      this.fxDiagnostics = {
        targetRainIntensity: snapshot.targetRainIntensity,
        currentRainIntensity: snapshot.currentRainIntensity,
        farCount: snapshot.farCount,
        nearCount: snapshot.nearCount,
        poolSize: snapshot.poolSize,
        farMeanScaleY: snapshot.farMeanScaleY,
        nearMeanScaleY: snapshot.nearMeanScaleY,
        atmosphereStrength: snapshot.atmosphereStrength,
        visible: snapshot.visible,
      };
    }, DIAGNOSTICS_POLL_MS);
  }

  /** Stops the diagnostics interval and clears the readout. */
  private _stopDiagnosticsPolling(): void {
    if (this._diagnosticsTimer) {
      clearInterval(this._diagnosticsTimer);
      this._diagnosticsTimer = undefined;
    }
    this.fxDiagnostics = undefined;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getEnvironmentSandboxViewModel = (
  options: EnvironmentSandboxViewModelOptions,
): EnvironmentSandboxViewModel => EnvironmentSandboxViewModel.create(options);
