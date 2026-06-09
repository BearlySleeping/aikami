// apps/frontend/pwa/src/lib/client/services/media/dev_text.test.ts
//
// Unit tests for DevTextService: SSE chunk accumulation, abort behavior,
// and provider/model injection in the fetch body.
//
// $state and $derived are polyfilled globally via test_preload.ts.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---------------------------------------------------------------------------
// Test types
// ---------------------------------------------------------------------------

type FetchCall = {
  url: string;
  options: RequestInit;
};

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock ReadableStream that yields the given SSE-formatted chunks.
 * Each chunk is a string already in SSE format (e.g. 'data: {"text":"Hello"}\n\n').
 */
const createMockSSEStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const encodedChunks = chunks.map((c) => encoder.encode(c));

  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < encodedChunks.length) {
        controller.enqueue(encodedChunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
};

/**
 * Sets up the global fetch mock with an SSE stream.
 */
const mockFetchWithSSE = (chunks: string[], callTracker: FetchCall[], status = 200): void => {
  globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
    callTracker.push({ url, options });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      body: createMockSSEStream(chunks),
      text: () => Promise.resolve('Error body'),
    } as Response);
  });
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DevTextService — C-077: SSE streaming & provider toggle', () => {
  let service: {
    output: string;
    isGenerating: boolean;
    provider: 'ollama' | 'openrouter';
    model: string;
    generate(options: { prompt: string }): Promise<void>;
    cancel(): void;
  };
  let fetchCalls: FetchCall[] = [];

  beforeEach(async () => {
    fetchCalls = [];

    // Mock $logger to avoid chain-loading issues
    mock.module('$logger', () => ({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        write: () => {},
      },
      __esModule: true,
    }));

    // Import fresh after setting up mocks
    const mod = await import('./dev_text.svelte.ts');
    const { DevTextService } = mod;
    // Use `new` directly in test context (the create() factory calls new internally)
    service = new DevTextService({ className: 'TestDevText' });
  });

  afterEach(() => {
    mock.restore();
  });

  // ── AC-1: SSE Chunk Accumulation ──────────────────────────────────────

  describe('AC-1: SSE chunk accumulation', () => {
    test('should accumulate text chunks from SSE stream', async () => {
      mockFetchWithSSE(
        ['data: {"text":"Hello "}\n\n', 'data: {"text":"World"}\n\n', 'data: [DONE]\n\n'],
        fetchCalls,
      );

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('Hello World');
    });

    test('should handle multi-line SSE chunks in a single read', async () => {
      mockFetchWithSSE(
        ['data: {"text":"A"}\n\ndata: {"text":"B"}\n\ndata: {"text":"C"}\n\n', 'data: [DONE]\n\n'],
        fetchCalls,
      );

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('ABC');
    });

    test('should handle partial chunk across reads (buffered line)', async () => {
      mockFetchWithSSE(
        [
          'data: {"text":"Par', // partial first chunk
          'tial"}\n\ndata: [DONE]\n\n', // remainder + DONE
        ],
        fetchCalls,
      );

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('Partial');
    });

    test('should skip non-SSE lines', async () => {
      mockFetchWithSSE(
        ['ignored line\n', 'data: {"text":"Keep"}\n\n', ':comment line\n', 'data: [DONE]\n\n'],
        fetchCalls,
      );

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('Keep');
    });

    test('should skip invalid JSON in data lines', async () => {
      mockFetchWithSSE(
        [
          'data: {"text":"Good"}\n\n',
          'data: not-json\n\n',
          'data: {"text":" Data"}\n\n',
          'data: [DONE]\n\n',
        ],
        fetchCalls,
      );

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('Good Data');
    });

    test('should handle stream with no [DONE] marker (reader finishes)', async () => {
      mockFetchWithSSE(['data: {"text":"Final"}\n\n'], fetchCalls);

      await service.generate({ prompt: 'test' });

      expect(service.output).toBe('Final');
    });

    test('should set isGenerating to true during generation and false after', async () => {
      mockFetchWithSSE(['data: {"text":"X"}\n\n', 'data: [DONE]\n\n'], fetchCalls);

      expect(service.isGenerating).toBe(false);

      const promise = service.generate({ prompt: 'test' });
      expect(service.isGenerating).toBe(true);

      await promise;
      expect(service.isGenerating).toBe(false);
    });
  });

  // ── AC-1: Abort Behavior ──────────────────────────────────────────────

  describe('AC-1: abort behavior', () => {
    test('cancel should set isGenerating to false', async () => {
      mockFetchWithSSE(['data: {"text":"X"}\n\n', 'data: [DONE]\n\n'], fetchCalls);

      // Start generation but don't await
      const promise = service.generate({ prompt: 'test' });

      // Immediately cancel
      service.cancel();
      expect(service.isGenerating).toBe(false);

      await promise;
      // After AbortError is caught, output should be empty (cleared at start)
    });

    test('cancel should not throw', () => {
      // Cancel when no generation is active
      expect(() => service.cancel()).not.toThrow();
      expect(service.isGenerating).toBe(false);
    });
  });

  // ── Reject empty prompt ───────────────────────────────────────────────

  test('should not generate when prompt is empty', async () => {
    mockFetchWithSSE(['data: {"text":"X"}\n\n'], fetchCalls);

    await service.generate({ prompt: '  ' });

    expect(fetchCalls.length).toBe(0);
    expect(service.isGenerating).toBe(false);
    expect(service.output).toBe('');
  });

  // ── Fetch errors ──────────────────────────────────────────────────────

  test('should set output to error message on non-OK response', async () => {
    mockFetchWithSSE([], fetchCalls, 500);

    await service.generate({ prompt: 'test' });

    expect(service.output).toContain('Error: 500');
  });

  test('should set output to error when no response body', async () => {
    globalThis.fetch = mock((url: string, options: RequestInit): Promise<Response> => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        text: () => Promise.resolve(''),
      } as Response);
    });

    await service.generate({ prompt: 'test' });

    expect(service.output).toBe('Error: No response body');
  });

  // ── AC-2: Provider Toggle & Request Payload ───────────────────────────

  describe('AC-2: provider toggle & request payload', () => {
    test('should send only prompt when provider is ollama (default)', async () => {
      mockFetchWithSSE(['data: [DONE]\n\n'], fetchCalls);

      await service.generate({ prompt: 'hello' });

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0].url).toBe('/api/text');
      expect(fetchCalls[0].options.method).toBe('POST');
      expect(fetchCalls[0].options.headers).toEqual({
        'Content-Type': 'application/json',
      });

      const body = JSON.parse(fetchCalls[0].options.body as string);
      expect(body).toEqual({ prompt: 'hello' });
    });

    test('should include provider and model when provider is openrouter', async () => {
      mockFetchWithSSE(['data: [DONE]\n\n'], fetchCalls);

      service.provider = 'openrouter';
      service.model = 'openrouter/auto';

      await service.generate({ prompt: 'hello' });

      expect(fetchCalls.length).toBe(1);
      const body = JSON.parse(fetchCalls[0].options.body as string);
      expect(body).toEqual({
        prompt: 'hello',
        provider: 'openrouter',
        model: 'openrouter/auto',
      });
    });

    test('should fallback to default model when model is empty and provider is openrouter', async () => {
      mockFetchWithSSE(['data: [DONE]\n\n'], fetchCalls);

      service.provider = 'openrouter';
      service.model = '';

      await service.generate({ prompt: 'hello' });

      const body = JSON.parse(fetchCalls[0].options.body as string);
      expect(body.model).toBe('liquid/lfm-2.5-1.2b-instruct:free');
    });
  });
});
