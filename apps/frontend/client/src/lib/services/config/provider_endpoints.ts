// apps/frontend/client/src/lib/services/config/provider_endpoints.ts
//
// Provider endpoint definitions for API key verification and model fetching.
// Each provider maps to a models-list endpoint that doubles as verification
// (200 = valid key, 401/403 = invalid). Model fetching uses a parallel
// registry with response parsers — no provider-specific branching in
// application code.

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

/** Parsed model entry returned by the model-fetch pipeline. */
export type FetchedModel = {
  /** Model identifier (e.g. 'gpt-4o', 'claude-3-opus-20240229'). */
  id: string;
  /** Human-readable display name. */
  name: string;
};

/** Configuration for fetching available models from a provider. */
export type ModelFetchConfig = {
  /** URL to fetch models from. Use `{{key}}` for API key substitution in query params. */
  url: string;
  /** Auth descriptor (reuses the same shape as ProviderEndpoint.auth). */
  auth: ProviderEndpoint['auth'];
  /** Extra headers required by the provider. */
  extraHeaders?: Record<string, string>;
  /**
   * Parses the raw JSON response body into an array of { id, name }.
   * The parser receives the response body (unknown) and must return
   * an array of FetchedModel — consumers never branch on provider name.
   */
  parseResponse: (json: unknown) => FetchedModel[];
  /**
   * URL for testing a model via a simple chat completion.
   * Uses the OpenAI-compatible POST /chat/completions format by default.
   */
  chatTestUrl?: string;
  /** Whether this provider uses OpenAI-compatible chat completions for model testing. */
  chatTestOpenAiCompat?: boolean;
};

// ---------------------------------------------------------------------------
// Shared parsers — common response shapes reused across providers
// ---------------------------------------------------------------------------

/** Parser for `{ data: [{ id, name? }] }` (OpenRouter-style). */
const parseDataArray = (json: unknown, nameField?: string): FetchedModel[] => {
  const arr = (json as { data?: Array<Record<string, unknown>> }).data ?? [];
  return arr.map((m) => {
    const id = String(m.id ?? '');
    const name = nameField ? String(m[nameField] ?? id) : id;
    return { id, name };
  });
};

/** Parser for `{ models: [{ name }] }` (Ollama-style). */
const parseModelsArray = (json: unknown): FetchedModel[] => {
  const arr = (json as { models?: Array<{ name: string }> }).models ?? [];
  return arr.map((m) => ({ id: m.name, name: m.name }));
};

/** Parser for raw model arrays (Mistral-style). */
const parseRawArray = (json: unknown): FetchedModel[] => {
  if (!Array.isArray(json)) {
    return [];
  }
  return json.map((m: Record<string, unknown>) => {
    const id = String(m.id ?? '');
    const name = String(m.id ?? '');
    return { id, name };
  });
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
// Model-fetch registry — one entry per provider; consumers iterate generically
// ---------------------------------------------------------------------------

/**
 * Model-fetch configuration per provider.
 *
 * Consumers call `fetchModelsFromProvider({ config, apiKey })` which returns
 * a parsed `FetchedModel[]`. No if/else branching on provider name is needed
 * — the `parseResponse` function handles the per-provider response shape.
 */
export const PROVIDER_MODEL_FETCH: Record<string, ModelFetchConfig> = {
  openrouter: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatTestOpenAiCompat: true,
    chatTestUrl: 'https://openrouter.ai/api/v1/chat/completions',
    url: 'https://openrouter.ai/api/v1/models',
    parseResponse: (json) => parseDataArray(json, 'name'),
  },
  openai: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatTestOpenAiCompat: true,
    chatTestUrl: 'https://api.openai.com/v1/chat/completions',
    url: 'https://api.openai.com/v1/models',
    parseResponse: (json) => parseDataArray(json),
  },
  anthropic: {
    auth: { location: 'header', name: 'x-api-key' },
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    url: 'https://api.anthropic.com/v1/models',
    parseResponse: (json) => parseDataArray(json, 'display_name'),
  },
  deepseek: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatTestOpenAiCompat: true,
    chatTestUrl: 'https://api.deepseek.com/v1/chat/completions',
    url: 'https://api.deepseek.com/models',
    parseResponse: (json) => parseDataArray(json),
  },
  mistral: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatTestOpenAiCompat: true,
    chatTestUrl: 'https://api.mistral.ai/v1/chat/completions',
    url: 'https://api.mistral.ai/v1/models',
    parseResponse: parseRawArray,
  },
  ollama: {
    auth: { location: 'header', name: '' },
    chatTestOpenAiCompat: false,
    chatTestUrl: 'http://localhost:11434/api/chat',
    url: 'http://localhost:11434/api/tags',
    parseResponse: parseModelsArray,
  },
} as const;

/**
 * Fetches available models from a provider using its registry config.
 *
 * @returns A parsed array of `{ id, name }` model entries, or an empty
 *          array on any error (network, auth, parse failure).
 */
export const fetchModelsFromProvider = async (options: {
  config: ModelFetchConfig;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<FetchedModel[]> => {
  const { config, apiKey, timeoutMs = 15_000 } = options;

  const headers: Record<string, string> = { ...config.extraHeaders };

  if (config.auth.location === 'header' && apiKey) {
    const prefix = config.auth.prefix ?? '';
    headers[config.auth.name] = `${prefix}${apiKey}`;
  }

  let url = config.url;
  if (config.auth.location === 'query' && apiKey) {
    url = url.replace('{{key}}', encodeURIComponent(apiKey));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as unknown;
    return config.parseResponse(json);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};

// ---------------------------------------------------------------------------
// Verification helpers (unchanged)
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
