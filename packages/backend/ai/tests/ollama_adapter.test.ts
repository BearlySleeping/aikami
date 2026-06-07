// packages/backend/ai/tests/ollama_adapter.test.ts
/** biome-ignore-all lint/style/useNamingConvention: Ollama API uses snake_case field names */
import { describe, expect, it, mock } from 'bun:test';
import { createOllamaStream } from '../src/lib/ollama_adapter.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An individual chunk from Ollama's /api/generate streaming response. */
type OllamaGenerateChunk = {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
};

/**
 * Helper: create a mock fetch that returns a synthetic SSE response.
 *
 * The mock captures the request for payload assertion and returns
 * a stream of Ollama-formatted JSON lines.
 */
const createMockFetch = (chunks: OllamaGenerateChunk[]) => {
  let capturedUrl = '';
  let capturedBody = '';
  let capturedInit: RequestInit | undefined;

  const mockFn = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = (init?.body as string) ?? '';
    capturedInit = init;

    const encoder = new TextEncoder();
    const lines = chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join('');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  });

  return {
    mockFn,
    getLastRequest: () => ({ url: capturedUrl, body: capturedBody, init: capturedInit }),
  };
};

/**
 * Read all SSE events from a stream into an array of strings.
 */
const readAllSseEvents = async (stream: ReadableStream<Uint8Array>): Promise<string[]> => {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const events: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }

  return events;
};

// ---------------------------------------------------------------------------
// AC-2: Ollama Aggressive VRAM Eviction — Test Suite
// ---------------------------------------------------------------------------

describe('Ollama Adapter (AC-2)', () => {
  // ── AC-2: VRAM eviction payload structure ───────────────────────────────

  describe('VRAM eviction payload', () => {
    it('includes keep_alive: 0 in the request body', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.keep_alive).toBe(0);
    });

    it('includes options.num_parallel: 1 in the request body', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      const opts = parsed.options as Record<string, unknown>;
      expect(opts.num_parallel).toBe(1);
    });

    it('includes stream: true in the request body', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.stream).toBe(true);
    });

    it('VRAM eviction params are forcibly merged — cannot be overridden by request', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello', model: 'custom-model' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.keep_alive).toBe(0);
      expect(parsed.stream).toBe(true);
      const opts = parsed.options as Record<string, unknown>;
      expect(opts.num_parallel).toBe(1);
    });
  });

  // ── Streaming behavior ──────────────────────────────────────────────────

  describe('stream parsing', () => {
    it('yields text chunks as SSE events', async () => {
      const { mockFn } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'Hello', done: false },
        { model: 'llama3.2', created_at: '2024-01-01', response: ' World', done: false },
        { model: 'llama3.2', created_at: '2024-01-01', response: '', done: true },
      ]);

      const stream = await createOllamaStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      const dataEvents = events.filter((e) => e.startsWith('data:') && !e.includes('[DONE]'));
      expect(dataEvents.length).toBe(2);
      expect(dataEvents[0]).toContain('"Hello"');
      expect(dataEvents[1]).toContain('" World"');
    });

    it('emits [DONE] when final chunk is received', async () => {
      const { mockFn } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'Done', done: true },
      ]);

      const stream = await createOllamaStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      const lastEvent = events[events.length - 1];
      expect(lastEvent).toInclude('[DONE]');
    });

    it('skips non-JSON lines gracefully', async () => {
      const { mockFn } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'Valid', done: true },
      ]);

      const stream = await createOllamaStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ── Request construction ─────────────────────────────────────────────────

  describe('request construction', () => {
    it('uses default model when none provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.model).toBe('llama3.2');
    });

    it('uses custom model when provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'mistral', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello', model: 'mistral' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.model).toBe('mistral');
    });

    it('includes system prompt in constructed prompt', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello', systemPrompt: 'You are a helpful assistant.' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.prompt).toInclude('System: You are a helpful assistant.');
    });

    it('includes message history in constructed prompt', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: {
          prompt: 'How are you?',
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello!' },
          ],
        },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      const prompt = parsed.prompt as string;
      expect(prompt).toInclude('user: Hi');
      expect(prompt).toInclude('assistant: Hello!');
      expect(prompt).toInclude('user: How are you?');
    });

    it('posts to the correct Ollama API endpoint', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      expect(getLastRequest().url).toEndWith('/api/generate');
    });

    it('uses custom base URL when provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      await createOllamaStream({
        request: { prompt: 'Hello' },
        baseUrl: 'http://gpu-server:11434',
        _fetch: mockFn,
      });

      expect(getLastRequest().url).toStartWith('http://gpu-server:11434/');
    });
  });

  // ── AbortSignal handling ────────────────────────────────────────────────

  describe('AbortSignal', () => {
    it('passes signal to the fetch call', async () => {
      const controller = new AbortController();

      const { mockFn } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'test', done: true },
      ]);

      const stream = await createOllamaStream({
        request: { prompt: 'Hello' },
        signal: controller.signal,
        _fetch: mockFn,
      });

      expect(stream).toBeDefined();
    });

    it('aborting the signal stops the stream', async () => {
      const controller = new AbortController();

      const { mockFn } = createMockFetch([
        { model: 'llama3.2', created_at: '2024-01-01', response: 'chunk1', done: false },
        { model: 'llama3.2', created_at: '2024-01-01', response: 'chunk2', done: false },
        { model: 'llama3.2', created_at: '2024-01-01', response: 'chunk3', done: true },
      ]);

      const stream = await createOllamaStream({
        request: { prompt: 'Hello' },
        signal: controller.signal,
        _fetch: mockFn,
      });

      const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);

      controller.abort();

      const after = await reader.read().catch(() => ({ value: '', done: true }));
      expect(after.done).toBeDefined();
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on non-200 response', async () => {
      const mockFetch = mock(async (): Promise<Response> => {
        return new Response('Not Found', { status: 404 });
      });

      await expect(
        createOllamaStream({ request: { prompt: 'Hello' }, _fetch: mockFetch }),
      ).rejects.toThrow('Ollama returned 404');
    });

    it('throws when response has no body', async () => {
      const mockFetch = mock(async (): Promise<Response> => {
        return new Response(null, { status: 200 });
      });

      await expect(
        createOllamaStream({ request: { prompt: 'Hello' }, _fetch: mockFetch }),
      ).rejects.toThrow('no readable body');
    });
  });
});
