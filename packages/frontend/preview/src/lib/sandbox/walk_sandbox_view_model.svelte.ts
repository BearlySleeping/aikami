// packages/frontend/preview/src/lib/sandbox/walk_sandbox_view_model.svelte.ts
//
// ViewModel for the walk sandbox — engine-mounting preview that creates a GameWorld.
// Owns initialization, resolver loading, engine lifecycle, and state.
// Generalised from apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts (C-445).

import type { EngineBridge, GameWorldOptions } from '@aikami/frontend/engine';
import { createEngineBridge, GameWorld, TextureManager } from '@aikami/frontend/engine';
import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';
import type { LpcAnimationState } from '@aikami/lpc';
import type { AssetResolver } from '@aikami/types';

export type WalkSandboxViewModelInterface = BaseDevViewModelInterface & {
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly currentMap: string | undefined;
  readonly fps: number;

  initializeEngine(canvas: HTMLCanvasElement): Promise<void>;
  loadMap(mapTag: string): Promise<void>;
  destroyEngine(): Promise<void>;
};

export type WalkSandboxViewModelOptions = BaseDevViewModelOptions & {
  resolver: AssetResolver;
  mapTag?: string;
};

class WalkSandboxViewModel
  extends BaseDevViewModel<WalkSandboxViewModelOptions>
  implements WalkSandboxViewModelInterface
{
  engineReady = $state(false);
  engineError = $state<string | undefined>(undefined);
  currentMap = $state<string | undefined>(undefined);
  fps = $state(0);

  private _engineBridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _textureManager: TextureManager | undefined;
  private readonly _resolver: AssetResolver;
  private readonly _initialMapTag: string | undefined;

  constructor(options: WalkSandboxViewModelOptions) {
    super(options);
    this._resolver = options.resolver;
    this._initialMapTag = options.mapTag;
  }

  async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
    try {
      this._engineBridge = createEngineBridge();
      this._textureManager = new TextureManager();

      const gameWorldOptions: GameWorldOptions = {
        canvas,
        engineBridge: this._engineBridge,
        textureManager: this._textureManager,
        assetUrlResolver: (_slot: string, assetId: string, _state: LpcAnimationState): string | null =>
          this._resolver.resolve(assetId),
        resolveEcsWorker: async () => {
          const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
          return mod.default as unknown as new () => Worker;
        },
      };

      this._gameWorld = GameWorld.create(gameWorldOptions);
      await this._gameWorld.initialize();

      if (this._initialMapTag) {
        await this.loadMap(this._initialMapTag);
      }

      this.engineReady = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.engineError = message;
      this.error('walkSandbox.engineInitFailed', { error: message });
    }
  }

  async loadMap(mapTag: string): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized');
    }

    const url = this._resolver.resolve(mapTag);
    if (!url) {
      throw new Error(`Cannot resolve map: ${mapTag}`);
    }

    await this._gameWorld.loadMap(url);
    this.currentMap = mapTag;
  }

  async destroyEngine(): Promise<void> {
    if (this._gameWorld) {
      await this._gameWorld.dispose();
      this._gameWorld = undefined;
    }
    this.engineReady = false;
    this.currentMap = undefined;
  }

  override async dispose(): Promise<void> {
    await this.destroyEngine();
    return await super.dispose();
  }
}

export const getWalkSandboxViewModel = (
  options: WalkSandboxViewModelOptions,
): WalkSandboxViewModelInterface => WalkSandboxViewModel.create(options);
