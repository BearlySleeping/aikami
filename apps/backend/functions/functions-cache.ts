import type { FunctionsCacheGet, FunctionsCacheUpdate } from '@snorreks/firestack';

// Use the endpoint from your screenshot (don't forget the https://)
const baseURL = 'https://picked-hog-64217.upstash.io';
// Paste your unhidden token here (ideally move this to an environment variable later!)
const token = 'AfrZAAIncDJkMWJhNGQ0NzI5YTI0YzI1OGE1YWYxMzM1MWZkZDVmNXAyNjQyMTc';

export const get: FunctionsCacheGet = async ({ flavor }) => {
  // We use the flavor directly in the URL to dynamically create the key
  const response = await fetch(`${baseURL}/get/cache:${flavor}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
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

export const update: FunctionsCacheUpdate = async ({ flavor, newFunctionsCache }) => {
  const oldFunctionsCache = await get({ flavor });

  const mergedFunctionsCache = {
    ...oldFunctionsCache,
    ...newFunctionsCache,
  };

  const response = await fetch(`${baseURL}/set/cache:${flavor}`, {
    method: 'POST', // Upstash REST uses POST for setting data
    headers: {
      Authorization: `Bearer ${token}`,
    },
    // We stringify the merged cache so it saves as a JSON string in Redis
    body: JSON.stringify(mergedFunctionsCache),
  });

  if (!response.ok) {
    throw new Error(`Failed to update cache: ${response.statusText}`);
  }
};
