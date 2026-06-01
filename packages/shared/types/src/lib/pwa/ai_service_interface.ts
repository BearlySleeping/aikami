// packages/shared/types/src/lib/pwa/ai_service_interface.ts
import type { TSchema } from 'typebox';
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
 */
export type AiServiceInterface = {
  /** Human-readable provider name (e.g. 'openai', 'gemini'). */
  readonly name: string;

  /**
   * Multi-turn chat generation.
   */
  generateChat(messages: AIChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /**
   * Single-turn text completion.
   */
  generateCompletion(prompt: string, options?: CompletionOptions): Promise<string>;

  /**
   * Extract structured JSON from unstructured text using a TypeBox schema.
   *
   * The provider is asked to produce JSON conforming to the schema.
   * Responses are validated before returning.
   */
  extractStructuredJSON<T>(prompt: string, schema: TSchema, input: string): Promise<T>;

  /**
   * Classify text into one of the provided labels.
   */
  classifyText(
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult>;

  /**
   * Generate an embedding vector for a single text.
   */
  generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]>;

  /**
   * Generate embedding vectors for multiple texts in batch.
   */
  generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
};
