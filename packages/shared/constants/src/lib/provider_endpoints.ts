// packages/shared/constants/src/lib/provider_endpoints.ts
//
// Provider endpoint definitions for API key verification.
// Each provider maps to a models-list endpoint that doubles as verification
// (200 = valid key, 401/403 = invalid).

import type { ProviderEndpoint } from '@aikami/types';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Provider endpoint registry.
 *
 * Each entry's `verifyUrl` is a GET endpoint that returns 200 for a valid
 * key and 401/403 for an invalid one. Consumers iterate this map generically
 * — no if/else branching on provider name.
 */
export const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openrouter: {
    label: 'OpenRouter',
    method: 'GET',
    verifyUrl: 'https://openrouter.ai/api/v1/auth/key',
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
  },
  gemini: {
    label: 'Gemini',
    method: 'GET',
    verifyUrl: 'https://generativelanguage.googleapis.com/v1beta/models?key={{key}}',
    auth: { location: 'query', name: 'key' },
  },
  anthropic: {
    label: 'Anthropic',
    method: 'GET',
    verifyUrl: 'https://api.anthropic.com/v1/models',
    auth: { location: 'header', name: 'x-api-key' },
    extraHeaders: { 'anthropic-version': '2023-06-01' },
  },
  openai: {
    label: 'OpenAI',
    method: 'GET',
    verifyUrl: 'https://api.openai.com/v1/models',
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
  },
  deepseek: {
    label: 'DeepSeek',
    method: 'GET',
    verifyUrl: 'https://api.deepseek.com/v1/models',
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
  },
} as const;

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

/** Builds a verification URL, substituting `{{key}}` placeholders when the key
 *  is passed as a query parameter. */
export const buildVerifyUrl = (endpoint: ProviderEndpoint, apiKey: string): string => {
  if (endpoint.auth.location === 'query') {
    return endpoint.verifyUrl.replace('{{key}}', encodeURIComponent(apiKey));
  }
  return endpoint.verifyUrl;
};

/** Builds headers for a verification request. */
export const buildVerifyHeaders = (
  endpoint: ProviderEndpoint,
  apiKey: string,
): Record<string, string> => {
  const headers: Record<string, string> = { ...endpoint.extraHeaders };

  if (endpoint.auth.location === 'header') {
    const prefix = endpoint.auth.prefix ?? '';
    headers[endpoint.auth.name] = `${prefix}${apiKey}`;
  }

  return headers;
};
