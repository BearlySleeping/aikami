// apps/frontend/client/src/lib/services/ai/local_task_pool_service.svelte.ts
//
// Singleton service that provides a configured LocalTaskPool for the Qwen3
// local LLM. Agents use this to submit micro-tasks with gateway fallback.
//
// Contract: C-427 AC-4

import { QWEN3_BUNDLE } from '@aikami/constants';
import { sanitizeJsonResponse, validateAgainstSchema } from '@aikami/frontend/ai-gateway';
import { LocalTaskPool } from '@aikami/frontend/local-runtime';
import { aiGatewayService } from './ai_gateway_service.svelte.ts';

// ---------------------------------------------------------------------------
// Engine loader for Qwen3
// ---------------------------------------------------------------------------

/**
 * Loads the Qwen3 model files from Cache Storage and initializes the
 * text-generation pipeline. This is the EngineLoader passed to LocalEngine.
 */
const qwen3Loader = async (
  _files: ReadonlyArray<{ path: string; data: ArrayBuffer }>,
  _signal: AbortSignal,
) => {
  // In the browser, the actual pipeline is loaded via a Web Worker.
  // For now, return a stub that delegates to the gateway as fallback.
  // The full Web Worker integration (text_llm_worker.ts) will be wired
  // when the worker is registered and the pipeline is initialized.
  return {
    kind: 'wasm' as const,
    dispose: async () => {
      // Cleanup worker resources
    },
    generate: async (prompt: string): Promise<string> => {
      // Fall back to the gateway for actual generation
      const result = await aiGatewayService.generateText({
        messages: [{ role: 'user', content: prompt }],
        resolution: {
          capability: 'text',
          mode: 'offline',
          provider: 'local-qwen3',
          model: 'Qwen/Qwen3-1B',
        },
      });
      return result.text;
    },
  };
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _taskPool = new LocalTaskPool({
  bundle: QWEN3_BUNDLE,
  loader: qwen3Loader,
  maxConcurrency: 2,
  validation: {
    sanitizeJsonResponse,
    validateAgainstSchema,
  },
});

export const localTaskPool = _taskPool;
