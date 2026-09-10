// apps/frontend/client/src/lib/services/config/provider_endpoints.ts
//
// Provider endpoint definitions for API key verification and model fetching.
// Each provider maps to a models-list endpoint that doubles as verification
// (200 = valid key, 401/403 = invalid). Model fetching uses a parallel
// registry with response parsers — no provider-specific branching in
// application code.
//
// The same registry owns model *testing*: every provider that can chat
// declares how to build its one-shot "hi" request, so no provider is
// excluded from the test button by identity.

import type { ProviderEndpoint } from '@aikami/types';
import { runtimeConfigService } from './runtime_config_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed model entry returned by the model-fetch pipeline. */
export type FetchedModel = {
  /** Model identifier (e.g. 'gpt-4o', 'claude-3-opus-20240229'). */
  id: string;
  /** Human-readable display name. */
  name: string;
};

/** A fully-resolved request a provider probe can be fired with. */
export type ProviderHttpRequest = {
  /** Absolute URL, with any query credential already applied. */
  url: string;
  /** Headers, with any header credential already applied. */
  headers: Record<string, string>;
  /** Serialized JSON body. Absent for GET probes. */
  body?: string;
};

/** What a request builder may need to resolve an endpoint at call time. */
export type ProviderRequestContext = {
  /** Credential for the connection being exercised, when the provider needs one. */
  apiKey?: string;
  /** The user's own base URL for local/custom endpoints, when they supplied one. */
  baseUrl?: string;
};

/** Configuration for fetching available models from a provider. */
export type ModelFetchConfig = {
  /** URL to fetch models from. Use `{{key}}` for API key substitution in query params. */
  url: string;
  /** Auth descriptor (reuses the same shape as ProviderEndpoint.auth). */
  auth: ProviderEndpoint['auth'];
  /** Extra headers required by the provider. */
  extraHeaders?: Record<string, string>;
  /** Additional HTTPS origins approved to receive credentials after a redirect. */
  approvedOrigins?: readonly string[];
  /**
   * Resolves the models URL at call time for endpoints that are not fixed —
   * local engines and user-supplied base URLs. Takes precedence over `url`
   * and returns undefined when no endpoint is known.
   */
  resolveModelsUrl?: (context: ProviderRequestContext) => string | undefined;
  /**
   * Parses the raw JSON response body into an array of { id, name }.
   * The parser receives the response body (unknown) and must return
   * an array of FetchedModel — consumers never branch on provider name.
   */
  parseResponse: (json: unknown) => FetchedModel[];
  /**
   * OpenAI-compatible chat base for fixed-endpoint cloud providers, e.g.
   * 'https://api.openai.com/v1'. The runtime text adapter reads this to locate
   * the provider's chat endpoint. Absent for runtime-resolved endpoints and
   * for providers that do not speak the OpenAI chat format (Google, Anthropic).
   */
  chatBaseUrl?: string;
  /**
   * Resolves the one-shot "hi" chat request that proves a model actually
   * answers. Absent only for providers with no chat surface at all, so model
   * testing is never gated on the provider's identity.
   */
  chatTest?: (
    context: ProviderRequestContext & { model: string },
  ) => ProviderHttpRequest | undefined;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_MODEL_FETCH_REDIRECTS = 5;

const isAllowedCredentialUrl = (options: {
  url: URL;
  hasCredential: boolean;
  approvedOrigins: ReadonlySet<string>;
}): boolean => {
  const { url, hasCredential, approvedOrigins } = options;
  if (url.username || url.password) {
    return false;
  }
  if (!hasCredential) {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  return url.protocol === 'https:' && approvedOrigins.has(url.origin);
};

/**
 * Fetches an endpoint without allowing credentials to cross an unencrypted or
 * unapproved redirect hop.
 */
export const fetchWithCredentialPolicy = async (options: {
  url: string | URL;
  init: RequestInit;
  hasCredential: boolean;
  approvedOrigins?: readonly string[];
}): Promise<Response | undefined> => {
  const { init, hasCredential } = options;
  let initialUrl: URL;
  try {
    initialUrl = new URL(options.url);
  } catch {
    return undefined;
  }

  const approvedOrigins = new Set([initialUrl.origin, ...(options.approvedOrigins ?? [])]);
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_MODEL_FETCH_REDIRECTS; redirectCount++) {
    if (!isAllowedCredentialUrl({ url: currentUrl, hasCredential, approvedOrigins })) {
      return undefined;
    }

    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location || redirectCount === MAX_MODEL_FETCH_REDIRECTS) {
      return undefined;
    }
    currentUrl = new URL(location, currentUrl);
  }
  return undefined;
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

/**
 * Parser for `{ models: [{ name: 'models/…', displayName? }] }` (Google-style).
 *
 * Google prefixes every id with `models/`; the id is stored without that
 * prefix so the same value works in the dropdown and in the chat URL (which
 * re-adds the segment). The list also advertises non-chat entries
 * (embeddings, vision-only), which are filtered out — a text connection can
 * do nothing with them.
 */
const parseGoogleModels = (json: unknown): FetchedModel[] => {
  const arr = (json as { models?: Array<Record<string, unknown>> }).models ?? [];
  return arr
    .filter((m) => {
      const methods = m.supportedGenerationMethods;
      return !Array.isArray(methods) || methods.includes('generateContent');
    })
    .map((m) => {
      const id = String(m.name ?? '').replace(/^models\//, '');
      return { id, name: String(m.displayName ?? id) };
    });
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
// Runtime-resolved endpoints (C-389) — depend on runtimeConfigService, so
// these stay app-local rather than moving to @aikami/constants.
// ---------------------------------------------------------------------------

/**
 * Resolves the Ollama endpoints from the runtime engine config (C-389).
 * Returns empty values when no text engine is configured — callers must
 * skip the fetch instead of probing a hardcoded localhost port.
 */
export const getOllamaRuntimeEndpoints = (): {
  url?: string;
  chatTestUrl?: string;
} => {
  const base = runtimeConfigService.getTextUrl()?.replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!base) {
    return {};
  }
  return {
    url: `${base}/api/tags`,
    chatTestUrl: `${base}/api/chat`,
  };
};

/**
 * Resolves the runtime-configured text engine's OpenAI-compatible models-
 * list URL (C-389/C-406). This is a DIFFERENT server shape from
 * `getOllamaRuntimeEndpoints` — the local-stack's bundled default (llama.cpp's
 * llama-server) speaks OpenAI's `/v1/models`, not Ollama's native `/api/tags`,
 * even though it commonly shares Ollama's default port. Returns undefined
 * when no text engine is configured.
 */
export const getOpenAiCompatRuntimeModelsUrl = (): string | undefined => {
  const base = runtimeConfigService.getTextUrl()?.replace(/\/+$/, '');
  if (!base) {
    return undefined;
  }
  // getTextUrl() is already an OpenAI-compatible base (e.g. ".../v1" per
  // apps/backend/local-stack/scripts/emit_config.sh) — append the standard
  // models-list path directly, no stripping.
  return `${base}/models`;
};

// ---------------------------------------------------------------------------
// Request builders — shared shapes, so no consumer branches on provider name
// ---------------------------------------------------------------------------

/** The prompt a model test sends. Deliberately trivial. */
const CHAT_TEST_PROMPT = 'hi';

/** Output cap for a model test — enough to prove the model answers, no more. */
const CHAT_TEST_MAX_TOKENS = 5;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
const ANTHROPIC_API_BASE = 'https://api.anthropic.com';

/** Bearer-token auth shared by the OpenAI-compatible providers. */
const OPENAI_COMPAT_AUTH: ProviderEndpoint['auth'] = {
  location: 'header',
  name: 'Authorization',
  prefix: 'Bearer ',
};

/** Keyless auth shared by local servers. */
const NO_AUTH: ProviderEndpoint['auth'] = { location: 'header', name: '' };

/** Google carries its key as a query parameter, not a header. */
const GOOGLE_AUTH: ProviderEndpoint['auth'] = { location: 'query', name: 'key' };

/** Anthropic authenticates by header, with a pinned API version. */
const ANTHROPIC_AUTH: ProviderEndpoint['auth'] = { location: 'header', name: 'x-api-key' };
const ANTHROPIC_EXTRA_HEADERS: Record<string, string> = { 'anthropic-version': '2023-06-01' };

/** Applies a header credential from an auth descriptor. */
const withAuthHeaders = (options: {
  auth: ProviderEndpoint['auth'];
  extraHeaders?: Record<string, string>;
  apiKey?: string;
}): Record<string, string> => {
  const headers: Record<string, string> = { ...options.extraHeaders };
  if (options.auth.location === 'header' && options.auth.name && options.apiKey) {
    headers[options.auth.name] = `${options.auth.prefix ?? ''}${options.apiKey}`;
  }
  return headers;
};

/**
 * Applies a query-param credential. Substitutes a `{{key}}` placeholder when
 * the URL has one, and appends the named parameter when it does not.
 */
const withQueryCredential = (options: {
  auth: ProviderEndpoint['auth'];
  apiKey?: string;
  url: string;
}): string => {
  const { auth, apiKey, url } = options;
  if (auth.location !== 'query' || !apiKey) {
    return url;
  }
  if (url.includes('{{key}}')) {
    return url.replace('{{key}}', encodeURIComponent(apiKey));
  }
  return `${url}${url.includes('?') ? '&' : '?'}${auth.name}=${encodeURIComponent(apiKey)}`;
};

/** OpenAI-compatible chat body: a single "hi" turn, capped at a few tokens. */
const openAiCompatChatBody = (model: string): string =>
  JSON.stringify({
    model,
    messages: [{ role: 'user', content: CHAT_TEST_PROMPT }],
    // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
    max_tokens: CHAT_TEST_MAX_TOKENS,
  });

/** `<base>/v1/models` for a user-supplied base URL, else the runtime text engine. */
const resolveOpenAiCompatModelsUrl = (baseUrl?: string): string | undefined => {
  const base = baseUrl?.trim().replace(/\/+$/, '');
  if (base) {
    return `${base.replace(/\/v1$/, '')}/v1/models`;
  }
  return getOpenAiCompatRuntimeModelsUrl();
};

/**
 * Chat URL for an OpenAI-compatible endpoint, derived from the models URL so
 * both probes always agree on which base they resolved.
 */
const resolveOpenAiCompatChatUrl = (baseUrl?: string): string | undefined =>
  resolveOpenAiCompatModelsUrl(baseUrl)?.replace(/\/models$/, '/chat/completions');

/** Ollama-native `POST /api/chat` — a different body shape from OpenAI's. */
const ollamaChatTest: NonNullable<ModelFetchConfig['chatTest']> = (context) => {
  const base = context.baseUrl?.trim().replace(/\/+$/, '');
  const url = base ? `${base}/api/chat` : getOllamaRuntimeEndpoints().chatTestUrl;
  if (!url) {
    return undefined;
  }
  return {
    body: JSON.stringify({
      model: context.model,
      messages: [{ role: 'user', content: CHAT_TEST_PROMPT }],
      stream: false,
      options: {
        // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
        num_predict: CHAT_TEST_MAX_TOKENS,
      },
    }),
    headers: {},
    url,
  };
};

/** OpenAI-compatible chat test against a runtime-resolved local endpoint. */
const localOpenAiCompatChatTest: NonNullable<ModelFetchConfig['chatTest']> = (context) => {
  const url = resolveOpenAiCompatChatUrl(context.baseUrl);
  if (!url) {
    return undefined;
  }
  return {
    body: openAiCompatChatBody(context.model),
    headers: withAuthHeaders({ auth: OPENAI_COMPAT_AUTH, apiKey: context.apiKey }),
    url,
  };
};

/**
 * Google Gemini `POST /v1beta/models/{model}:generateContent`. Gemini is not
 * OpenAI-compatible: the turn lives in `contents[].parts[].text`, the output
 * cap in `generationConfig.maxOutputTokens`, and the key travels as `?key=`.
 */
const geminiChatTest: NonNullable<ModelFetchConfig['chatTest']> = (context) => {
  const base = (context.baseUrl?.trim() || GEMINI_API_BASE).replace(/\/+$/, '');
  const model = context.model.replace(/^models\//, '');
  return {
    body: JSON.stringify({
      contents: [{ parts: [{ text: CHAT_TEST_PROMPT }], role: 'user' }],
      generationConfig: {
        maxOutputTokens: CHAT_TEST_MAX_TOKENS,
      },
    }),
    headers: withAuthHeaders({ auth: GOOGLE_AUTH, apiKey: context.apiKey }),
    url: withQueryCredential({
      auth: GOOGLE_AUTH,
      apiKey: context.apiKey,
      url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    }),
  };
};

/**
 * Anthropic `POST /v1/messages`. Its own body shape — `max_tokens` is
 * required, and the response is a `content[]` block list rather than choices.
 */
const anthropicChatTest: NonNullable<ModelFetchConfig['chatTest']> = (context) => ({
  body: JSON.stringify({
    model: context.model,
    // biome-ignore lint/style/useNamingConvention: Anthropic API contract field name
    max_tokens: CHAT_TEST_MAX_TOKENS,
    messages: [{ role: 'user', content: CHAT_TEST_PROMPT }],
  }),
  headers: withAuthHeaders({
    auth: ANTHROPIC_AUTH,
    extraHeaders: ANTHROPIC_EXTRA_HEADERS,
    apiKey: context.apiKey,
  }),
  url: `${ANTHROPIC_API_BASE}/v1/messages`,
});

// ---------------------------------------------------------------------------
// Model-fetch registry — one entry per provider; consumers iterate generically
// ---------------------------------------------------------------------------

/**
 * Local OpenAI-compatible servers (llama.cpp, TextGen WebUI, custom) share
 * every request shape — only their labels differ. The endpoint is resolved at
 * call time from the draft's own URL, else the configured local engine.
 */
const LOCAL_OPENAI_COMPAT_ENTRY: ModelFetchConfig = {
  auth: OPENAI_COMPAT_AUTH,
  chatTest: localOpenAiCompatChatTest,
  resolveModelsUrl: ({ baseUrl }) => resolveOpenAiCompatModelsUrl(baseUrl),
  url: '',
  parseResponse: (json) => parseDataArray(json),
};

/**
 * Model-fetch and model-test configuration per provider.
 *
 * Consumers call `fetchModelsFromProvider({ config, apiKey })` for discovery
 * and `resolveChatTestRequest({ registryId, model, apiKey })` for testing.
 * No if/else branching on provider name is needed — `parseResponse` handles
 * the per-provider list shape and `chatTest` (or `chatBaseUrl`) the chat shape.
 */
export const PROVIDER_MODEL_FETCH: Record<string, ModelFetchConfig> = {
  openrouter: {
    auth: OPENAI_COMPAT_AUTH,
    chatBaseUrl: 'https://openrouter.ai/api/v1',
    url: 'https://openrouter.ai/api/v1/models',
    parseResponse: (json) => parseDataArray(json, 'name'),
  },
  openai: {
    auth: OPENAI_COMPAT_AUTH,
    chatBaseUrl: 'https://api.openai.com/v1',
    url: 'https://api.openai.com/v1/models',
    parseResponse: (json) => parseDataArray(json),
  },
  anthropic: {
    auth: ANTHROPIC_AUTH,
    chatTest: anthropicChatTest,
    extraHeaders: ANTHROPIC_EXTRA_HEADERS,
    url: 'https://api.anthropic.com/v1/models',
    parseResponse: (json) => parseDataArray(json, 'display_name'),
  },
  google: {
    auth: GOOGLE_AUTH,
    chatTest: geminiChatTest,
    url: 'https://generativelanguage.googleapis.com/v1beta/models?key={{key}}',
    parseResponse: parseGoogleModels,
  },
  deepseek: {
    auth: OPENAI_COMPAT_AUTH,
    chatBaseUrl: 'https://api.deepseek.com/v1',
    url: 'https://api.deepseek.com/models',
    parseResponse: (json) => parseDataArray(json),
  },
  mistral: {
    auth: OPENAI_COMPAT_AUTH,
    chatBaseUrl: 'https://api.mistral.ai/v1',
    url: 'https://api.mistral.ai/v1/models',
    parseResponse: parseRawArray,
  },
  ollama: {
    auth: NO_AUTH,
    chatTest: ollamaChatTest,
    // URL is runtime-resolved (C-389) — no baked-in endpoint.
    resolveModelsUrl: ({ baseUrl }) => {
      const base = baseUrl?.trim().replace(/\/+$/, '');
      return base ? `${base}/api/tags` : getOllamaRuntimeEndpoints().url;
    },
    url: '',
    parseResponse: parseModelsArray,
  },
  llamacpp: LOCAL_OPENAI_COMPAT_ENTRY,
  ooba: LOCAL_OPENAI_COMPAT_ENTRY,
  custom: LOCAL_OPENAI_COMPAT_ENTRY,
} as const;

// ---------------------------------------------------------------------------
// Request resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the model-test request for a provider.
 *
 * OpenAI-compatible cloud providers derive theirs from `chatBaseUrl`; every
 * other provider declares a `chatTest` builder. Returns undefined only when
 * the provider has no chat surface, or when its endpoint cannot be resolved
 * (no base URL and no configured local engine) — never because of identity.
 */
export const resolveChatTestRequest = (options: {
  registryId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): ProviderHttpRequest | undefined => {
  const { apiKey, baseUrl, model, registryId } = options;
  const config = PROVIDER_MODEL_FETCH[registryId];
  if (!config) {
    return undefined;
  }

  if (config.chatTest) {
    return config.chatTest({ apiKey, baseUrl, model });
  }

  if (!config.chatBaseUrl) {
    return undefined;
  }

  return {
    body: openAiCompatChatBody(model),
    headers: withAuthHeaders({ auth: config.auth, extraHeaders: config.extraHeaders, apiKey }),
    url: `${config.chatBaseUrl}/chat/completions`,
  };
};

/**
 * Fetches available models from a provider using its registry config.
 *
 * @returns A parsed array of `{ id, name }` model entries, or an empty
 *          array on any error (network, auth, parse failure).
 */
export const fetchModelsFromProvider = async (options: {
  config: ModelFetchConfig;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<FetchedModel[]> => {
  const { config, apiKey, baseUrl, timeoutMs = 15_000 } = options;

  const resolved = config.resolveModelsUrl?.({ apiKey, baseUrl }) ?? config.url;
  if (!resolved) {
    return [];
  }

  const url = withQueryCredential({ auth: config.auth, apiKey, url: resolved });
  const headers = withAuthHeaders({
    auth: config.auth,
    extraHeaders: config.extraHeaders,
    apiKey,
  });

  const hasCredential = Boolean(apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchWithCredentialPolicy({
      url,
      hasCredential,
      approvedOrigins: config.approvedOrigins,
      init: {
        headers,
        method: 'GET',
        signal: controller.signal,
      },
    });
    if (!response?.ok) {
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
