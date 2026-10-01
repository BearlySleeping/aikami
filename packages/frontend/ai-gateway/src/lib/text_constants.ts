// packages/frontend/ai-gateway/src/lib/text_constants.ts
//
// The two text-adapter tunables that are part of a CONTRACT rather than an
// implementation detail, extracted so the narrative and structured modules can
// both name them without importing each other.

/**
 * Backoff delay (ms) between the initial structured attempt and its single
 * empty-body retry (C-499 AC-2). Kept short — this is a transient empty
 * completion from local/BYOK providers, not a retry storm.
 */
export const EMPTY_RETRY_BACKOFF_MS = 200;

/**
 * Ollama VRAM-eviction payload params (C-056 lesson): release the model
 * immediately after generation so image generation can claim VRAM.
 * Formerly mirrored in @aikami/backend/ai (deleted C-324); this is now the
 * canonical copy. Could be promoted to @aikami/constants later.
 *
 * Applied ONLY to non-streaming native requests. A streaming request whose
 * `keep_alive` expires would evict the model out from under the stream that is
 * still being read, so residency policy is deliberately left alone rather than
 * changed as a side effect of adding streaming.
 */
export const OLLAMA_VRAM_EVICTION_PARAMS = {
  // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
  keep_alive: 0,
  options: {
    // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
    num_parallel: 1,
  },
} as const;
