// packages/shared/constants/src/lib/providers.ts
//
// Provider registry constants used by both frontend and backend.
// These are pure data — no service logic, no state, no encryption.
//
// `apiBaseUrl` is the fixed cloud origin a provider is called on (used to
// derive the Tauri CSP `connect-src` allowlist — see
// apps/frontend/client/scripts/update_cors.ts). Omit it for providers with
// no fixed origin: local/self-hosted servers (isLocal: true, needsUrl: true
// — the user supplies the URL at runtime) and AWS Bedrock (region-varying
// endpoint). A provider having `apiBaseUrl` here does not imply a client
// integration exists yet — some ids below are label-only stubs.
//
// C-481: Added verificationStrategy, supportsModelDiscovery, capabilities,
// and typed helper functions so that locality, URL/key rules, verification
// strategy and model-discovery support are read from one definition rather
// than re-derived in connection_verifier.ts and ai_settings_view_model.

// ---------------------------------------------------------------------------
// Verification strategy
// --------------------------------------------------------------------------

/** How a provider's endpoint/credentials are verified. */
export type VerificationStrategy =
  /** Ollama-native: probe /api/tags */
  | 'ollama'
  /** OpenAI-compatible: probe /v1/models */
  | 'openai_compat'
  /** Cloud provider with fixed API endpoint: probe with auth header */
  | 'cloud_header_auth'
  /** Cloud provider with query-param API key (e.g. Google) */
  | 'cloud_query_auth'
  /** No verification strategy defined */
  | 'none';

/** A provider descriptor shared by text, voice, and image provider registries. */
type ProviderDescriptor = {
  id: string;
  label: string;
  description: string;
  needsKey: boolean;
  needsUrl?: boolean;
  isLocal: boolean;
  /** Fixed cloud API origin, e.g. 'https://api.openai.com'. Omitted for local/custom-URL and region-varying providers. */
  apiBaseUrl?: string;
  /** Verification strategy for this provider. C-481 */
  verificationStrategy: VerificationStrategy;
  /** Whether this provider supports model discovery/listing. C-481 */
  supportsModelDiscovery: boolean;
  /** Which AI capabilities this provider supports. C-481 */
  capabilities: ReadonlyArray<'text' | 'image' | 'voice'>;
};

/** Text generation provider descriptors. */
export const TEXT_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Multi-model aggregator',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://openrouter.ai',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via OpenAI API',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: true,
    capabilities: ['text', 'image', 'voice'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.anthropic.com',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Gemini models via Google AI',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://generativelanguage.googleapis.com',
    verificationStrategy: 'cloud_query_auth',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V3/R1 models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.deepseek.com',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral models via La Plateforme',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.mistral.ai',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    description: 'Local LLM server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'ollama',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp (local)',
    description: 'Local OpenAI-compatible server (llama.cpp, local-stack default)',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'ooba',
    label: 'TextGen WebUI',
    description: 'Local Oobabooga server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
  {
    id: 'custom',
    label: 'Custom API',
    description: 'OpenAI-compatible endpoint',
    needsKey: false,
    needsUrl: true,
    isLocal: false,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
] as const satisfies ReadonlyArray<ProviderDescriptor>;

/** Provider identifier extracted from TEXT_PROVIDERS union. */
export type TextProvider = (typeof TEXT_PROVIDERS)[number]['id'];

// ---------------------------------------------------------------------------
// Voice (TTS) providers
// ---------------------------------------------------------------------------

/** Voice/TTS generation provider descriptors. */
export const VOICE_PROVIDERS = [
  {
    id: 'kokoro',
    label: 'Kokoro (local)',
    description: 'Local Kokoro TTS via Docker',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: false,
    capabilities: ['voice'],
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Cloud-based TTS',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.elevenlabs.io',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['voice'],
  },
  {
    id: 'voicevox',
    label: 'VOICEVOX',
    description: 'Local Japanese TTS engine',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: false,
    capabilities: ['voice'],
  },
  {
    id: 'openai',
    label: 'OpenAI TTS',
    description: 'OpenAI cloud TTS',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['voice'],
  },
  {
    id: 'fish-speech',
    label: 'Fish Speech',
    description: 'Open-source TTS',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: false,
    capabilities: ['voice'],
  },
] as const satisfies ReadonlyArray<ProviderDescriptor>;

/** Provider identifier extracted from VOICE_PROVIDERS union. */
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number]['id'];

// ---------------------------------------------------------------------------
// Image generation providers
// ---------------------------------------------------------------------------

/** Image generation provider descriptors. */
export const IMAGE_PROVIDERS = [
  {
    id: 'comfyui',
    label: 'ComfyUI (local)',
    description: 'Local ComfyUI via Docker',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'none',
    supportsModelDiscovery: true,
    capabilities: ['image'],
  },
  {
    id: 'webui',
    label: 'AUTOMATIC1111 WebUI',
    description: 'Local Stable Diffusion WebUI',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'none',
    supportsModelDiscovery: true,
    capabilities: ['image'],
  },
  {
    id: 'novelai',
    label: 'NovelAI',
    description: 'Cloud-based anime/SD',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://image.novelai.net',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['image'],
  },
  {
    id: 'dalle',
    label: 'DALL·E',
    description: 'OpenAI DALL·E',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['image'],
  },
  {
    id: 'stability',
    label: 'Stability AI',
    description: 'Stability API',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.stability.ai',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['image'],
  },
  {
    id: 'fal',
    label: 'fal.ai',
    description: 'Serverless generative media',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://fal.run',
    verificationStrategy: 'cloud_header_auth',
    supportsModelDiscovery: false,
    capabilities: ['image'],
  },
  {
    id: 'openai-compat',
    label: 'OpenAI Compatible',
    description: 'OpenAI-compatible image API',
    needsKey: false,
    needsUrl: true,
    isLocal: false,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: true,
    capabilities: ['image'],
  },
] as const satisfies ReadonlyArray<ProviderDescriptor>;

/** Provider identifier extracted from IMAGE_PROVIDERS union. */
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]['id'];

// ---------------------------------------------------------------------------
// Typed accessors (C-481)
// ---------------------------------------------------------------------------

/** Combined type for all provider descriptors. */
export type AnyProviderDescriptor =
  | (typeof TEXT_PROVIDERS)[number]
  | (typeof VOICE_PROVIDERS)[number]
  | (typeof IMAGE_PROVIDERS)[number];

/**
 * Look up a provider descriptor by registry ID across all registries.
 * Returns undefined if no provider with that ID exists.
 */
export const findProviderDescriptor = (registryId: string): AnyProviderDescriptor | undefined =>
  [...TEXT_PROVIDERS, ...VOICE_PROVIDERS, ...IMAGE_PROVIDERS].find((p) => p.id === registryId);

/**
 * Whether a provider is local (not cloud). Reads from the canonical definition,
 * not from a re-derived set. C-481.
 */
export const isLocalProvider = (registryId: string): boolean =>
  findProviderDescriptor(registryId)?.isLocal ?? false;

/**
 * Whether a provider requires a URL (custom endpoint). C-481.
 */
export const providerNeedsUrl = (registryId: string): boolean => {
  const descriptor = findProviderDescriptor(registryId);
  return descriptor ? 'needsUrl' in descriptor && descriptor.needsUrl === true : false;
};

/**
 * Whether a provider requires an API key. C-481.
 */
export const providerNeedsKey = (registryId: string): boolean =>
  findProviderDescriptor(registryId)?.needsKey ?? false;

/**
 * Get the verification strategy for a provider. C-481.
 */
export const getVerificationStrategy = (registryId: string): VerificationStrategy =>
  findProviderDescriptor(registryId)?.verificationStrategy ?? 'none';

/**
 * Whether a provider supports model discovery/listing. C-481.
 */
export const providerSupportsModelDiscovery = (registryId: string): boolean =>
  findProviderDescriptor(registryId)?.supportsModelDiscovery ?? false;

/**
 * Get the capabilities a provider supports. C-481.
 */
export const getProviderCapabilities = (
  registryId: string,
): ReadonlyArray<'text' | 'image' | 'voice'> =>
  findProviderDescriptor(registryId)?.capabilities ?? [];

/**
 * Check if a provider supports a specific capability. C-481.
 */
export const providerSupportsCapability = (
  registryId: string,
  capability: 'text' | 'image' | 'voice',
): boolean => getProviderCapabilities(registryId).includes(capability);

// ---------------------------------------------------------------------------
// Built-in generation parameter presets (read-only)
// ---------------------------------------------------------------------------

/** Built-in generation parameter presets (read-only). */
export const BUILT_IN_PRESETS = [
  {
    id: 'creative',
    isBuiltIn: true,
    name: 'Creative',
    params: {
      contextSize: 4096,
      maxTokens: 1024,
      presencePenalty: 0.2,
      repetitionPenalty: 1.05,
      temperature: 0.9,
      topK: 50,
      topP: 0.95,
    },
  },
  {
    id: 'precise',
    isBuiltIn: true,
    name: 'Precise',
    params: {
      contextSize: 4096,
      maxTokens: 512,
      presencePenalty: -0.1,
      repetitionPenalty: 1.15,
      temperature: 0.3,
      topK: 20,
      topP: 0.5,
    },
  },
  {
    id: 'balanced',
    isBuiltIn: true,
    name: 'Balanced',
    params: {
      contextSize: 4096,
      maxTokens: 1024,
      presencePenalty: 0,
      repetitionPenalty: 1.1,
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
    },
  },
  {
    id: 'dnd-gm',
    isBuiltIn: true,
    name: 'D&D GM',
    params: {
      contextSize: 8192,
      maxTokens: 2048,
      presencePenalty: 0.3,
      repetitionPenalty: 1.08,
      temperature: 0.85,
      topK: 60,
      topP: 0.92,
    },
  },
] as const;

/** Generation parameter preset type. */
export type GenParamPreset = {
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
