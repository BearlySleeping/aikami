// apps/frontend/client/src/lib/views/dev/sandbox/sandbox_composition.ts
//
// Production wiring for the base sandbox. This is the only module in the
// feature that imports the `$services` barrel and the real engine; the
// ViewModel receives them as typed capabilities.

import {
  BaseEngineClass,
  createEngineBridge,
  GameWorld,
  TextureManager,
} from '@aikami/frontend/engine';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { LpcAnimationState } from '@aikami/lpc';
import { getLpcAssetPath } from '$lib/data/lpc_asset_catalog';
import { textGenerationService } from '$services';
import {
  createSandboxViewModel,
  type SandboxViewModelInterface,
} from './sandbox_view_model.svelte';
import { sandboxRecipeResolver } from './shared/lpc_sandbox_resolver';

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
 * Builds the sandbox ViewModel wired to the text-generation singleton and the
 * real engine constructors.
 */
export const getSandboxViewModel = (options: BaseViewModelOptions): SandboxViewModelInterface =>
  createSandboxViewModel({
    ...options,
    textGeneration: textGenerationService,
    engine: {
      createBridge: createEngineBridge,
      createWorld: (worldOptions) => GameWorld.create(worldOptions),
      createTextureManager: () => new TextureManager(),
      resolveEcsWorker,
      recipeResolver: sandboxRecipeResolver,
      assetUrlResolver: (slot, assetId, state) =>
        getLpcAssetPath(slot, assetId, state as unknown as LpcAnimationState), // guard-ignore lint/type-safety/casting: engine sends the LPC row index as a string; resolver expects the numeric union
      isRenderDebugEnabled: () => BaseEngineClass.renderDebugEnabled,
      setRenderDebug: (enabled) => {
        BaseEngineClass.setRenderDebug(enabled);
      },
    },
  });
