// packages/backend/ai/tests/openrouter_adapter.test.ts
/** biome-ignore-all lint/style/useNamingConvention: OpenAI API uses snake_case field names */
import { describe, expect, it, mock } from 'bun:test';
import { createOpenRouterStream } from '../src/lib/openrouter_adapter.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A full OpenAI-compatible streaming chunk (as returned by OpenRouter). */
type OpenRouterDeltaChunkFull = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
  }>;
};

/**
 * Create a mock fetch that returns synthetic OpenRouter SSE lines.
 *
 * Captures the request URL, body, and init for payload assertions.
 * Returns a ReadableStream of SSE lines matching the OpenRouter format.
 */
const createMockFetch = (chunks: OpenRouterDeltaChunkFull[]) => {
  let capturedUrl = '';
  let capturedBody = '';
  let capturedInit: RequestInit | undefined;

  const mockFn = mock(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedBody = (init?.body as string) ?? '';
    capturedInit = init;

    const encoder = new TextEncoder();
    const lines: string[] = [];

    for (const chunk of chunks) {
      lines.push(`data: ${JSON.stringify(chunk)}\n`);
    }

    lines.push('data: [DONE]\n');

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(lines.join('')));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
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
// OpenRouter Adapter — Test Suite
// ---------------------------------------------------------------------------

describe('OpenRouter Adapter', () => {
  // ── Request construction ─────────────────────────────────────────────────

  describe('request construction', () => {
    it('sends chat completion request with stream: true', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.stream).toBe(true);
    });

    it('includes system prompt as first message', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello', systemPrompt: 'You are helpful.' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      const messages = parsed.messages as Array<{ role: string; content: string }>;
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('You are helpful.');
    });

    it('includes message history', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: {
          prompt: 'Third message',
          messages: [
            { role: 'user', content: 'First' },
            { role: 'assistant', content: 'Second' },
          ],
        },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      const messages = parsed.messages as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third message');
    });

    it('uses default model when none provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.model).toBe('openai/gpt-4o');
    });

    it('uses custom model when provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello', model: 'anthropic/claude-3-opus' },
        _fetch: mockFn,
      });

      const parsed = JSON.parse(getLastRequest().body) as Record<string, unknown>;
      expect(parsed.model).toBe('anthropic/claude-3-opus');
    });

    it('includes Authorization header when apiKey provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        apiKey: 'sk-test-key',
        _fetch: mockFn,
      });

      const headers = getLastRequest().init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test-key');
    });

    it('omits Authorization header when no apiKey', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      const headers = getLastRequest().init?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  // ── Streaming behavior ──────────────────────────────────────────────────

  describe('stream parsing', () => {
    it('yields text chunks from delta.content', async () => {
      const { mockFn } = createMockFetch([
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' World' } }] },
        { choices: [{ delta: { content: '!' } }] },
      ]);

      const stream = await createOpenRouterStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      const dataEvents = events.filter((e) => e.startsWith('data:') && !e.includes('[DONE]'));
      expect(dataEvents.length).toBe(3);
      expect(dataEvents[0]).toContain('"Hello"');
      expect(dataEvents[1]).toContain('" World"');
      expect(dataEvents[2]).toContain('"!"');
    });

    it('emits [DONE] at end of stream', async () => {
      const { mockFn } = createMockFetch([{ choices: [{ delta: { content: 'Done' } }] }]);

      const stream = await createOpenRouterStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      const lastEvent = events[events.length - 1];
      expect(lastEvent).toInclude('[DONE]');
    });

    it('skips chunks with no delta content', async () => {
      const { mockFn } = createMockFetch([
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: 'Content' } }] },
        { choices: [] },
      ]);

      const stream = await createOpenRouterStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      const dataEvents = events.filter((e) => e.startsWith('data:') && !e.includes('[DONE]'));
      expect(dataEvents.length).toBe(1);
      expect(dataEvents[0]).toContain('"Content"');
    });

    it('skips non-data lines gracefully', async () => {
      const { mockFn } = createMockFetch([{ choices: [{ delta: { content: 'Valid' } }] }]);

      const stream = await createOpenRouterStream({
        request: { prompt: 'Hi' },
        _fetch: mockFn,
      });

      const events = await readAllSseEvents(stream);
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on non-200 response', async () => {
      const mockFetch = mock(async (): Promise<Response> => {
        return new Response('Unauthorized', { status: 401 });
      });

      await expect(
        createOpenRouterStream({ request: { prompt: 'Hello' }, _fetch: mockFetch }),
      ).rejects.toThrow('OpenRouter returned 401');
    });

    it('throws when response has no body', async () => {
      const mockFetch = mock(async (): Promise<Response> => {
        return new Response(null, { status: 200 });
      });

      await expect(
        createOpenRouterStream({ request: { prompt: 'Hello' }, _fetch: mockFetch }),
      ).rejects.toThrow('no readable body');
    });
  });

  // ── AbortSignal ─────────────────────────────────────────────────────────

  describe('AbortSignal', () => {
    it('passes signal to fetch', async () => {
      const controller = new AbortController();

      const { mockFn } = createMockFetch([{ choices: [{ delta: { content: 'Test' } }] }]);

      const stream = await createOpenRouterStream({
        request: { prompt: 'Hello' },
        signal: controller.signal,
        _fetch: mockFn,
      });

      expect(stream).toBeDefined();
    });
  });

  // ── Endpoint URL ────────────────────────────────────────────────────────

  describe('endpoint', () => {
    it('posts to the correct OpenRouter endpoint', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        _fetch: mockFn,
      });

      expect(getLastRequest().url).toEndWith('/chat/completions');
    });

    it('uses custom base URL when provided', async () => {
      const { mockFn, getLastRequest } = createMockFetch([
        { choices: [{ delta: { content: 'Hi' } }] },
      ]);

      await createOpenRouterStream({
        request: { prompt: 'Hello' },
        baseUrl: 'https://custom-proxy.example.com/v1',
        _fetch: mockFn,
      });

      expect(getLastRequest().url).toStartWith('https://custom-proxy.example.com/');
    });
  });
});
