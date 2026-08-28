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
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via OpenAI API',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Gemini models via Google AI',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://generativelanguage.googleapis.com',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V3/R1 models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.deepseek.com',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral models via La Plateforme',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.mistral.ai',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    description: 'Command R models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.cohere.ai',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    description: 'Open-source model hosting',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.deepinfra.com',
  },
  {
    id: 'nanogpt',
    label: 'NanoGPT',
    description: 'Pay-per-token model access',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://nano-gpt.com',
  },
  {
    id: 'novelai',
    label: 'NovelAI',
    description: 'Kayra / Clio story models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.novelai.net',
  },
  {
    id: 'aws',
    label: 'AWS Bedrock',
    description: 'Claude via AWS',
    needsKey: true,
    isLocal: false,
    // No fixed apiBaseUrl — Bedrock's endpoint is region-specific
    // (bedrock-runtime.{region}.amazonaws.com).
  },
  {
    id: 'horde',
    label: 'AI Horde',
    description: 'Volunteer compute cluster',
    needsKey: false,
    isLocal: false,
    apiBaseUrl: 'https://aihorde.net',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    description: 'Local LLM server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp (local)',
    description: 'Local OpenAI-compatible server (llama.cpp, local-stack default)',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'ooba',
    label: 'TextGen WebUI',
    description: 'Local Oobabooga server',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'custom',
    label: 'Custom API',
    description: 'OpenAI-compatible endpoint',
    needsKey: false,
    needsUrl: true,
    isLocal: false,
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
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Cloud-based TTS',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.elevenlabs.io',
  },
  {
    id: 'voicevox',
    label: 'VOICEVOX',
    description: 'Local Japanese TTS engine',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'openai',
    label: 'OpenAI TTS',
    description: 'OpenAI cloud TTS',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
  },
  {
    id: 'fish-speech',
    label: 'Fish Speech',
    description: 'Open-source TTS',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
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
  },
  {
    id: 'webui',
    label: 'AUTOMATIC1111 WebUI',
    description: 'Local Stable Diffusion WebUI',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
  },
  {
    id: 'novelai',
    label: 'NovelAI',
    description: 'Cloud-based anime/SD',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://image.novelai.net',
  },
  {
    id: 'dalle',
    label: 'DALL·E',
    description: 'OpenAI DALL·E',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.openai.com',
  },
  {
    id: 'stability',
    label: 'Stability AI',
    description: 'Stability API',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.stability.ai',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    description: 'Serverless generative media',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://fal.run',
  },
  {
    id: 'openai-compat',
    label: 'OpenAI Compatible',
    description: 'OpenAI-compatible image API',
    needsKey: false,
    needsUrl: true,
    isLocal: false,
  },
] as const satisfies ReadonlyArray<ProviderDescriptor>;

/** Provider identifier extracted from IMAGE_PROVIDERS union. */
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]['id'];

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
