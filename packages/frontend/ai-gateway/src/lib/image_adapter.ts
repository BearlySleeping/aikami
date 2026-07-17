// packages/frontend/ai-gateway/src/lib/image_adapter.ts
//
// Delegating image adapter — wraps the existing ComfyUI client path
// (image_generation_service / ImageGenerationOrchestrator) unchanged.
// Contract: C-320 AC-3

import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type { AiImageAdapter, AiImageGenerationResult } from './gateway_types.ts';

/**
 * Creates an image adapter that delegates to an existing generator
 * (same request payload, same output). Honors AbortSignal by rejecting
 * promptly with `cancelled` when aborted — the delegate may continue in
 * the background if it does not support aborts natively.
 */
export const createDelegatingImageAdapter = (options: {
  /** Existing image generation entry point (e.g. imageGenerationService). */
  generate: (options: { prompt: string; checkpoint?: string }) => Promise<{ url: string }>;
  /** Provider label for resolutions/errors. Defaults to 'comfyui'. */
  provider?: string;
}): AiImageAdapter => {
  const { generate, provider = 'comfyui' } = options;

  return {
    provider,
    async generateImage(request): Promise<AiImageGenerationResult> {
      const { resolution, signal, prompt, checkpoint } = request;

      const cancelledError = (): Error =>
        createAiGatewayError({
          code: 'cancelled',
          capability: 'image',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });

      if (signal.aborted) {
        throw cancelledError();
      }

      try {
        const result = await raceWithAbort({
          promise: generate({ prompt, checkpoint }),
          signal,
          onAbort: cancelledError,
        });
        return { url: result.url };
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'image',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      }
    },
  };
};

/**
 * Races a promise against an AbortSignal, rejecting with `onAbort()`
 * as soon as the signal fires.
 */
export const raceWithAbort = async <T>(options: {
  promise: Promise<T>;
  signal: AbortSignal;
  onAbort: () => Error;
}): Promise<T> => {
  const { promise, signal, onAbort } = options;

  if (signal.aborted) {
    throw onAbort();
  }

  let removeListener = (): void => {};
  const abortPromise = new Promise<never>((_, reject) => {
    const listener = (): void => reject(onAbort());
    signal.addEventListener('abort', listener, { once: true });
    removeListener = (): void => signal.removeEventListener('abort', listener);
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    removeListener();
  }
};
