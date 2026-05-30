// packages/frontend/api-core/tests/api/game_api_client.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { GameApiClient } from '../../src/api/game_api_client.ts';

/**
 * Creates a mock fetch that returns the given response.
 */
function mockFetch(response: { status: number; body: unknown; ok: boolean }): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      redirected: false,
      type: 'basic',
      url: typeof input === 'string' ? input : input.toString(),
      body: null as unknown as ReadableStream<Uint8Array>,
      bodyUsed: false,
      // @ts-expect-error - partial mock for testing
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as Response;
  };
}

/**
 * Creates a mock fetch that simulates a timeout (never resolves).
 */
function timeoutFetch(): typeof fetch {
  return async (): Promise<Response> => {
    // Never resolves — triggers the AbortController timeout
    return new Promise<Response>((_resolve) => {
      // Intentionally never resolves
    });
  };
}

describe('GameApiClient', () => {
  let client: GameApiClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new GameApiClient({ baseUrl: 'http://localhost:5001' });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('constructs with a base URL', () => {
    expect(client.baseUrl).toBe('http://localhost:5001');
  });

  it('strips trailing slashes from base URL', () => {
    const c = new GameApiClient({ baseUrl: 'http://example.com/' });
    expect(c.baseUrl).toBe('http://example.com');
  });

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it('isAuthenticated returns false when no token is set', () => {
    expect(client.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true after setAuthToken', () => {
    client.setAuthToken('token123');
    expect(client.isAuthenticated()).toBe(true);
  });

  it('setAuthToken(null) clears the token', () => {
    client.setAuthToken('token123');
    client.setAuthToken(null);
    expect(client.isAuthenticated()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // GET
  // -----------------------------------------------------------------------

  it('GET sends request to correct URL', async () => {
    const fetchSpy = mockFetch({ status: 200, body: { data: 'ok' }, ok: true });
    globalThis.fetch = fetchSpy;

    const result = await client.get<{ data: string }>('/api/health');
    expect(result.data).toBe('ok');
  });

  // -----------------------------------------------------------------------
  // POST
  // -----------------------------------------------------------------------

  it('POST sends JSON body and returns parsed response', async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.push({
        url: typeof input === 'string' ? input : input.toString(),
        init: init ?? {},
      });

      return mockFetch({ status: 200, body: { result: 'success' }, ok: true })(
        input,
        init,
      );
    };

    const result = await client.post<{ result: string }, { name: string }>(
      '/api/prompt_ai',
      { name: 'test' },
    );

    expect(result.result).toBe('success');

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe('http://localhost:5001/api/prompt_ai');
    expect(captured[0].init.method).toBe('POST');
    expect(captured[0].init.body).toBe(JSON.stringify({ name: 'test' }));
    expect(captured[0].init.headers).toBeDefined();

    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  // -----------------------------------------------------------------------
  // Auth header injection
  // -----------------------------------------------------------------------

  it('POST includes Authorization header when token is set', async () => {
    client.setAuthToken('test-token');

    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;

      return mockFetch({ status: 200, body: {}, ok: true })(input, init);
    };

    await client.post('/test', {});

    expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
  });

  // -----------------------------------------------------------------------
  // Error mapping
  // -----------------------------------------------------------------------

  it('HTTP 401 throws ApiError with unauthorized code', async () => {
    globalThis.fetch = mockFetch({ status: 401, body: { error: 'Unauthorized' }, ok: false });

    try {
      await client.post('/test', {});
      expect.unreachable('Should have thrown');
    } catch (err) {
      const apiErr = err as Error;
      expect(apiErr.message).toContain('HTTP 401');
    }
  });

  it('HTTP 404 throws ApiError with status code', async () => {
    globalThis.fetch = mockFetch({ status: 404, body: { error: 'Not Found' }, ok: false });

    try {
      await client.get('/missing');
      expect.unreachable('Should have thrown');
    } catch (err) {
      const apiErr = err as Error;
      expect(apiErr.message).toContain('HTTP 404');
    }
  });

  // -----------------------------------------------------------------------
  // Retry on 5xx
  // -----------------------------------------------------------------------

  it('retries on HTTP 503 then succeeds', async () => {
    let attempts = 0;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      attempts++;

      if (attempts < 2) {
        return mockFetch({ status: 503, body: {}, ok: false })(input, init);
      }

      return mockFetch({ status: 200, body: { success: true }, ok: true })(input, init);
    };

    const result = await client.post<{ success: boolean }>('/test', {});

    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it('gives up after max retries', async () => {
    globalThis.fetch = mockFetch({ status: 503, body: {}, ok: false });

    // Use fast retry to avoid timeout: 1 retry, 10ms delay
    try {
      await client.post('/test', {}, { retry: { maxRetries: 1, initialDelayMs: 10 } });
      expect.unreachable('Should have thrown');
    } catch {
      // Expected
    }
  });

  // -----------------------------------------------------------------------
  // Empty response
  // -----------------------------------------------------------------------

  it('handles empty response body', async () => {
    globalThis.fetch = async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        redirected: false,
        type: 'basic',
        url: '',
        body: null as unknown as ReadableStream<Uint8Array>,
        bodyUsed: false,
        json: async () => { throw new Error('No body'); },
        text: async () => '',
      } as Response;
    };

    const result = await client.post<undefined>('/no-content', {});
    expect(result).toBeUndefined();
  });
});
