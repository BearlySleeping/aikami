// packages/frontend/engine/src/ai_clients/ai/factory.ts

import type { FrontendAiInterface } from './frontend_ai_interface.ts';
import type { AiClientOptions, AiProviderId, ComfyUiClientOptions } from './types.ts';

/**
 * Creates the appropriate AI client for the given provider type.
 *
 * Uses dynamic imports to keep bundles lean — only the requested
 * provider's code is loaded.
 *
 * @param provider - Target AI provider.
 * @param options - Provider-specific configuration.
 * @returns A fully configured AI client.
 * @throws If the provider is unsupported or missing required options.
 */
async function createAiClient(
  provider: AiProviderId,
  options: AiClientOptions = {},
): Promise<FrontendAiInterface> {
  switch (provider) {
    case 'openai': {
      if (!options.apiClient) {
        throw new Error('OpenAiClient requires an apiClient (GameApiClientInterface) in options.');
      }

      const { OpenAiClient } = await import('./clients/openai_client.ts');

      return new OpenAiClient(options.apiClient, options.openai?.model);
    }

    case 'gemini': {
      if (!options.apiClient) {
        throw new Error('GeminiClient requires an apiClient (GameApiClientInterface) in options.');
      }

      const { GeminiClient } = await import('./clients/gemini_client.ts');

      return new GeminiClient(options.apiClient, options.gemini?.model);
    }

    case 'ollama': {
      const { OllamaClient } = await import('./clients/ollama_client.ts');

      return new OllamaClient(options.ollama);
    }

    case 'comfyui': {
      const { ComfyUiClient } = await import('./clients/comfyui_client.ts');

      return new ComfyUiClient(options.comfyui ?? ({} as ComfyUiClientOptions));
    }

    case 'local-tts': {
      const { LocalTtsClient } = await import('./clients/local_tts_client.ts');

      return new LocalTtsClient(options.localTts);
    }

    case 'mock': {
      const { MockAiClient } = await import('./mock/mock_ai_client.ts');

      return new MockAiClient();
    }

    default: {
      const _exhaustive: never = provider;

      throw new Error(`Unsupported AI provider: ${_exhaustive}`);
    }
  }
}

export { createAiClient };
