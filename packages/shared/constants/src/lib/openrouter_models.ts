// packages/shared/constants/src/lib/openrouter_models.ts
//
// Runtime-neutral utility for fetching available models from OpenRouter's API.

import type { OpenRouterModel } from '@aikami/types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches available models from OpenRouter.
 *
 * Falls back to an empty array on network errors, CORS issues, or invalid
 * API keys — the caller should handle the empty case gracefully.
 *
 * @param apiKey - A valid OpenRouter API key.
 */
export const fetchOpenRouterModels = async (apiKey: string): Promise<OpenRouterModel[]> => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        // biome-ignore lint/style/useNamingConvention: HTTP header name
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as { data: OpenRouterModel[] };
    return json.data ?? [];
  } catch {
    return [];
  }
};
