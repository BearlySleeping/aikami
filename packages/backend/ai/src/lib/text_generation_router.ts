// packages/backend/ai/src/lib/text_generation_router.ts

import { createOllamaStream } from './ollama_adapter.ts';
import { createOpenRouterStream } from './openrouter_adapter.ts';
import type { TextGenerationConfig, TextGenerationRequest } from './text_generation_types.ts';

/**
 * Adapter function type — used for dependency injection in tests.
 */
type StreamAdapterFn = (
  request: TextGenerationRequest,
  config: TextGenerationConfig,
  signal?: AbortSignal,
) => Promise<ReadableStream<Uint8Array>>;

/**
 * Route a text generation request to the appropriate provider adapter.
 *
 * AC-1: Reads `config.provider` to determine which adapter to invoke.
 * The `request.provider` field can override the config for per-request routing.
 *
 * **Fallback chain**: when the primary provider is `openrouter` but fails,
 * the router automatically falls back to Ollama before re-throwing the error.
 *
 * @param options.request — The text generation request with prompt and optional history.
 * @param options.config — The provider configuration (provider type, API keys, base URLs).
 * @param options.signal — AbortSignal to cancel the upstream fetch on client disconnect.
 * @param options._openRouterFn — Inject OpenRouter adapter for testing.
 * @param options._ollamaFn — Inject Ollama adapter for testing.
 * @returns A ReadableStream of Uint8Array-encoded SSE events.
 */
export const routeTextGeneration = async (options: {
  request: TextGenerationRequest;
  config: TextGenerationConfig;
  signal?: AbortSignal;
  _openRouterFn?: StreamAdapterFn;
  _ollamaFn?: StreamAdapterFn;
}): Promise<ReadableStream<Uint8Array>> => {
  const { request, config, signal, _openRouterFn, _ollamaFn } = options;

  const provider = request.provider ?? config.provider;

  const openRouterFn: StreamAdapterFn =
    _openRouterFn ??
    ((req, cfg, sig) =>
      createOpenRouterStream({
        request: req,
        baseUrl: cfg.openrouterBaseUrl,
        apiKey: cfg.openrouterApiKey,
        signal: sig,
      }));

  const ollamaFn: StreamAdapterFn =
    _ollamaFn ??
    ((req, cfg, sig) =>
      createOllamaStream({
        request: req,
        baseUrl: cfg.ollamaBaseUrl,
        signal: sig,
      }));

  switch (provider) {
    case 'openrouter': {
      try {
        return await openRouterFn(request, config, signal);
      } catch {
        // Fallback to Ollama on failure
        return await ollamaFn(request, config, signal);
      }
    }

    case 'ollama': {
      return await ollamaFn(request, config, signal);
    }
  }
};
