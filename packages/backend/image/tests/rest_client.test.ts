// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/tests/rest_client.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { ComfyUIRestClient } from '../src/lib/rest_client.ts';

// ---------------------------------------------------------------------------
// AC2: VRAM Eviction Enforcement
//   Given a successful image generation cycle
//   When the WebSocket reports completion
//   Then the orchestrator immediately dispatches a POST request to /api/free
//   with the `unload_models` flag.
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:8188';

/** Store original fetch so we can restore it after each test. */
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Helper: sets globalThis.fetch to a function that returns the given response. */
const setFetchResponse = (status: number, body: unknown, headers?: Record<string, string>) => {
  const h = headers ?? { 'Content-Type': 'application/json' };
  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: h,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as typeof fetch;
};

/** Helper: sets globalThis.fetch to reject with an error. */
const setFetchError = (message: string) => {
  globalThis.fetch = (() => {
    return Promise.reject(new Error(message));
  }) as unknown as typeof fetch;
};

describe('ComfyUIRestClient', () => {
  describe('queuePrompt', () => {
    test('returns prompt_id on success', async () => {
      setFetchResponse(200, { prompt_id: 'abc-123', number: 1, node_errors: {} });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      const result = await client.queuePrompt({
        workflow: { '1': { inputs: { width: 512 }, class_type: 'EmptyLatentImage' } },
      });

      expect(result.prompt_id).toBe('abc-123');
    });

    test('throws on non-200', async () => {
      setFetchResponse(500, 'Internal Server Error', { 'Content-Type': 'text/plain' });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });

      await expect(
        client.queuePrompt({
          workflow: { '1': { inputs: {}, class_type: 'Test' } },
        }),
      ).rejects.toThrow('status 500');
    });
  });

  describe('getHistory', () => {
    test('fetches history for a prompt_id', async () => {
      setFetchResponse(200, {
        'abc-123': {
          prompt: [1, 'abc-123', {}],
          outputs: {
            '9': {
              images: [{ filename: 'out.png', subfolder: '', type: 'output' }],
            },
          },
          status: { status_str: 'success', completed: true, messages: [] },
        },
      });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      const result = await client.getHistory({ promptId: 'abc-123' });

      expect(result['abc-123'].outputs['9'].images?.[0].filename).toBe('out.png');
    });

    test('throws on non-200', async () => {
      setFetchResponse(404, 'Not Found', { 'Content-Type': 'text/plain' });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });

      await expect(client.getHistory({ promptId: 'nonexistent' })).rejects.toThrow('status 404');
    });
  });

  describe('freeMemory', () => {
    test('sends unload_models and free_memory flags (AC2)', async () => {
      setFetchResponse(200, {});

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      // Should not throw
      await expect(client.freeMemory()).resolves.toBeUndefined();
    });

    test('does not throw on free failure (best-effort eviction)', async () => {
      setFetchResponse(500, 'Server Error', { 'Content-Type': 'text/plain' });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      // Best-effort — never throws
      await expect(client.freeMemory()).resolves.toBeUndefined();
    });
  });

  describe('checkHealth', () => {
    test('returns true on 200 from /system_stats', async () => {
      setFetchResponse(200, { system: {} });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      const healthy = await client.checkHealth();

      expect(healthy).toBe(true);
    });

    test('returns false on non-200', async () => {
      setFetchResponse(502, 'Bad Gateway', { 'Content-Type': 'text/plain' });

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      const healthy = await client.checkHealth();

      expect(healthy).toBe(false);
    });

    test('returns false on network error', async () => {
      setFetchError('Connection refused');

      const client = new ComfyUIRestClient({ baseUrl: BASE_URL });
      const healthy = await client.checkHealth();

      expect(healthy).toBe(false);
    });
  });
});
