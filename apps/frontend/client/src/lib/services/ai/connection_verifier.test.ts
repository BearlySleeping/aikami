// apps/frontend/client/src/lib/services/ai/connection_verifier.test.ts
//
// P02 — Connection verifier unit tests.
//
// Tests cover:
//   - Keyless Ollama with configured base URL
//   - Keyless OpenAI-compatible with configured base URL
//   - Authenticated local provider (token preserved)
//   - Cloud provider regression (existing key validation)
//   - Two distinct instances with the same registry ID use their own URLs
//   - Connection refusal, malformed JSON, SPA HTML, timeout, abort
//   - Unsupported probe protocol
//   - Keys excluded from diagnostic output

import { describe, expect, mock, test } from 'bun:test';
import { type FetchTransport, verifyConnection } from './connection_verifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock fetch that returns a canned Response. */
const mockFetch = (response: Response): FetchTransport =>
  mock(async (_url: string | URL, _init: RequestInit) => response);

/** Creates a mock fetch that rejects with a given error. */
const mockFetchError = (error: unknown): FetchTransport =>
  mock(async (_url: string | URL, _init: RequestInit) => {
    throw error;
  });

/** Creates a JSON response. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Creates an HTML response (SPA fallback). */
const htmlResponse = (status = 200): Response =>
  new Response('<!DOCTYPE html><html><body>Not an API</body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });

/** Creates a non-JSON response. */
const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ollamaProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-1',
  registryId: 'ollama',
  label: 'Ollama (local)',
  credential: undefined,
  baseUrl: 'http://localhost:11434',
  source: 'stored' as const,
  ...overrides,
});

const llamacppProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-2',
  registryId: 'llamacpp',
  label: 'llama.cpp (local)',
  credential: undefined,
  baseUrl: 'http://localhost:8080',
  source: 'stored' as const,
  ...overrides,
});

const customProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-3',
  registryId: 'custom',
  label: 'Custom API',
  credential: undefined,
  baseUrl: 'http://192.168.1.100:8000',
  source: 'stored' as const,
  ...overrides,
});

const authenticatedLocalProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-4',
  registryId: 'custom',
  label: 'Custom API (auth)',
  credential: 'sk-test-token',
  baseUrl: 'https://192.168.1.101:8000',
  source: 'stored' as const,
  ...overrides,
});

const openrouterProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-5',
  registryId: 'openrouter',
  label: 'OpenRouter',
  credential: 'sk-or-v1-test-key',
  baseUrl: undefined,
  source: 'stored' as const,
  ...overrides,
});

const unsupportedProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-6',
  registryId: 'nonexistent',
  label: 'Unknown',
  credential: undefined,
  baseUrl: undefined,
  source: 'stored' as const,
  ...overrides,
});

const imageProvider = (overrides?: Record<string, unknown>) => ({
  id: 'prov-7',
  registryId: 'openai-compat',
  label: 'OpenAI Compatible',
  credential: undefined,
  baseUrl: 'http://localhost:7860',
  source: 'stored' as const,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyConnection — Ollama (keyless)', () => {
  test('probes at configured base URL with /api/tags and returns ok', async () => {
    const fetchFn = mockFetch(
      jsonResponse({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] }),
    );
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    // Verify the correct URL was called
    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/api/tags');
  });

  test('uses baseUrl override when provided', async () => {
    const fetchFn = mockFetch(jsonResponse({ models: [] }));
    await verifyConnection(
      { provider: ollamaProvider(), baseUrl: 'http://192.168.1.50:11434' },
      fetchFn,
    );

    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://192.168.1.50:11434/api/tags');
  });

  test('no API key is sent', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock(async (_url: string | URL, init: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ models: [] });
    });
    await verifyConnection({ provider: ollamaProvider() }, fetchFn);

    // No Authorization header should be present
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  test('returns error when no base URL is configured', async () => {
    const result = await verifyConnection({ provider: ollamaProvider({ baseUrl: undefined }) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No endpoint configured');
  });

  test('returns error on HTTP error status', async () => {
    const fetchFn = mockFetch(new Response(null, { status: 502 }));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 502');
  });

  test('returns error on malformed JSON', async () => {
    const fetchFn = mockFetch(textResponse('not json'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid JSON response');
  });

  test('returns error on SPA HTML response', async () => {
    const fetchFn = mockFetch(htmlResponse());
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTML instead of JSON');
  });

  test('returns error on unexpected response shape', async () => {
    const fetchFn = mockFetch(jsonResponse({ data: [{ id: 'model-1' }] }));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expected { models:');
  });

  test('returns error on connection refused (TypeError)', async () => {
    const fetchFn = mockFetchError(new TypeError('fetch failed'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });

  test('returns error on timeout (AbortError)', async () => {
    const fetchFn = mockFetchError(new DOMException('The operation was aborted', 'AbortError'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });

  test('returns error on abort via external signal', async () => {
    const controller = new AbortController();
    const fetchFn = mock(async (_url: string | URL, init: RequestInit) => {
      // Simulate the signal being aborted
      controller.abort();
      if (init.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return jsonResponse({ models: [] });
    });
    const result = await verifyConnection(
      { provider: ollamaProvider(), signal: controller.signal },
      fetchFn,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });
});

describe('verifyConnection — OpenAI-compatible (keyless)', () => {
  test('probes at configured base URL with /v1/models and validates shape', async () => {
    const fetchFn = mockFetch(
      jsonResponse({ object: 'list', data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }] }),
    );
    const result = await verifyConnection({ provider: llamacppProvider() }, fetchFn);

    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(2);

    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8080/v1/models');
  });

  test('strips trailing /v1 from base URL to avoid double /v1', async () => {
    const fetchFn = mockFetch(jsonResponse({ object: 'list', data: [] }));
    const provider = llamacppProvider({ baseUrl: 'http://localhost:8080/v1' });
    await verifyConnection({ provider }, fetchFn);

    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8080/v1/models');
  });

  test('strips trailing slash from base URL', async () => {
    const fetchFn = mockFetch(jsonResponse({ object: 'list', data: [] }));
    const provider = llamacppProvider({ baseUrl: 'http://localhost:8080/' });
    await verifyConnection({ provider }, fetchFn);

    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8080/v1/models');
  });

  test('no API key sent for keyless provider', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock(async (_url: string | URL, init: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ object: 'list', data: [] });
    });
    await verifyConnection({ provider: llamacppProvider() }, fetchFn);

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers).toBeUndefined();
  });

  test('sends Bearer token when provider has credential', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock(async (_url: string | URL, init: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ object: 'list', data: [] });
    });
    await verifyConnection({ provider: authenticatedLocalProvider() }, fetchFn);

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer sk-test-token');
  });

  test('rejects credentials over HTTP without sending a request', async () => {
    const fetchFn = mockFetch(jsonResponse({ object: 'list', data: [] }));
    const provider = authenticatedLocalProvider({ baseUrl: 'http://192.168.1.101:8000' });

    const result = await verifyConnection({ provider }, fetchFn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Credentials require an HTTPS endpoint');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('returns error on invalid response shape', async () => {
    const fetchFn = mockFetch(jsonResponse({ models: [] }));
    const result = await verifyConnection({ provider: customProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expected { object: "list"');
  });

  test('returns error on SPA HTML response', async () => {
    const fetchFn = mockFetch(htmlResponse());
    const result = await verifyConnection({ provider: customProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTML instead of JSON');
  });

  test('works with custom provider (registryId=custom)', async () => {
    const fetchFn = mockFetch(jsonResponse({ object: 'list', data: [] }));
    const result = await verifyConnection({ provider: customProvider() }, fetchFn);
    expect(result.ok).toBe(true);
  });

  test('works with openai-compat image provider', async () => {
    const fetchFn = mockFetch(jsonResponse({ object: 'list', data: [] }));
    const result = await verifyConnection({ provider: imageProvider() }, fetchFn);
    expect(result.ok).toBe(true);

    const [url] = (fetchFn as ReturnType<typeof mock>).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:7860/v1/models');
  });
});

describe('verifyConnection — distinct instances with same registry ID', () => {
  test('each instance uses its own base URL', async () => {
    const instance1 = ollamaProvider({ id: 'prov-a', baseUrl: 'http://10.0.0.1:11434' });
    const instance2 = ollamaProvider({ id: 'prov-b', baseUrl: 'http://10.0.0.2:11434' });

    const fetchFn1 = mockFetch(jsonResponse({ models: [] }));
    const fetchFn2 = mockFetch(jsonResponse({ models: [] }));

    await verifyConnection({ provider: instance1 }, fetchFn1);
    await verifyConnection({ provider: instance2 }, fetchFn2);

    const [url1] = (fetchFn1 as ReturnType<typeof mock>).mock.calls[0] ?? [];
    const [url2] = (fetchFn2 as ReturnType<typeof mock>).mock.calls[0] ?? [];

    expect(url1).toBe('http://10.0.0.1:11434/api/tags');
    expect(url2).toBe('http://10.0.0.2:11434/api/tags');
    expect(url1).not.toBe(url2);
  });

  test('each instance uses its own authentication', async () => {
    const instance1 = authenticatedLocalProvider({ id: 'prov-a', credential: 'token-a' });
    const instance2 = authenticatedLocalProvider({ id: 'prov-b', credential: 'token-b' });

    const captured: RequestInit[] = [];
    const captureFetch: FetchTransport = async (_url, init) => {
      captured.push(init);
      return jsonResponse({ object: 'list', data: [] });
    };

    await verifyConnection({ provider: instance1 }, captureFetch);
    await verifyConnection({ provider: instance2 }, captureFetch);

    const h1 = captured[0]?.headers as Record<string, string> | undefined;
    const h2 = captured[1]?.headers as Record<string, string> | undefined;

    expect(h1?.Authorization).toBe('Bearer token-a');
    expect(h2?.Authorization).toBe('Bearer token-b');
  });
});

describe('verifyConnection — cloud providers (regression)', () => {
  test('OpenRouter with valid key returns ok', async () => {
    const fetchFn = mockFetch(jsonResponse({ data: [{ id: 'model-1' }] }));
    const result = await verifyConnection({ provider: openrouterProvider() }, fetchFn);
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(1);
  });

  test('OpenRouter returns error when credential is missing', async () => {
    const result = await verifyConnection({
      provider: openrouterProvider({ credential: undefined }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('No API key configured');
  });

  test('OpenRouter returns error on HTTP 401', async () => {
    const fetchFn = mockFetch(new Response(null, { status: 401 }));
    const result = await verifyConnection({ provider: openrouterProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HTTP 401');
  });

  test('builds correct OpenRouter verify URL and headers', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchFn = mock(async (url: string | URL, init: RequestInit) => {
      capturedUrl = url.toString();
      capturedInit = init;
      return jsonResponse({ data: [] });
    });

    await verifyConnection({ provider: openrouterProvider() }, fetchFn);

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/auth/key');
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer sk-or-v1-test-key');
  });
});

describe('verifyConnection — error handling', () => {
  test('connection refusal (TypeError: fetch failed)', async () => {
    const fetchFn = mockFetchError(new TypeError('fetch failed'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });

  test('browser policy block (NotAllowedError)', async () => {
    const fetchFn = mockFetchError(new DOMException('Permission denied', 'NotAllowedError'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('browser policy');
  });

  test('network error', async () => {
    const fetchFn = mockFetchError(new DOMException('Network error', 'NetworkError'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection refused');
  });

  test('non-DOM Error is preserved', async () => {
    const fetchFn = mockFetchError(new Error('Something went wrong'));
    const result = await verifyConnection({ provider: ollamaProvider() }, fetchFn);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Something went wrong');
  });

  test('keys are never included in diagnostic output', async () => {
    // Simulate an auth error — the error message should not leak the key
    const fetchFn = mockFetch(
      new Response(null, { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );
    const provider = openrouterProvider({ credential: 'sk-or-v1-super-secret-key' });
    const result = await verifyConnection({ provider }, fetchFn);

    // The error message should not contain the key
    expect(result.error).not.toContain('sk-or-v1-super-secret-key');
    expect(result.error).not.toContain('secret');
  });

  test('unsupported provider returns unsupported error', async () => {
    const result = await verifyConnection({ provider: unsupportedProvider() });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection verification not supported for this provider');
  });
});

describe('verifyConnection — timeout and cancellation', () => {
  test('external signal can cancel the request', async () => {
    const controller = new AbortController();
    const fetchFn = mock(async (_url: string | URL, init: RequestInit) => {
      // Simulate abort by the caller
      controller.abort();
      if (init.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return jsonResponse({ models: [] });
    });

    const promise = verifyConnection(
      { provider: ollamaProvider(), signal: controller.signal },
      fetchFn,
    );
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });

  test('has bounded latency (no infinite hang)', async () => {
    const fetchFn: FetchTransport = mock(
      (_url: string | URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) {
            reject(new Error('Expected timeout signal'));
            return;
          }
          const rejectOnAbort = () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          };
          if (signal.aborted) {
            rejectOnAbort();
            return;
          }
          signal.addEventListener('abort', rejectOnAbort, { once: true });
        }),
    );

    const result = await verifyConnection({ provider: ollamaProvider(), timeoutMs: 10 }, fetchFn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });
});
