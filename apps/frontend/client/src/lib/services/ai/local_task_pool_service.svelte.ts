// apps/frontend/client/src/lib/services/ai/local_task_pool_service.svelte.ts
//
// Singleton service that provides a configured LocalTaskPool for the Qwen3
// local LLM. Agents use this to submit micro-tasks with gateway fallback.
//
// Contract: C-427 AC-4

import { QWEN3_BUNDLE } from '@aikami/constants';
import { sanitizeJsonResponse, validateAgainstSchema } from '@aikami/frontend/ai-gateway';
import { LocalTaskPool } from '@aikami/frontend/local-runtime';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalTaskPoolServiceOptions = BaseFrontendClassOptions;

export type LocalTaskPoolServiceInterface = BaseFrontendClassInterface & {
  /** The underlying LocalTaskPool instance. */
  readonly pool: LocalTaskPool;
};

// ---------------------------------------------------------------------------
// Engine loader for Qwen3
// ---------------------------------------------------------------------------

/**
 * Loads the Qwen3 model files from Cache Storage and initializes the
 * text-generation pipeline. This is the EngineLoader passed to LocalEngine.
 */
const qwen3Loader = async (
  files: ReadonlyArray<{ path: string; data: ArrayBuffer }>,
  _signal: AbortSignal,
) => {
  // The actual Web Worker pipeline (text_llm_worker.ts) is loaded
  // from Cache Storage. For now, return a stub that fails promptly
  // so the caller can use its non-local fallback.
  //
  // 🔴 Do NOT call aiGatewayService.generateText here — the local
  // text adapter is registered for 'offline' mode and calling it
  // would create a recursive loop: adapter → pool → loader → adapter.
  if (files.length === 0) {
    throw new Error('No model files available — local engine cannot initialize');
  }
  throw new Error(
    'Local Qwen3 engine not yet wired to Web Worker. ' + 'Caller should use gateway fallback.',
  );
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LocalTaskPoolService
  extends BaseFrontendClass<LocalTaskPoolServiceOptions>
  implements LocalTaskPoolServiceInterface
{
  readonly pool: LocalTaskPool;

  constructor(options: LocalTaskPoolServiceOptions) {
    super(options);
    this.pool = new LocalTaskPool({
      bundle: QWEN3_BUNDLE,
      loader: qwen3Loader,
      maxConcurrency: 2,
      validation: {
        sanitizeJsonResponse,
        validateAgainstSchema,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const localTaskPoolService: LocalTaskPoolServiceInterface = LocalTaskPoolService.create({
  className: 'LocalTaskPoolService',
});
