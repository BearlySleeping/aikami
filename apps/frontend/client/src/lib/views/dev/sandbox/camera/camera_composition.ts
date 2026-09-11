// apps/frontend/client/src/lib/views/dev/sandbox/camera/camera_composition.ts
//
// Production wiring for the Camera & Spatial UI sandbox. This is the only
// module in the feature that imports the `$services` barrel and the real
// engine; the ViewModel receives them as typed capabilities.

import {
  createEngineBridge,
  GameWorld,
  loadContentPack as loadEngineContentPack,
  TextureManager,
} from '@aikami/frontend/engine';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { LpcAnimationState } from '@aikami/lpc';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { assetManager } from '$lib/services/assets/asset_manager.svelte';
import { assetTagResolver } from '$lib/services/assets/registry_resolver';
import { gameModeService } from '$services';
import {
  type CameraSandboxViewModelInterface,
  createCameraSandboxViewModel,
} from './camera_sandbox_view_model.svelte';

/** Lazily-resolved ECS worker constructor (SSR-safe dynamic import). */
let _ecsWorkerCtor: (new () => Worker) | undefined;

const resolveEcsWorker = async (): Promise<new () => Worker> => {
  if (_ecsWorkerCtor) {
    return _ecsWorkerCtor;
  }
  const mod = await import('@aikami/frontend/engine/worker/ecs_worker.ts?worker&type=module');
  _ecsWorkerCtor = mod.default as unknown as new () => Worker; // guard-ignore lint/type-safety/casting: Vite worker import type is opaque
  return _ecsWorkerCtor;
};

/**
 * Builds the camera-sandbox ViewModel wired to the game-mode singleton and the
 * real engine constructors.
 */
export const getCameraSandboxViewModel = (
  options: BaseViewModelOptions,
): CameraSandboxViewModelInterface =>
  createCameraSandboxViewModel({
    ...options,
    mode: gameModeService,
    engine: {
      createBridge: createEngineBridge,
      createWorld: (worldOptions) => GameWorld.create(worldOptions),
      createTextureManager: () => new TextureManager(),
      resolveEcsWorker,
      assetUrlResolver: (slot, assetId, state) =>
        getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState), // guard-ignore lint/type-safety/casting: engine sends the LPC row index as a string; resolver expects the numeric union
      resolveTag: assetTagResolver,
      releaseUrl: (url) => assetManager.releaseUrl(url),
      loadContentPack: (loadOptions) => loadEngineContentPack(loadOptions),
    },
  });
