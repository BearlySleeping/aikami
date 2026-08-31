// apps/frontend/client/src/lib/services/config/openrouter_models.ts
//
// Browser cache wrapper around the runtime-neutral shared fetch utility.

import { fetchOpenRouterModels as fetchOpenRouterModelsUncached } from '@aikami/constants';
import type { OpenRouterModel } from '@aikami/types';

const CACHE_KEY = 'aikami_openrouter_models';
const CACHE_TTL_MS = 30 * 60 * 1000;

type CachedModels = {
  timestamp: number;
  models: OpenRouterModel[];
};

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
    return undefined;
  }
};

const _writeCache = (models: OpenRouterModel[]): void => {
  try {
    const cached: CachedModels = { models, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Storage may be unavailable or full; fetching still succeeds.
  }
};

/** Fetches OpenRouter models, reusing a fresh browser-local response. */
export const fetchOpenRouterModels = async (apiKey: string): Promise<OpenRouterModel[]> => {
  const cached = _readCache();
  if (cached) {
    return cached;
  }
  const models = await fetchOpenRouterModelsUncached(apiKey);
  _writeCache(models);
  return models;
};

/** Clears the browser-local OpenRouter model cache. */
export const clearOpenRouterCache = (): void => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage may be unavailable in tests or restricted browser contexts.
  }
};
