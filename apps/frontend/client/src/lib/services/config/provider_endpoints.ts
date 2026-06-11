// apps/frontend/client/src/lib/services/config/provider_endpoints.ts
//
// Provider endpoint definitions for API key verification.
// Each provider maps to a models-list endpoint that returns 200/401
// depending on key validity. No provider-specific branching in
// application code — consumers iterate this map generically.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Verification endpoint descriptor for a provider. */
export type ProviderEndpoint = {
  /** Human-readable label. */
  label: string;
  /** URL to fetch for key verification (typically a models-list endpoint). */
  verifyUrl: string;
  /** HTTP method for the verification request. */
  method: 'GET';
  /** How the API key is sent. */
  auth: {
    /** Where the key goes: 'header' | 'query'. */
    location: 'header' | 'query';
    /** Header name when `location === 'header'`, query param name when `location === 'query'`. */
    name: string;
    /** Optional value prefix (e.g. 'Bearer '). */
    prefix?: string;
  };
  /** Extra headers required by the provider (e.g. Anthropic version header). */
  extraHeaders?: Record<string, string>;
};

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
// Helpers
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
export const buildVerifyHeaders = (endpoint: ProviderEndpoint, apiKey: string): HeadersInit => {
  const headers: Record<string, string> = { ...endpoint.extraHeaders };

  if (endpoint.auth.location === 'header') {
    const prefix = endpoint.auth.prefix ?? '';
    headers[endpoint.auth.name] = `${prefix}${apiKey}`;
  }

  return headers;
};
