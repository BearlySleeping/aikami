// packages/shared/types/src/lib/client/provider_config.ts
//
// Provider configuration types shared across the client.
// These types are extracted from the service layer for use by ViewModels
// and UI components without importing service implementations.

/** Descriptor for a checkpoint/model returned by the model listing. */
export type CheckpointInfo = {
  readonly id: string;
  readonly description: string;
};

/** Verification endpoint descriptor for a provider. */
export type ProviderEndpoint = {
  /** Human-readable label. */
  label: string;
  /** URL to fetch for key verification (typically a models-list endpoint). */
  verifyUrl: string;
  /** HTTP method for the verification request. */
  method: 'GET';
  /** How the API key is sent. */
  auth: {
    /** Where the key goes: 'header' | 'query'. */
    location: 'header' | 'query';
    /** Header name when `location === 'header'`, query param name when `location === 'query'`. */
    name: string;
    /** Optional value prefix (e.g. 'Bearer '). */
    prefix?: string;
  };
  /** Extra headers required by the provider (e.g. Anthropic version header). */
  extraHeaders?: Record<string, string>;
};

/** Advanced overrides for specific providers. */
export type AdvancedOverrides = {
  /** Thinking/reasoning level for DeepSeek/Claude models. */
  thinkingLevel: number;
};

/** Memory subsystem configuration. */
export type MemoryConfig = {
  /** Memory type (algorithm). */
  type: string;
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum number of conversation turns to retain. */
  maxTurns: number;
  /** Summarization threshold (turns before summarisation kicks in). */
  summarizationThreshold: number;
  /** Whether long-term memory (vector store) is enabled. */
  longTermMemory: boolean;
  /** Embedding model provider for vector search. */
  embeddingModel: string;
  /** Custom embedding API endpoint (when embeddingModel is 'custom'). */
  embeddingUrl?: string;
  /** API key for custom embedding provider. */
  embeddingKey?: string;
  /** Text chunk size for embedding ingestion. */
  chunkSize: number;
};

/** Voice / TTS subsystem configuration. */
export type VoiceConfig = {
  /** Selected TTS provider (e.g. 'kokoro', 'elevenlabs'). */
  provider: string;
  /** Selected TTS engine (mirrors provider). */
  engine: string;
  /** Custom server URL for local providers (voicevox, etc.). */
  url?: string;
  /** API key for cloud providers. */
  apiKey?: string;
  /** Voice style or speaker ID. */
  voiceId: string;
  /** Speech rate multiplier (0.5–2.0). */
  speed: number;
  /** Pitch adjustment (-20–20). */
  pitch: number;
  /** Auto-speech: automatically generate TTS for NPC dialogue. */
  autoSpeech: boolean;
  /** User-editable voice archetype → voice ID mappings. */
  voiceArchetypes: VoiceArchetype[];
};

/** A named voice archetype mapped to a provider-specific voice ID. */
export type VoiceArchetype = {
  /** Unique archetype key (e.g. 'female-warm', 'male-deep'). */
  id: string;
  /** Human-readable label (e.g. 'Female — Warm'). */
  label: string;
  /** Provider-specific voice ID (e.g. 'af_heart' for Kokoro). */
  voiceId: string;
};

/** Image generation subsystem configuration. */
export type ImageConfig = {
  /** Selected image generation provider. */
  provider: string;
  /** Selected image generation backend (mirrors provider). */
  backend: string;
  /** Custom server URL for local providers. */
  url?: string;
  /** API key for cloud providers. */
  apiKey?: string;
  /** Default checkpoint / model ID. */
  checkpoint: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Generation steps. */
  steps: number;
  /** CFG guidance scale. */
  cfgScale: number;
  /** Sampler name (e.g. 'euler_a', 'dpmpp_2m'). */
  sampler?: string;
  /** Whether img2img mode is enabled by default. */
  enableI2I?: boolean;
  /** ComfyUI workflow JSON string (provider-specific). */
  comfyWorkflow?: string;
  /** NovelAI noise schedule override (provider-specific). */
  novelAiNoiseSchedule?: string;
  /** Active style profile ID for the image generation pipeline (C-242). */
  styleProfileId: string;
  /** Whether to show a review/edit modal before each image generation (C-242). */
  reviewBeforeGenerate: boolean;
};

/** Emotion resolution configuration. */
export type EmotionConfig = {
  /** How character emotions are resolved. */
  method: string;
  /** Target model for emotion extraction (when method is 'submodel'). */
  targetModel?: string;
};
