// apps/backend/firebase/functions-cache.ts
// biome-ignore-all lint/style/useNamingConvention: standard HTTP header names
import type { FunctionsCacheGet, FunctionsCacheUpdate } from '@snorreks/firestack';

const CACHE_PREFIX = 'cache-firestack-aikami';

const getBaseUrl = (): string => {
  const key = process.env.REDIS_URL;
  if (!key) {
    throw new Error('REDIS_URL environment variable is required');
  }
  return key;
};

const getAccessKey = (): string => {
  const key = process.env.REDIS_TOKEN;
  if (!key) {
    throw new Error('REDIS_TOKEN environment variable is required');
  }
  return key;
};

export const get: FunctionsCacheGet = async ({ mode }) => {
  // We use the mode directly in the URL to dynamically create the key
  const response = await fetch(`${getBaseUrl()}/get/${CACHE_PREFIX}:${mode}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getAccessKey()}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch cache: ${response.statusText}`);
  }

  const data = await response.json();
  // Upstash returns the data inside a 'result' property.
  // If the key doesn't exist yet, it returns null, so we fallback to an empty object.
  return data.result ? JSON.parse(data.result) : {};
};

export const update: FunctionsCacheUpdate = async ({ mode, newFunctionsCache }) => {
  const oldFunctionsCache = await get({ mode });

  const mergedFunctionsCache = {
    ...oldFunctionsCache,
    ...newFunctionsCache,
  };

  const response = await fetch(`${getBaseUrl()}/set/${CACHE_PREFIX}:${mode}`, {
    method: 'POST', // Upstash REST uses POST for setting data
    headers: {
      Authorization: `Bearer ${getAccessKey()}`,
    },
    // We stringify the merged cache so it saves as a JSON string in Redis
    body: JSON.stringify(mergedFunctionsCache),
  });

  if (!response.ok) {
    throw new Error(`Failed to update cache: ${response.statusText}`);
  }
};
