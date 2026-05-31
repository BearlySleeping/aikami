// packages/shared/types/src/lib/pwa/ai-service-interface.ts
// TODO: Remove this? or move to endpoints?
import type { z } from 'zod';

import type {
  AIChatMessage,
  ChatOptions,
  ChatResponse,
  ClassificationOptions,
  ClassificationResult,
  CompletionOptions,
  EmbeddingOptions,
} from '../endpoints/ai';

/**
 * Vendor-agnostic AI service contract.
 *
 * All method signatures use domain types from this package.
 * No vendor-specific types (OpenAI, Gemini, Genkit, etc.) appear in this interface.
 *
 * Implementations:
 * - {@link BaseAiService} — abstract base with rate limiting, retry, circuit breaker
 * - {@link OpenAiService} — OpenAI driver
 * - {@link GeminiService} — Gemini driver
 * - {@link MockAiService} — deterministic mock for TDD
 */
export interface AiServiceInterface {
  /** Human-readable provider name (e.g. 'openai', 'gemini'). */
  readonly name: string;

  /**
   * Multi-turn chat generation.
   *
   * @param messages — Ordered conversation history (system/user/assistant).
   * @param options — Optional model, temperature, maxTokens, etc.
   * @returns Generated assistant response with optional token usage.
   */
  generateChat(messages: AIChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * Single-turn text completion.
   *
   * @param prompt — The prompt text to complete.
   * @param options — Optional model, temperature, maxTokens, etc.
   * @returns Generated completion text.
   */
  generateCompletion(prompt: string, options?: CompletionOptions): Promise<string>;

  /**
   * Extract structured JSON from unstructured text using a Zod schema.
   *
   * The provider is asked to produce JSON conforming to the schema.
   * Responses are validated through `schema.parseAsync()` before returning.
   * Invalid responses trigger automatic retry with a correction prompt.
   *
   * @param prompt — Instruction for the extraction (e.g. "Extract the person's name and age").
   * @param schema — Zod schema defining the expected output shape.
   * @param input — The unstructured text to extract from.
   * @returns A typed object matching the schema.
   */
  extractStructuredJSON<T>(prompt: string, schema: z.ZodSchema<T>, input: string): Promise<T>;

  /**
   * Classify text into one of the provided labels.
   *
   * @param input — The text to classify.
   * @param labels — Candidate classification labels.
   * @param options — Optional model, includeScores, etc.
   * @returns Classification result with selected label and optional confidence scores.
   */
  classifyText(
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult>;

  /**
   * Generate an embedding vector for a single text.
   *
   * @param text — The text to embed.
   * @param options — Optional model override.
   * @returns Embedding vector as a number array (dimension varies by model).
   */
  generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]>;

  /**
   * Generate embedding vectors for multiple texts in batch.
   *
   * @param texts — Array of texts to embed.
   * @param options — Optional model override.
   * @returns Array of embedding vectors.
   */
  generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
}
