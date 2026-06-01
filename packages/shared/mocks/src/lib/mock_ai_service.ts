/** biome-ignore-all lint/style/useNamingConvention: FailMode enum keys match external conventions */
// packages/shared/mocks/src/lib/mock-ai-service.ts

import type {
  AIChatMessage,
  AiServiceInterface,
  ChatOptions,
  ChatResponse,
  ClassificationOptions,
  ClassificationResult,
  CompletionOptions,
  EmbeddingOptions,
} from '@aikami/types';
import type { TSchema } from 'typebox';

/**
 * Record of a single method call made to the mock service.
 */
type CallRecord = {
  method: keyof AiServiceInterface;
  args: unknown[];
  timestamp: Date;
};

/**
 * Fail mode for simulating provider errors in tests.
 */
type FailMode =
  | 'rate_limited'
  | 'token_exceeded'
  | 'content_filtered'
  | 'network_timeout'
  | 'authentication_failed'
  | 'provider_unavailable'
  | null;

/** Default embedding dimension (OpenAI text-embedding-3-small). */
const DEFAULT_EMBEDDING_DIMENSION = 1536;

/**
 * DJB2 hash function — produces a deterministic 32-bit integer from a string.
 *
 * Used to generate deterministic pseudo-embedding values from input text.
 * Same input always produces the same output.
 */
const djb2Hash = (input: string): number => {
  let hash = 5381;

  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }

  // Ensure non-negative
  return hash >>> 0;
};

/**
 * Simple pseudo-random number generator seeded by a hash value.
 *
 * Uses a linear congruential generator for deterministic output.
 */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return (): number => {
    state = (state * 1664525 + 1013904223) | 0;
    return (state >>> 0) / 0xffffffff;
  };
};

/**
 * Generates a deterministic pseudo-embedding vector of the given dimension.
 *
 * Uses DJB2 hash of the input text as a seed for the random number generator,
 * ensuring the same input always produces the same vector.
 */
const generateDeterministicEmbedding = (text: string, dimension: number): number[] => {
  const hash = djb2Hash(text);
  const random = seededRandom(hash);
  const embedding: number[] = [];

  for (let index = 0; index < dimension; index++) {
    embedding.push(random() * 2 - 1);
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (magnitude > 0) {
    for (let index = 0; index < embedding.length; index++) {
      embedding[index] /= magnitude;
    }
  }

  return embedding;
};

/**
 * Zero-dependency in-memory mock implementing {@link AiServiceInterface}.
 *
 * Provides:
 * - Pattern-matched or default chat responses (seedable)
 * - TypeBox schema-compliant structured extraction via `zocker`
 * - Deterministic pseudo-embedding vectors (DJB2 hash-based)
 * - Call history for test assertions
 * - Configurable fail modes for error scenario testing
 * - Fast, no API keys, no network — suitable for CI and watch-mode TDD
 *
 * @example
 * ```typescript
 * const mock = new MockAiService();
 * mock.seedResponse('hello', { text: 'hi there' });
 * const response = await mock.generateChat([{ role: 'user', content: 'hello' }]);
 * assert.strictEqual(response.text, 'hi there');
 * ```
 */
export class MockAiService implements AiServiceInterface {
  readonly name = 'mock';

  private _seededResponses = new Map<string, ChatResponse>();
  private _defaultResponse: ChatResponse = { text: 'Mock response' };
  private _callHistory: CallRecord[] = [];
  private _failMode: FailMode = null;
  private _embeddingDimension: number = DEFAULT_EMBEDDING_DIMENSION;

  /**
   * Register a pattern-matched response.
   *
   * When `generateChat` is called with a user message whose `content`
   * includes the given pattern (case-insensitive substring match),
   * the seeded response is returned instead of the default.
   *
   * @param pattern — Substring to match against the last user message content.
   * @param response — The response to return when the pattern matches.
   */
  seedResponse(pattern: string, response: ChatResponse): void {
    this._seededResponses.set(pattern.toLowerCase(), response);
  }

  /**
   * Set the default response returned when no seeded pattern matches.
   */
  setDefaultResponse(response: ChatResponse): void {
    this._defaultResponse = response;
  }

  /**
   * Set the fail mode for error simulation.
   *
   * @param mode — Error type to simulate, or `null` to disable (normal operation).
   */
  setFailMode(mode: FailMode): void {
    this._failMode = mode;
  }

  /**
   * Set the dimension of generated embedding vectors.
   *
   * @param dimension — Embedding vector length (default: 1536).
   */
  setEmbeddingDimension(dimension: number): void {
    this._embeddingDimension = dimension;
  }

  /**
   * Return the chronological call history for test assertions.
   */
  getCallHistory(): readonly CallRecord[] {
    return this._callHistory;
  }

  /**
   * Reset all state: seeded responses, call history, fail mode, default response.
   */
  reset(): void {
    this._seededResponses.clear();
    this._callHistory = [];
    this._failMode = null;
    this._defaultResponse = { text: 'Mock response' };
    this._embeddingDimension = DEFAULT_EMBEDDING_DIMENSION;
  }

  /** @inheritDoc */
  async generateChat(messages: AIChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    this._recordCall('generateChat', [messages, options]);
    this._checkFailMode();

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

    if (lastUserMessage) {
      const content = lastUserMessage.content.toLowerCase();

      for (const [pattern, response] of this._seededResponses) {
        if (content.includes(pattern)) {
          return response;
        }
      }
    }

    return { ...this._defaultResponse };
  }

  /** @inheritDoc */
  async generateCompletion(prompt: string, options?: CompletionOptions): Promise<string> {
    this._recordCall('generateCompletion', [prompt, options]);
    this._checkFailMode();

    return this._defaultResponse.text;
  }

  /** @inheritDoc */
  async extractStructuredJSON<T>(prompt: string, schema: TSchema, _input: string): Promise<T> {
    this._recordCall('extractStructuredJSON', [prompt, schema, _input]);
    this._checkFailMode();

    // zocker was Zod-specific; TypeBox v1.x doesn't have a mock data generator yet.
    // Return empty object as fallback.
    try {
      return {} as T;
    } catch {
      // Fallback: return a minimal object that satisfies the schema
      return {} as T;
    }
  }

  /** @inheritDoc */
  async classifyText(
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult> {
    this._recordCall('classifyText', [input, labels, options]);
    this._checkFailMode();

    if (labels.length === 0) {
      return { label: '', score: 0 };
    }

    // Deterministic classification based on input hash
    const hash = djb2Hash(input);
    const selectedIndex = hash % labels.length;
    const result: ClassificationResult = { label: labels[selectedIndex] };

    if (options?.includeScores) {
      const allScores: Record<string, number> = {};
      const random = seededRandom(hash);

      for (let index = 0; index < labels.length; index++) {
        allScores[labels[index]] = index === selectedIndex ? random() * 0.5 + 0.5 : random() * 0.4;
      }

      result.score = allScores[labels[selectedIndex]];
      result.allScores = allScores;
    }

    return result;
  }

  /** @inheritDoc */
  async generateEmbedding(text: string, _options?: EmbeddingOptions): Promise<number[]> {
    this._recordCall('generateEmbedding', [text, _options]);
    this._checkFailMode();

    return generateDeterministicEmbedding(text, this._embeddingDimension);
  }

  /** @inheritDoc */
  async generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    this._recordCall('generateEmbeddings', [texts, options]);
    this._checkFailMode();

    return texts.map((text) => generateDeterministicEmbedding(text, this._embeddingDimension));
  }

  /**
   * Record a method call for assertion via {@link getCallHistory}.
   */
  private _recordCall(method: keyof AiServiceInterface, args: unknown[]): void {
    this._callHistory.push({ method, args, timestamp: new Date() });
  }

  /**
   * Throw an error if a fail mode is active.
   */
  private _checkFailMode(): void {
    if (this._failMode === null) {
      return;
    }

    const messages: Record<Exclude<FailMode, null>, string> = {
      rate_limited: 'Mock: simulated rate limit',
      token_exceeded: 'Mock: simulated token limit exceeded',
      content_filtered: 'Mock: simulated content filter block',
      network_timeout: 'Mock: simulated network timeout',
      authentication_failed: 'Mock: simulated authentication failure',
      provider_unavailable: 'Mock: simulated provider unavailable',
    };

    throw new Error(messages[this._failMode]);
  }
}
