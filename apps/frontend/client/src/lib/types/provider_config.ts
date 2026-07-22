// apps/frontend/client/src/lib/types/provider_config.ts
//
// Client-local types for AI provider configuration.
// Const data moved to $lib/data/provider_constants.ts

/** Generation parameter overrides. */
export type GenerationParams = {
  /** Sampling temperature (0–2). */
  temperature: number;
  /** Nucleus sampling threshold (0–1). */
  topP: number;
  /** Top-k sampling limit. */
  topK: number;
  /** Repetition penalty (1–2). */
  repetitionPenalty: number;
  /** Presence penalty (0–2). */
  presencePenalty: number;
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Maximum context window size in tokens. */
  contextSize: number;
};

/** Auxiliary model assignments for specialised AI tasks. */
export type AuxiliaryModels = {
  /** Model used for conversation summarization. */
  summarization: string | undefined;
  /** Model used for vision/image analysis. */
  vision: string | undefined;
  /** Model used for embedding generation. */
  embedding: string | undefined;
};

// InstructTemplate type is now in $lib/data/provider_constants.ts

/**
 * A single model entry from the OpenRouter /models endpoint.
 * Field names use snake_case to match the OpenRouter API.
 */
export type OpenRouterModel = {
  /** Unique model identifier (e.g. 'openai/gpt-4o'). */
  id: string;
  /** Human-readable model name. */
  name: string;
  /** Maximum context length in tokens. */
  // biome-ignore lint/style/useNamingConvention: OpenRouter API uses snake_case
  context_length: number;
  /** Pricing information per token. */
  pricing: {
    prompt: number;
    completion: number;
  };
};
