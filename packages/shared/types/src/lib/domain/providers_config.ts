// packages/shared/types/src/lib/domain/providers_config.ts
//
// Configuration types for provider settings (text, voice, image, memory,
// emotion). These are shared between the client config service and view
// models — pure type definitions, no runtime values.

// ---------------------------------------------------------------------------
// Provider endpoint types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Voice types
// ---------------------------------------------------------------------------

/** A voice option displayed in the dropdown. */
export type VoiceOption = {
  /** Voice identifier (e.g. 'af_heart'). */
  id: string;
  /** Human-readable label. */
  label: string;
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

// ---------------------------------------------------------------------------
// Config section types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OpenRouter model type
// ---------------------------------------------------------------------------

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
    prompt: string;
    completion: string;
  };
};

// ---------------------------------------------------------------------------
// Top-level config state (self-contained, no client-only type dependencies)
// ---------------------------------------------------------------------------

/** A single model configuration entry. */
export type ModelConfigEntry = {
  /** Model identifier (e.g. 'claude-3-opus-20240229'). */
  model: string;
  /** Provider this model belongs to. */
  provider: string;
  /** Base URL for the API endpoint. */
  endpoint: string;
};

/** A generation parameter preset. */
export type PresetEntry = {
  id: string;
  name: string;
  params: {
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    presencePenalty: number;
    maxTokens: number;
    contextSize: number;
  };
  isBuiltIn: boolean;
};

/** A saved provider connection (C-230). */
export type ConnectionEntry = {
  id: string;
  provider: string;
  capability?: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  generationParams: {
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    presencePenalty: number;
    maxTokens: number;
    contextSize: number;
  };
  isDefault: boolean;
  source?: string;
  createdAt: string;
  updatedAt: string;
  imageOptions?: { checkpoint: string; width: number; height: number; steps: number; cfg: number };
  voiceOptions?: { voiceId: string; speed: number; pitch: number };
};

/** A lorebook entry. */
export type LorebookEntry = {
  id: string;
  name: string;
  description: string;
  entries: Array<{
    id: string;
    // biome-ignore lint/style/useNamingConvention: matches existing schema
    primary_key: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    keywords?: string[];
    priority?: number;
    constant?: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

/** Top-level configuration state. */
export type ConfigState = {
  /** Model configurations (provider-agnostic). */
  models: ModelConfigEntry[];
  /** Voice / TTS settings. */
  voice: VoiceConfig;
  /** Image generation settings. */
  image: ImageConfig;
  /** AI generation parameter overrides. */
  generationParams: {
    temperature: number;
    topP: number;
    topK: number;
    repetitionPenalty: number;
    presencePenalty: number;
    maxTokens: number;
    contextSize: number;
  };
  /** Saved provider connections (C-230). */
  connections: ConnectionEntry[];
  /** ID of the default connection, or null if none set. */
  defaultConnectionId: string | null;
  /** Per-capability default connection IDs (text, image, voice). */
  defaultByCapability: Record<string, string | null>;
  /** Generation parameter presets (built-in + user-defined). */
  presets: PresetEntry[];
  /** Lorebooks (world info collections) persisted in localStorage. */
  lorebooks: LorebookEntry[];
  /** IDs of lorebooks assigned to the active chat session. */
  activeLorebookIds: string[];
};
