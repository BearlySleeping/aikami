// packages/frontend/ai-gateway/src/lib/local_text_adapter.ts
//
// Local text adapter for the 'offline' mode — delegates micro-task
// generation to the LocalTaskPool (Qwen3 1B).
// Contract: C-427 AC-4

import type { LocalTaskPool, MicroTask } from '@aikami/frontend/local-runtime';
import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type { AiTextAdapter, AiTextGenerationResult } from './gateway_types.ts';
import { raceWithAbort } from './image_adapter.ts';

/**
 * Creates a text adapter that routes to the local Qwen3 LLM via
 * the LocalTaskPool for the 'offline' mode.
 */
export const createLocalTextAdapter = (options: {
  /** LocalTaskPool instance (must be ensureLoaded() before use). */
  taskPool: LocalTaskPool;
  /** Provider label for resolutions/errors. Defaults to 'local-qwen3'. */
  provider?: string;
}): AiTextAdapter => {
  const { taskPool, provider = 'local-qwen3' } = options;

  return {
    provider,
    async generateText(request): Promise<AiTextGenerationResult> {
      const { resolution, signal, messages, onChunk } = request;

      const cancelledError = (): Error =>
        createAiGatewayError({
          code: 'cancelled',
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });

      if (signal.aborted) {
        throw cancelledError();
      }

      try {
        // Ensure the on-device engine is up (native sidecar or WebGPU worker)
        // before submitting. Throws when neither is available, which the
        // caller normalizes into a gateway error and falls back from.
        await taskPool.ensureLoaded(signal);

        // Preserve full message context for conversational text
        const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

        // Build a free-form text micro-task from the full conversation context
        const microTask: MicroTask = {
          type: 'text',
          payload: { prompt: conversationText },
        };

        const result = await raceWithAbort({
          promise: taskPool.submit(microTask, signal),
          signal,
          onAbort: cancelledError,
        });

        if (!result.ok) {
          // Signal gateway fallback — do not emit or return task output
          throw createAiGatewayError({
            code: 'invalid_response',
            capability: 'text',
            mode: resolution.mode,
            provider: resolution.provider,
            message: 'Local task validation failed — fall back to gateway',
          });
        }

        if (onChunk) {
          onChunk(result.output);
        }

        return { text: result.output };
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      }
    },
  };
};
