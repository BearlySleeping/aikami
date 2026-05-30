// apps/frontend/game/src/engine/services/ai_config.ts

import type {
  AiClientOptions,
  AiProvider,
  FrontendAiInterface,
  GameApiClientInterface,
} from '@aikami/frontend-api-core';

/**
 * Priority chain for provider selection:
 * 1. URL query parameter (?ai_provider=ollama)
 * 2. localStorage key (aikami_ai_provider)
 * 3. Environment variable (VITE_AI_PROVIDER)
 * 4. Default ('ollama')
 *
 * @returns The configured AI provider identifier.
 */
function getConfiguredProvider(): AiProvider {
  if (typeof window !== 'undefined') {
    // URL param
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl = urlParams.get('ai_provider');

    if (fromUrl && isValidProvider(fromUrl)) {
      return fromUrl as AiProvider;
    }

    // localStorage
    try {
      const fromStorage = localStorage.getItem('aikami_ai_provider');

      if (fromStorage && isValidProvider(fromStorage)) {
        return fromStorage as AiProvider;
      }
    } catch {
      // localStorage may be unavailable (SSR, some privacy modes)
    }
  }

  // Environment variable (Vite exposes import.meta.env)
  try {
    const fromEnv = import.meta.env.VITE_AI_PROVIDER as string | undefined;

    if (fromEnv && isValidProvider(fromEnv)) {
      return fromEnv as AiProvider;
    }
  } catch {
    // import.meta.env may be unavailable in some contexts
  }

  // Default
  return 'ollama';
}

/**
 * Returns the AI client options for the configured provider.
 *
 * @param apiClient - Optional API client (required for cloud providers).
 * @returns Provider-specific options.
 */
function getAiClientOptions(apiClient?: GameApiClientInterface): AiClientOptions {
  return {
    apiClient,
    ollama: {
      model: 'llama3',
      timeoutMs: 30000,
    },
    openai: {
      model: 'gpt-4o',
    },
    gemini: {
      model: 'gemini-2.0-flash',
    },
    comfyui: {
      workflowId: import.meta.env.VITE_COMFYUI_WORKFLOW_ID as string ?? 'default',
      timeoutMs: 60000,
    },
    localTts: {
      rate: 1.0,
      pitch: 1.0,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = ['openai', 'gemini', 'ollama', 'comfyui', 'local-tts', 'mock'];

function isValidProvider(value: string): value is AiProvider {
  return VALID_PROVIDERS.includes(value);
}

// ---------------------------------------------------------------------------
// Provider Selection (async — lazy imports the factory)
// ---------------------------------------------------------------------------

/**
 * Creates and returns the configured AI provider.
 *
 * @param apiClient - API client for backend communication (required for cloud providers).
 * @returns A configured AI provider instance.
 */
async function createConfiguredAiClient(apiClient?: GameApiClientInterface): Promise<FrontendAiInterface> {
  const { createAiClient } = await import('@aikami/frontend-api-core');
  const provider = getConfiguredProvider();
  const options = getAiClientOptions(apiClient);

  const client = await createAiClient(provider, options);

  return client;
}

export { createConfiguredAiClient, getConfiguredProvider };
