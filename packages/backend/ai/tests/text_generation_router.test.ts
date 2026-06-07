// packages/backend/ai/tests/text_generation_router.test.ts
import { describe, expect, it } from 'bun:test';
import { routeTextGeneration } from '../src/lib/text_generation_router.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock stream that yields a single SSE event and closes.
 */
const createMockStream = (text: string): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"text":"${text}"}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
};

// ---------------------------------------------------------------------------
// AC-1: Provider Routing Configuration — Test Suite
// ---------------------------------------------------------------------------

describe('Provider Router (AC-1)', () => {
  // ── AC-1: Routing based on config ───────────────────────────────────────

  describe('provider routing', () => {
    it('routes to OpenRouter when config.provider is openrouter', async () => {
      let routedTo = '';

      const stream = await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'openrouter' },
        _openRouterFn: async () => {
          routedTo = 'openrouter';
          return createMockStream('from openrouter');
        },
        _ollamaFn: async () => {
          routedTo = 'ollama';
          return createMockStream('from ollama');
        },
      });

      expect(routedTo).toBe('openrouter');
      expect(stream).toBeDefined();
    });

    it('routes to Ollama when config.provider is ollama', async () => {
      let routedTo = '';

      const stream = await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'ollama' },
        _openRouterFn: async () => {
          routedTo = 'openrouter';
          return createMockStream('from openrouter');
        },
        _ollamaFn: async () => {
          routedTo = 'ollama';
          return createMockStream('from ollama');
        },
      });

      expect(routedTo).toBe('ollama');
      expect(stream).toBeDefined();
    });

    it('request.provider overrides config.provider', async () => {
      let routedTo = '';

      const stream = await routeTextGeneration({
        request: { prompt: 'Hello', provider: 'ollama' },
        config: { provider: 'openrouter' },
        _openRouterFn: async () => {
          routedTo = 'openrouter';
          return createMockStream('from openrouter');
        },
        _ollamaFn: async () => {
          routedTo = 'ollama';
          return createMockStream('from ollama');
        },
      });

      expect(routedTo).toBe('ollama');
      expect(stream).toBeDefined();
    });
  });

  // ── OpenRouter → Ollama fallback ────────────────────────────────────────

  describe('fallback behavior', () => {
    it('falls back to Ollama when OpenRouter fails', async () => {
      let routedTo = '';

      const stream = await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'openrouter' },
        _openRouterFn: async () => {
          throw new Error('OpenRouter down');
        },
        _ollamaFn: async () => {
          routedTo = 'ollama';
          return createMockStream('from fallback ollama');
        },
      });

      expect(routedTo).toBe('ollama');
      expect(stream).toBeDefined();
    });

    it('does not fallback when Ollama is the primary', async () => {
      let openRouterCalled = false;

      const stream = await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'ollama' },
        _openRouterFn: async () => {
          openRouterCalled = true;
          return createMockStream('should not reach');
        },
        _ollamaFn: async () => {
          return createMockStream('from ollama directly');
        },
      });

      expect(openRouterCalled).toBe(false);
      expect(stream).toBeDefined();
    });
  });

  // ── AbortSignal passthrough ─────────────────────────────────────────────

  describe('signal passthrough', () => {
    it('passes signal to the adapter', async () => {
      const controller = new AbortController();
      let signalReceived: AbortSignal | undefined;

      await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'ollama' },
        signal: controller.signal,
        _ollamaFn: async (_req, _cfg, signal) => {
          signalReceived = signal;
          return createMockStream('test');
        },
      });

      expect(signalReceived).toBe(controller.signal);
    });
  });

  // ── Stream integrity ────────────────────────────────────────────────────

  describe('stream output', () => {
    it('returns a valid ReadableStream', async () => {
      const stream = await routeTextGeneration({
        request: { prompt: 'Hello' },
        config: { provider: 'ollama' },
        _ollamaFn: async () => createMockStream('working'),
      });

      const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
      const { value } = await reader.read();
      expect(value).toContain('working');
    });
  });
});
