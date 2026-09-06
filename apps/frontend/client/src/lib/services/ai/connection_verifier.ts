// apps/frontend/client/src/lib/services/ai/connection_verifier.ts
//
// Connection verification helper — reusable probe logic for AI provider
// endpoints. Supports keyless local providers (Ollama, OpenAI-compatible)
// and cloud providers with API keys.
//
// P02 — verify keyless local connections through their actual endpoint.
//
// The fetch transport and base URL are injectable so tests can supply
// mocks without touching global state or importing runtime config.

import { buildVerifyHeaders, buildVerifyUrl, PROVIDER_ENDPOINTS } from '@aikami/constants';
import type { AiProvider } from '@aikami/types';
import type { ConnectionTestResult } from '$types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 15_000;

/** Providers that speak Ollama's native API (GET /api/tags). */
const OLLAMA_NATIVE = new Set(['ollama']);

/** Providers that speak the OpenAI-compatible /v1/models endpoint. */
const OPENAI_COMPAT = new Set(['llamacpp', 'custom', 'openai-compat']);

/** Local providers that are keyless and may need URL-based probing. */
const LOCAL_PROVIDERS = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'kokoro',
  'voicevox',
  'fish-speech',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Injectable fetch transport. */
export type FetchTransport = (url: string | URL, init: RequestInit) => Promise<Response>;

/** Options for verifyConnection. */
export type VerifyConnectionOptions = {
  /** The provider (credential + baseUrl). */
  provider: AiProvider;
  /**
   * Resolved base URL for the endpoint.
   * When omitted, the verifier falls back to `provider.baseUrl`.
   * When both are unset, local providers return an error.
   */
  baseUrl?: string;
  /** Optional AbortSignal for timeout/cancellation. */
  signal?: AbortSignal;
  /** Maximum probe duration in milliseconds. */
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verifies that a provider endpoint is reachable and returns an
 * actionable `ConnectionTestResult`.
 *
 * - Keyless Ollama: probes `GET <baseUrl>/api/tags`.
 * - Keyless OpenAI-compatible: probes `GET <baseUrl>/v1/models` and
 *   validates the response shape (`{ object: "list", data: [...] }`).
 * - Cloud providers: uses `PROVIDER_ENDPOINTS` with API-key auth.
 * - Unsupported protocols: returns `{ ok: false, error: '…' }`.
 *
 * @param options  Provider, optional resolved base URL, signal, and timeout.
 * @param fetchFn  Injectable fetch (defaults to globalThis.fetch).
 */
export const verifyConnection = async (
  options: VerifyConnectionOptions,
  fetchFn: FetchTransport = globalThis.fetch.bind(globalThis),
): Promise<ConnectionTestResult> => {
  const { provider, baseUrl, signal, timeoutMs } = options;
  const registryId = provider.registryId;

  const startMs = performance.now();
  const elapsed = () => Math.round(performance.now() - startMs);

  try {
    // ── Ollama native ────────────────────────────────────────────────
    if (OLLAMA_NATIVE.has(registryId)) {
      return verifyOllama(provider, baseUrl, elapsed, fetchFn, signal, timeoutMs);
    }

    // ── OpenAI-compatible ────────────────────────────────────────────
    if (OPENAI_COMPAT.has(registryId)) {
      return verifyOpenAiCompat(provider, baseUrl, elapsed, fetchFn, signal, timeoutMs);
    }

    // ── Cloud providers with API key ─────────────────────────────────
    const endpoint = PROVIDER_ENDPOINTS[registryId];
    if (!endpoint) {
      return {
        ok: false,
        latencyMs: elapsed(),
        error: 'Connection verification not supported for this provider',
      };
    }

    if (!provider.credential) {
      return {
        ok: false,
        latencyMs: elapsed(),
        error: 'No API key configured',
      };
    }

    return verifyCloudProvider(endpoint, provider.credential, elapsed, fetchFn, signal, timeoutMs);
  } catch (err) {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: normalizeError(err),
    };
  }
};

/**
 * Returns true when the provider is local/keyless.
 */
export const isLocalProvider = (registryId: string): boolean => LOCAL_PROVIDERS.has(registryId);

/**
 * Returns true when the protocol has a known verification strategy.
 */
export const hasVerificationStrategy = (registryId: string): boolean =>
  OLLAMA_NATIVE.has(registryId) ||
  OPENAI_COMPAT.has(registryId) ||
  registryId in PROVIDER_ENDPOINTS;

// ---------------------------------------------------------------------------
// Protocol-specific verifiers
// ---------------------------------------------------------------------------

/**
 * Probes an Ollama instance at `GET <baseUrl>/api/tags`.
 *
 * Acceptance: HTTP 200 + valid JSON with `{ models: [...] }` → ok.
 * Any non-JSON or missing `models` field → failure with descriptive error.
 */
const verifyOllama = async (
  provider: AiProvider,
  baseUrlOverride: string | undefined,
  elapsed: () => number,
  fetchFn: FetchTransport,
  outerSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<ConnectionTestResult> => {
  const url = buildProbeUrl(baseUrlOverride ?? provider.baseUrl, '/api/tags');
  if (!url) {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: 'No endpoint configured — set a base URL',
    };
  }

  const { signal, cleanup } = createTimeoutSignal({ outerSignal, timeoutMs });

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      signal,
    });

    if (!response.ok) {
      return { ok: false, latencyMs: elapsed(), error: `HTTP ${response.status}` };
    }

    const parseResult = await parseJsonResponse(response);
    if (!parseResult.ok) {
      return { ok: false, latencyMs: elapsed(), error: parseResult.error };
    }

    const models = (parseResult.data as Record<string, unknown>)?.models;
    if (!Array.isArray(models)) {
      return {
        ok: false,
        latencyMs: elapsed(),
        error: 'Unexpected response shape — expected { models: [...] }',
      };
    }

    return { ok: true, latencyMs: elapsed(), modelCount: models.length };
  } catch (err) {
    return { ok: false, latencyMs: elapsed(), error: normalizeError(err) };
  } finally {
    cleanup();
  }
};

/**
 * Probes an OpenAI-compatible endpoint at `GET <baseUrl>/v1/models`.
 *
 * Acceptance: HTTP 200 + JSON with `{ object: "list", data: [...] }` → ok.
 * Validates the response shape to distinguish a real API from a web server.
 */
const verifyOpenAiCompat = async (
  provider: AiProvider,
  baseUrlOverride: string | undefined,
  elapsed: () => number,
  fetchFn: FetchTransport,
  outerSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<ConnectionTestResult> => {
  const raw = baseUrlOverride ?? provider.baseUrl;
  if (!raw) {
    return { ok: false, latencyMs: elapsed(), error: 'No endpoint configured — set a base URL' };
  }

  // Strip trailing slash and /v1 suffix to normalise
  const normalized = raw.replace(/\/+$/, '').replace(/\/v1$/, '');
  const url = `${normalized}/v1/models`;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, latencyMs: elapsed(), error: 'Invalid endpoint URL' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, latencyMs: elapsed(), error: 'Unsupported endpoint protocol' };
  }

  if (provider.credential && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      latencyMs: elapsed(),
      error: 'Credentials require an HTTPS endpoint',
    };
  }

  const { signal, cleanup } = createTimeoutSignal({ outerSignal, timeoutMs });

  // Build auth headers if the provider has a credential
  const headers: Record<string, string> = {};
  if (provider.credential) {
    headers.Authorization = `Bearer ${provider.credential}`;
  }

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal,
    });

    if (!response.ok) {
      return { ok: false, latencyMs: elapsed(), error: `HTTP ${response.status}` };
    }

    const parseResult = await parseJsonResponse(response);
    if (!parseResult.ok) {
      return { ok: false, latencyMs: elapsed(), error: parseResult.error };
    }

    const obj = parseResult.data as Record<string, unknown>;
    if (obj.object !== 'list' || !Array.isArray(obj.data)) {
      return {
        ok: false,
        latencyMs: elapsed(),
        error: 'Unexpected response shape — expected { object: "list", data: [...] }',
      };
    }

    return { ok: true, latencyMs: elapsed(), modelCount: obj.data.length };
  } catch (err) {
    return { ok: false, latencyMs: elapsed(), error: normalizeError(err) };
  } finally {
    cleanup();
  }
};

/**
 * Verifies a cloud provider via its PROVIDER_ENDPOINTS descriptor.
 */
const verifyCloudProvider = async (
  endpoint: (typeof PROVIDER_ENDPOINTS)[string],
  apiKey: string,
  elapsed: () => number,
  fetchFn: FetchTransport,
  outerSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<ConnectionTestResult> => {
  const url = buildVerifyUrl({ endpoint, apiKey });
  const headers = buildVerifyHeaders({ endpoint, apiKey });
  const { signal, cleanup } = createTimeoutSignal({ outerSignal, timeoutMs });

  try {
    const response = await fetchFn(url, {
      method: endpoint.method,
      headers,
      signal,
    });

    if (!response.ok) {
      return { ok: false, latencyMs: elapsed(), error: `HTTP ${response.status}` };
    }

    // Attempt to extract model count from JSON
    let modelCount: number | undefined;
    try {
      const text = await response.clone().text();
      const data = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(data.data)) {
        modelCount = data.data.length;
      } else if (Array.isArray(data.models)) {
        modelCount = data.models.length;
      }
    } catch {
      // Non-JSON or parse failure — connection is still ok
    }

    return { ok: true, latencyMs: elapsed(), modelCount };
  } catch (err) {
    return { ok: false, latencyMs: elapsed(), error: normalizeError(err) };
  } finally {
    cleanup();
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a probe URL from a base + path. Returns undefined when base is empty. */
const buildProbeUrl = (base: string | undefined, path: string): string | undefined => {
  if (!base) {
    return undefined;
  }
  return `${base.replace(/\/+$/, '')}${path}`;
};

/**
 * Parses a response as JSON, returning a descriptive error for
 * malformed JSON or SPA HTML served in place of an API response.
 */
const parseJsonResponse = async (
  response: Response,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
  const text = await response.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    if (text.startsWith('<')) {
      return {
        ok: false,
        error:
          'Received HTML instead of JSON — verify the base URL points to the API, not a web UI',
      };
    }
    return { ok: false, error: 'Invalid JSON response' };
  }
};

/**
 * Creates an AbortSignal with a built-in timeout, combined with an optional
 * external signal, plus cleanup for the timer and external listener.
 */
const createTimeoutSignal = (options: {
  outerSignal?: AbortSignal;
  timeoutMs?: number;
}): { signal: AbortSignal; cleanup: () => void } => {
  const { outerSignal, timeoutMs = TEST_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let onOuterAbort: (() => void) | undefined;

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (outerSignal && onOuterAbort) {
      outerSignal.removeEventListener('abort', onOuterAbort);
    }
  };

  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort(outerSignal.reason);
    } else {
      onOuterAbort = () => {
        controller.abort(outerSignal.reason);
      };
      outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }

  return { signal: controller.signal, cleanup };
};

/**
 * Normalizes an error into a user-readable message, excluding secrets.
 */
const normalizeError = (err: unknown): string => {
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') {
      return 'Connection timed out';
    }
    if (err.name === 'TimeoutError') {
      return 'Connection timed out';
    }
    if (err.name === 'NotAllowedError') {
      return 'Network request blocked by browser policy';
    }
    if (err.name === 'NetworkError') {
      return 'Network request failed — connection refused';
    }
    return err.message;
  }
  if (err instanceof TypeError) {
    if (err.message.includes('fetch')) {
      return 'Network request failed — connection refused';
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
};
