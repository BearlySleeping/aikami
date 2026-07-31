// packages/backend/ai/tests/ai-service.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { MockAiService } from '@aikami/mocks';
import type { AiServiceInterface } from '@aikami/types';
import Type from 'typebox';
import { Value } from 'typebox/value';

// ─── Zod schemas for extraction tests ────────────────────────────────────────

const PersonSchema = Type.Object({
  name: Type.String({ default: '' }),
  age: Type.Number({ default: 0 }),
  email: Type.String({ format: 'email', default: 'test@example.com' }),
});

const ProductSchema = Type.Object({
  id: Type.String({ default: '' }),
  title: Type.String({ default: '' }),
  price: Type.Number({ exclusiveMinimum: 0, default: 1 }),
  inStock: Type.Boolean({ default: false }),
});

// ─── Shared mock factory ────────────────────────────────────────────────────

const createMock = (): MockAiService => new MockAiService();

// ─── Contract tests (interface-driven, runs against MockAiService) ──────────

/**
 * Core contract test suite.
 *
 * These tests verify the {@link AiServiceInterface} contract using the
 * {@link MockAiService}. The same test patterns apply when run against
 * {@link OpenAiService} and {@link GeminiService} (integration-tagged).
 */
describe('AiServiceInterface contract (MockAiService)', () => {
  let service: AiServiceInterface;
  let mock: MockAiService;

  beforeEach(() => {
    mock = createMock();
    service = mock;
  });

  // ── Interface identity ──────────────────────────────────────────────────

  describe('interface identity', () => {
    it('has a name property', () => {
      expect(service.name).toBeString();
    });

    it('name is "mock"', () => {
      expect(service.name).toBe('mock');
    });
  });

  // ── generateChat ────────────────────────────────────────────────────────

  describe('generateChat', () => {
    it('returns default response when no seed matches', async () => {
      const response = await service.generateChat([{ role: 'user', content: 'random text' }]);

      expect(response).toBeObject();
      expect(response.text).toBeString();
    });

    it('returns seeded response for matching pattern', async () => {
      const seeded: ChatResponse = {
        text: 'Custom response',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
      mock.seedResponse('hello', seeded);

      const response = await service.generateChat([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello there!' },
      ]);

      expect(response.text).toBe('Custom response');
      expect(response.usage).toEqual(seeded.usage);
    });

    it('matches patterns case-insensitively', async () => {
      mock.seedResponse('HELLO', { text: 'matched' });

      const response = await service.generateChat([{ role: 'user', content: 'hello world' }]);

      expect(response.text).toBe('matched');
    });

    it('matches substring within user message', async () => {
      mock.seedResponse('help', { text: 'help response' });

      const response = await service.generateChat([
        { role: 'user', content: 'I need help with something' },
      ]);

      expect(response.text).toBe('help response');
    });

    it('does not match pattern in system message', async () => {
      mock.seedResponse('hello', { text: 'should not match' });

      const response = await service.generateChat([
        { role: 'system', content: 'You say hello to users.' },
        { role: 'user', content: 'How are you?' },
      ]);

      expect(response.text).toBe('Mock response');
    });

    it('returns default when no user message exists', async () => {
      const response = await service.generateChat([
        { role: 'system', content: 'System prompt only' },
      ]);

      expect(response.text).toBe('Mock response');
    });

    it('tracks empty messages array gracefully', async () => {
      const response = await service.generateChat([]);
      expect(response.text).toBe('Mock response');
    });
  });

  // ── generateCompletion ──────────────────────────────────────────────────

  describe('generateCompletion', () => {
    it('returns the default response text', async () => {
      const result = await service.generateCompletion('Write a haiku');

      expect(result).toBeString();
      expect(result).toBe('Mock response');
    });
  });

  // ── extractStructuredJSON ───────────────────────────────────────────────

  describe('extractStructuredJSON', () => {
    it('returns an object that satisfies a Zod schema', async () => {
      const result = await service.extractStructuredJSON(
        'Extract person info',
        PersonSchema,
        'John is 30 years old, email: john@example.com',
      );

      expect(result).toBeObject();
      expect(result.name).toBeString();
      expect(result.age).toBeNumber();
      expect(result.email).toBeString();
    });

    it('returns schema-compliant data (parses successfully)', () => {
      // Wrap in a function so we can await inside
      const testFn = async () => {
        const result = await service.extractStructuredJSON(
          'Extract product',
          ProductSchema,
          'Product ABC-123 titled "Widget" costs $19.99 and is in stock',
        );

        // This should not throw — data must satisfy the schema
        const parsed = Value.Parse(ProductSchema, result);
        expect(parsed.id).toBeString();
        expect(parsed.title).toBeString();
        expect(parsed.price).toBeGreaterThan(0);
        expect(parsed.inStock).toBeBoolean();
      };
      return testFn();
    });
  });

  // ── classifyText ────────────────────────────────────────────────────────

  describe('classifyText', () => {
    it('returns one of the provided labels', async () => {
      const labels = ['positive', 'negative', 'neutral'];
      const result = await service.classifyText('This is great!', labels);

      expect(result.label).toBeString();
      expect(labels).toContain(result.label);
    });

    it('is deterministic (same input → same label)', async () => {
      const labels = ['a', 'b', 'c'];
      const result1 = await service.classifyText('test input', labels);
      const result2 = await service.classifyText('test input', labels);

      expect(result1.label).toBe(result2.label);
    });

    it('includes scores when requested', async () => {
      const labels = ['cat', 'dog', 'bird'];
      const result = await service.classifyText('woof', labels, { includeScores: true });

      expect(result.score).toBeNumber();
      expect(result.allScores).toBeObject();
      expect(Object.keys(result.allScores ?? {})).toHaveLength(3);
    });

    it('handles empty labels gracefully', async () => {
      const result = await service.classifyText('some text', []);
      expect(result.label).toBe('');
    });

    it('different inputs produce potentially different labels', async () => {
      const labels = ['a', 'b'];
      const result1 = await service.classifyText('input one', labels);
      const result2 = await service.classifyText('completely different input two', labels);

      // Not guaranteed to differ, but with sufficient hash divergence they likely will.
      // If they match, the test still passes — just confirming no crash.
      expect(result1.label).toBeString();
      expect(result2.label).toBeString();
    });
  });

  // ── generateEmbedding ───────────────────────────────────────────────────

  describe('generateEmbedding', () => {
    it('returns a number array', async () => {
      const embedding = await service.generateEmbedding('test text');

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
      expect(typeof embedding[0]).toBe('number');
    });

    it('returns default dimension 1536', async () => {
      const embedding = await service.generateEmbedding('test');
      expect(embedding).toHaveLength(1536);
    });

    it('is deterministic (same input → same vector)', async () => {
      const emb1 = await service.generateEmbedding('hello world');
      const emb2 = await service.generateEmbedding('hello world');

      expect(emb1).toEqual(emb2);
    });

    it('produces different vectors for different inputs', async () => {
      const emb1 = await service.generateEmbedding('hello');
      const emb2 = await service.generateEmbedding('goodbye');

      expect(emb1).not.toEqual(emb2);
    });

    it('respects setEmbeddingDimension', async () => {
      mock.setEmbeddingDimension(768);
      const embedding = await service.generateEmbedding('test');
      expect(embedding).toHaveLength(768);
    });
  });

  // ── generateEmbeddings (batch) ──────────────────────────────────────────

  describe('generateEmbeddings', () => {
    it('returns an array of embedding vectors', async () => {
      const texts = ['one', 'two', 'three'];
      const embeddings = await service.generateEmbeddings(texts);

      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(1536);
    });

    it('each text gets its own deterministic vector', async () => {
      const texts = ['alpha', 'beta', 'alpha'];
      const embeddings = await service.generateEmbeddings(texts);

      // Same text = same vector
      expect(embeddings[0]).toEqual(embeddings[2]);
      // Different text = different vector
      expect(embeddings[0]).not.toEqual(embeddings[1]);
    });

    it('returns empty array for empty input', async () => {
      const embeddings = await service.generateEmbeddings([]);
      expect(embeddings).toHaveLength(0);
    });
  });

  // ── Call history ────────────────────────────────────────────────────────

  describe('call history', () => {
    it('records generateChat calls', async () => {
      await service.generateChat([{ role: 'user', content: 'hi' }]);

      const history = mock.getCallHistory();
      expect(history).toHaveLength(1);
      expect(history[0].method).toBe('generateChat');
    });

    it('records multiple calls chronologically', async () => {
      await service.generateChat([{ role: 'user', content: 'first' }]);
      await service.generateEmbedding('second');
      await service.classifyText('third', ['a', 'b']);

      const history = mock.getCallHistory();
      expect(history).toHaveLength(3);
      expect(history[0].method).toBe('generateChat');
      expect(history[1].method).toBe('generateEmbedding');
      expect(history[2].method).toBe('classifyText');
    });

    it('each record has a timestamp', async () => {
      await service.generateCompletion('test');
      const history = mock.getCallHistory();
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('reset clears call history', async () => {
      await service.generateChat([{ role: 'user', content: 'hi' }]);
      mock.reset();
      expect(mock.getCallHistory()).toHaveLength(0);
    });
  });

  // ── Error simulation ────────────────────────────────────────────────────

  describe('fail mode', () => {
    it('throws on rate_limited mode', async () => {
      mock.setFailMode('rate_limited');
      await expect(service.generateChat([{ role: 'user', content: 'test' }])).rejects.toThrow(
        'Mock: simulated rate limit',
      );
    });

    it('throws on authentication_failed mode', async () => {
      mock.setFailMode('authentication_failed');
      await expect(service.generateCompletion('test')).rejects.toThrow(
        'Mock: simulated authentication failure',
      );
    });

    it('throws on embedding operations too', async () => {
      mock.setFailMode('provider_unavailable');
      await expect(service.generateEmbedding('test')).rejects.toThrow(
        'Mock: simulated provider unavailable',
      );
    });

    it('reset clears fail mode', async () => {
      mock.setFailMode('network_timeout');
      mock.reset();

      const response = await service.generateChat([{ role: 'user', content: 'hi' }]);
      expect(response.text).toBe('Mock response');
    });
  });

  // ── Reset ───────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears seeded responses', async () => {
      mock.seedResponse('hello', { text: 'hi' });
      mock.reset();

      const response = await service.generateChat([{ role: 'user', content: 'hello' }]);
      expect(response.text).toBe('Mock response');
    });

    it('restores default response', async () => {
      mock.setDefaultResponse({ text: 'custom default' });
      mock.reset();

      const response = await service.generateCompletion('test');
      expect(response).toBe('Mock response');
    });

    it('restores default embedding dimension', async () => {
      mock.setEmbeddingDimension(768);
      mock.reset();

      const embedding = await service.generateEmbedding('test');
      expect(embedding).toHaveLength(1536);
    });
  });
});
