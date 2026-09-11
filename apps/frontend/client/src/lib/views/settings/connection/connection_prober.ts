// apps/frontend/client/src/lib/views/settings/connection/connection_prober.ts
//
// Transport/probe helpers for the Connection Manager. Pure async functions —
// no state, no runes, no service singletons. The ViewModel owns editor/draft
// state and delegates every network probe here, so the transport concerns
// (timeouts, abort handling, response-shape parsing) live in one place.

import { buildVerifyHeaders, buildVerifyUrl, PROVIDER_ENDPOINTS } from '@aikami/constants';
import type { Connection, ConnectionTestResult } from '$types';

const TEST_TIMEOUT_MS = 15_000;

/** Live local-provider (Ollama) status shown in the editor. */
export type LocalProviderStatus = {
  checking: boolean;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  modelCount?: number;
};

const _elapsed = (startMs: number): number => Math.round(performance.now() - startMs);

const _errorMessage = (error: unknown): string =>
  error instanceof DOMException && error.name === 'AbortError'
    ? 'Connection timed out'
    : String(error);

/** Runs `run` with an abort timeout, always clearing the timer. */
const _withTimeout = async <Result>(
  run: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

/** Extracts a model count from an OpenAI-compatible or Ollama response body. */
const _modelCountFrom = async (response: Response): Promise<number | undefined> => {
  try {
    const data = (await response.clone().json()) as Record<string, unknown>;
    if (Array.isArray(data.data)) {
      return data.data.length;
    }
    if (Array.isArray(data.models)) {
      return data.models.length;
    }
  } catch {
    /* not JSON */
  }
  return undefined;
};

/** Probes a saved connection (Ollama native or a cloud endpoint). */
export const probeSavedConnection = async (options: {
  connection: Connection;
  ollamaUrl: string | undefined;
}): Promise<ConnectionTestResult> => {
  const { connection, ollamaUrl } = options;
  const startMs = performance.now();

  if (connection.provider === 'ollama') {
    if (!ollamaUrl) {
      return { ok: false, latencyMs: 0, error: 'No Ollama endpoint configured' };
    }
    const url = ollamaUrl;
    return _withTimeout(async (signal) => {
      try {
        const response = await fetch(url, { signal });
        const latencyMs = _elapsed(startMs);
        if (!response.ok) {
          return { ok: false, latencyMs, error: `HTTP ${response.status}` };
        }
        const data = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
        return { ok: true, latencyMs, modelCount };
      } catch (err) {
        return { ok: false, latencyMs: _elapsed(startMs), error: _errorMessage(err) };
      }
    });
  }

  const endpoint = PROVIDER_ENDPOINTS[connection.provider];
  if (!endpoint) {
    return {
      ok: false,
      latencyMs: _elapsed(startMs),
      error: `Unknown provider: ${connection.provider}`,
    };
  }
  if (!connection.apiKey) {
    return { ok: false, latencyMs: _elapsed(startMs), error: 'No API key configured' };
  }

  const apiKey = connection.apiKey;
  return _withTimeout(async (signal) => {
    try {
      const url = buildVerifyUrl({ endpoint, apiKey });
      const headers = buildVerifyHeaders({ endpoint, apiKey });
      const response = await fetch(url, { headers, method: endpoint.method, signal });
      const latencyMs = _elapsed(startMs);
      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}` };
      }
      const modelCount = await _modelCountFrom(response);
      return { ok: true, latencyMs, modelCount };
    } catch (err) {
      return { ok: false, latencyMs: _elapsed(startMs), error: _errorMessage(err) };
    }
  });
};

/** Probes the unsaved editor draft (Ollama native or a cloud endpoint). */
export const probeDraftConnection = async (options: {
  draft: Partial<Connection>;
  ollamaUrl: string | undefined;
}): Promise<ConnectionTestResult> => {
  const provider = options.draft.provider ?? 'openrouter';
  const startMs = performance.now();

  if (provider === 'ollama') {
    const ollamaUrl = options.ollamaUrl;
    if (!ollamaUrl) {
      return {
        ok: false,
        latencyMs: 0,
        error: 'No Ollama endpoint configured — set text.url in config.json',
      };
    }
    return _withTimeout(async (signal) => {
      try {
        const response = await fetch(ollamaUrl, { signal });
        const latencyMs = _elapsed(startMs);
        if (!response.ok) {
          return { ok: false, latencyMs, error: `HTTP ${response.status}` };
        }
        const data = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
        return { ok: true, latencyMs, modelCount };
      } catch (err) {
        return { ok: false, latencyMs: _elapsed(startMs), error: _errorMessage(err) };
      }
    });
  }

  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    return { ok: false, latencyMs: _elapsed(startMs), error: `Unknown provider: ${provider}` };
  }
  const apiKey = options.draft.apiKey;
  if (!apiKey) {
    return { ok: false, latencyMs: _elapsed(startMs), error: 'No API key configured' };
  }

  return _withTimeout(async (signal) => {
    try {
      const url = buildVerifyUrl({ endpoint, apiKey });
      const headers = buildVerifyHeaders({ endpoint, apiKey });
      const response = await fetch(url, { headers, method: endpoint.method, signal });
      const latencyMs = _elapsed(startMs);
      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}` };
      }
      const modelCount = await _modelCountFrom(response);
      return { ok: true, latencyMs, modelCount };
    } catch (err) {
      return { ok: false, latencyMs: _elapsed(startMs), error: _errorMessage(err) };
    }
  });
};

/** Probes the configured Ollama runtime endpoint for the local setup guide. */
export const probeOllamaRuntime = async (options: {
  ollamaUrl: string | undefined;
}): Promise<LocalProviderStatus> => {
  const ollamaUrl = options.ollamaUrl;
  if (!ollamaUrl) {
    return {
      checking: false,
      ok: false,
      error: 'No Ollama endpoint configured — set text.url in config.json',
    };
  }
  const startMs = performance.now();
  return _withTimeout(async (signal) => {
    try {
      const response = await fetch(ollamaUrl, { signal });
      const latencyMs = _elapsed(startMs);
      if (response.ok) {
        const data = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
        return { checking: false, ok: true, latencyMs, modelCount };
      }
      return { checking: false, ok: false, latencyMs, error: `HTTP ${response.status}` };
    } catch (err) {
      return {
        checking: false,
        ok: false,
        latencyMs: _elapsed(startMs),
        error: _errorMessage(err),
      };
    }
  });
};
