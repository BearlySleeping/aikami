// apps/frontend/client/src/lib/services/config/openrouter_models.ts
//
// Utility for fetching available models from OpenRouter's API.
// Models are cached in localStorage to avoid repeated fetches and
// rate-limit issues.

import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single model entry from the OpenRouter /models endpoint. */
export type OpenRouterModel = {
  /** Unique model identifier (e.g. 'openai/gpt-4o'). */
  id: string;
  /** Human-readable model name. */
  name: string;
  /** Maximum context length in tokens. */
  // biome-ignore lint/style/useNamingConvention: OpenRouter API uses snake_case
  context_length: number;
  /** Pricing information per token. */
  pricing: {
    prompt: number;
    completion: number;
  };
};

/** Response shape from OpenRouter GET /api/v1/models. */
type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const CACHE_KEY = 'aikami_openrouter_models';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Cached entry shape
// ---------------------------------------------------------------------------

type CachedModels = {
  timestamp: number;
  models: OpenRouterModel[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches available models from OpenRouter, using a cached response when
 * available and fresh.
 *
 * Falls back to an empty array on network errors, CORS issues, or invalid
 * API keys — the caller should handle the empty case gracefully.
 *
 * @param apiKey - A valid OpenRouter API key.
 */
export const fetchOpenRouterModels = async (apiKey: string): Promise<OpenRouterModel[]> => {
  // Check cache first
  const cached = _readCache();
  if (cached) {
    logger.debug('fetchOpenRouterModels: cache hit', {
      count: cached.length,
    });
    return cached;
  }

  logger.debug('fetchOpenRouterModels: fetching from API');

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
      logger.warn('fetchOpenRouterModels: non-OK response', {
        status: response.status,
      });
      return [];
    }

    const json = (await response.json()) as OpenRouterModelsResponse;
    const models = json.data ?? [];

    _writeCache(models);
    return models;
  } catch (error) {
    logger.warn('fetchOpenRouterModels: fetch failed', error);
    return [];
  }
};

/**
 * Clears the cached model list from localStorage.
 */
export const clearOpenRouterCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const _readCache = (): OpenRouterModel[] | undefined => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return undefined;
    }

    const cached = JSON.parse(raw) as CachedModels;
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return undefined;
    }

    return cached.models;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return undefined;
  }
};

const _writeCache = (models: OpenRouterModel[]): void => {
  try {
    const entry: CachedModels = {
      models,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently skip
  }
};
