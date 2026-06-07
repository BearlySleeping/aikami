// packages/backend/ai/src/lib/text_generation_types.ts
/** biome-ignore-all lint/style/useNamingConvention: Ollama API uses snake_case field names */

/**
 * A single Server-Sent Event yielded by a text generation stream.
 */
export type SseStreamEvent = {
  /** Event type (defaults to 'message' if undefined). */
  event?: string;
  /** The data payload as a JSON-stringifiable object or string. */
  data: unknown;
};

/**
 * Options for creating a synthetic SSE stream via {@link SyntheticSseMock}.
 */
export type SyntheticSseMockOptions = {
  /** Pre-defined chunk events to yield in sequence. */
  chunks?: SseStreamEvent[];
  /** Delay between chunks in milliseconds (default: 10). */
  chunkDelayMs?: number;
  /** If true, emit a [DONE] event at end of stream. */
  emitDone?: boolean;
  /** If true, emit an error event instead of streaming. */
  forceError?: string;
};

/**
 * Request payload sent to the text generation SSE endpoint.
 */
export type TextGenerationRequest = {
  /** The prompt or message to send to the provider. */
  prompt: string;
  /** Provider override (defaults to config). */
  provider?: 'openrouter' | 'ollama';
  /** Model override. */
  model?: string;
  /** System prompt for the assistant. */
  systemPrompt?: string;
  /** Message history for multi-turn conversation. */
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
};

/**
 * Ollama-specific payload merged into every request.
 *
 * AC-2 mandates these values for aggressive VRAM eviction:
 * - `stream: true` — enable streaming
 * - `keep_alive: 0` — evict model from VRAM immediately after stream ends
 * - `options.num_parallel: 1` — prevent concurrent threads from locking VRAM
 */
export const OLLAMA_VRAM_EVICTION_PARAMS = {
  stream: true,
  keep_alive: 0,
  options: {
    num_parallel: 1,
  },
} as const;

/**
 * Provider type enum for the text generation router.
 */
export type TextGenerationProvider = 'openrouter' | 'ollama';

/**
 * Configuration for the text generation router.
 */
export type TextGenerationConfig = {
  /** Active provider. */
  provider: TextGenerationProvider;
  /** OpenRouter API key. */
  openrouterApiKey?: string;
  /** OpenRouter base URL (defaults to https://openrouter.ai/api/v1). */
  openrouterBaseUrl?: string;
  /** Ollama base URL (defaults to http://localhost:11434). */
  ollamaBaseUrl?: string;
  /** Default model per provider. */
  defaultModel?: string;
};
