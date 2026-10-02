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
//
// Issue #381: `providerAcceptsKey` also accepts the separate decision registry.
// The descriptor below is a CHAT descriptor — verification strategy, CSP
// origin, reasoning control and generation parameters are all meaningless for a
// backend that scores closed questions — so the decision registry is consulted
// directly rather than widening this type.

import { decisionProviderEntry } from './decision_providers.ts';

// ---------------------------------------------------------------------------
// Verification strategy
// --------------------------------------------------------------------------

/** How a provider's endpoint/credentials are verified. */
export type VerificationStrategy =
  /** Ollama-native: probe /api/tags */
  | 'ollama'
  /** OpenAI-compatible: probe /v1/models */
  | 'openai_compat'
  /** ComfyUI-native: probe /object_info */
  | 'comfyui'
  /** AUTOMATIC1111 / sd-server: probe /sdapi/v1/sd-models */
  | 'webui'
  /** Cloud provider with fixed API endpoint: probe with auth header */
  | 'cloud_header_auth'
  /** Cloud provider with query-param API key (e.g. Google) */
  | 'cloud_query_auth'
  /** No verification strategy defined */
  | 'none';

/**
 * The (provider, surface) pairing a text provider was MEASURED to honour when
 * asked for no reasoning.
 *
 * The surface qualifier is load-bearing — see `reasoningControl`. The adapter
 * mirrors this union so it can stay independent of the provider registry; the
 * two are structurally identical string unions.
 */
export type TextReasoningControl = 'ollama-native-think' | 'openai-compat-reasoning-effort';

/** A provider descriptor shared by text, voice, and image provider registries. */
type ProviderDescriptor = {
  id: string;
  label: string;
  description: string;
  needsKey: boolean;
  needsUrl?: boolean;
  /**
   * Whether this provider ACCEPTS a credential without requiring one. The
   * user-supplied-endpoint entries (`custom`, `openai-compat`) serve both a
   * local keyless server and a hosted API behind a key, and nothing in the
   * registry can tell them apart ahead of time — so the key field is shown
   * and left optional instead of being hidden from every custom endpoint.
   */
  optionalKey?: boolean;
  isLocal: boolean;
  /** Fixed cloud API origin, e.g. 'https://api.openai.com'. Omitted for local/custom-URL and region-varying providers. */
  apiBaseUrl?: string;
  /** Verification strategy for this provider. C-481 */
  verificationStrategy: VerificationStrategy;
  /** Whether this provider supports model discovery/listing. C-481 */
  supportsModelDiscovery: boolean;
  /**
   * The (provider, surface) pairing this provider was MEASURED to honour when
   * asked for no reasoning, and nothing else.
   *
   * Additive and measured, not assumed. A claim that a provider honours a
   * field is not evidence: Ollama 0.34.3 accepts `reasoning_effort` on
   * `/v1/chat/completions` and honours it, accepts `think` on the same
   * endpoint and silently ignores it, accepts `reasoning_effort` on native
   * `/api/chat` and ignores it there, and ignores
   * `chat_template_kwargs.enable_thinking` on both (issue #382, n=11 each).
   * Only the two spellings below are verified.
   *
   * The value is deliberately surface-qualified, because the pairing is what
   * was measured. The adapter checks the surface it is about to use against
   * this declaration and DROPS the control on a mismatch, so a provider that
   * is later rerouted onto an unmeasured surface keeps the old
   * byte-identical request body rather than sending a field the provider will
   * accept with a 200 and ignore.
   *
   * Absent means the provider cannot be asked, and the preference is dropped:
   * the request goes out exactly as it did before, and the task degrades on
   * its own deadline rather than the call failing because of an unsupported
   * option.
   */
  reasoningControl?: TextReasoningControl;
  /** Which AI capabilities this provider supports. C-481 */
  capabilities: ReadonlyArray<'text' | 'image' | 'voice'>;
};

/** AI capability used to select capability-specific provider metadata. */
export type ProviderCapability = ProviderDescriptor['capabilities'][number];

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
    id: 'nanogpt',
    label: 'NanoGPT',
    description: 'Pay-per-prompt OpenAI-compatible gateway to many models',
    needsKey: true,
    isLocal: false,
    apiBaseUrl: 'https://api.nano-gpt.com',
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
    // Measured on Ollama 0.34.3, native `/api/chat`, `ornith-1.5:9b`:
    // `think: false` → 0 reasoning characters, 11/11 answers within the
    // 6 000 ms envelope budget, 11/11 schema-valid. `reasoning_effort` is
    // accepted on the same endpoint and does nothing. The surface qualifier is
    // load-bearing: the adapter will not send this if `ollama` is ever routed
    // through `/v1`, where the same field is ignored.
    reasoningControl: 'ollama-native-think',
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
    description: 'Any OpenAI-compatible endpoint — key optional',
    needsKey: false,
    optionalKey: true,
    needsUrl: true,
    isLocal: false,
    verificationStrategy: 'openai_compat',
    supportsModelDiscovery: true,
    capabilities: ['text'],
  },
] as const satisfies ReadonlyArray<ProviderDescriptor>;

/** Provider identifier extracted from TEXT_PROVIDERS union. */
export type TextProvider = (typeof TEXT_PROVIDERS)[number]['id'];

/**
 * The reasoning control a text provider honours, or `undefined`.
 *
 * An accessor rather than a `find` at each call site: `TEXT_PROVIDERS` is
 * `as const`, so a direct lookup yields a union of the individual entry types
 * and every caller would have to re-derive "absent means unsupported". This
 * makes the unsupported case explicit and total — a provider id that is not in
 * the registry simply has no control, exactly like one that is in it and
 * declares none.
 */
export const getTextReasoningControl = (providerId: string): TextReasoningControl | undefined =>
  (TEXT_PROVIDERS as ReadonlyArray<ProviderDescriptor>).find(
    (provider) => provider.id === providerId,
  )?.reasoningControl;

// ---------------------------------------------------------------------------
// Voice (TTS) providers
// ---------------------------------------------------------------------------

/** Voice/TTS generation provider descriptors. */
export const VOICE_PROVIDERS = [
  {
    id: 'kokoro',
    label: 'Kokoro (local)',
    description: 'On-device Kokoro TTS (browser WebGPU / desktop binary)',
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
    verificationStrategy: 'comfyui',
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
    verificationStrategy: 'webui',
    supportsModelDiscovery: true,
    capabilities: ['image'],
  },
  {
    id: 'sdcpp',
    label: 'sd-server (local)',
    description: 'Local stable-diffusion.cpp engine',
    needsKey: false,
    needsUrl: true,
    isLocal: true,
    verificationStrategy: 'webui',
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
    description: 'OpenAI-compatible image API — key optional',
    needsKey: false,
    optionalKey: true,
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

const ALL_PROVIDER_DESCRIPTORS: ReadonlyArray<AnyProviderDescriptor> = [
  ...TEXT_PROVIDERS,
  ...VOICE_PROVIDERS,
  ...IMAGE_PROVIDERS,
];

const descriptorSupportsCapability = (
  descriptor: AnyProviderDescriptor,
  capability: ProviderCapability,
): boolean => descriptor.capabilities.some((supported) => supported === capability);

/**
 * Look up a provider descriptor by registry ID across all registries.
 * When a capability is supplied, its own registry wins over cross-capability
 * metadata advertised by another registry entry with the same ID.
 * Returns undefined if no provider with that ID exists.
 */
export const findProviderDescriptor = (
  registryId: string,
  capability?: ProviderCapability,
): AnyProviderDescriptor | undefined => {
  if (!capability) {
    return ALL_PROVIDER_DESCRIPTORS.find((provider) => provider.id === registryId);
  }

  let preferred: AnyProviderDescriptor | undefined;
  if (capability === 'text') {
    preferred = TEXT_PROVIDERS.find((provider) => provider.id === registryId);
  } else if (capability === 'voice') {
    preferred = VOICE_PROVIDERS.find((provider) => provider.id === registryId);
  } else {
    preferred = IMAGE_PROVIDERS.find((provider) => provider.id === registryId);
  }
  if (preferred) {
    return preferred;
  }

  return ALL_PROVIDER_DESCRIPTORS.find(
    (provider) => provider.id === registryId && descriptorSupportsCapability(provider, capability),
  );
};

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
 * Whether the connection editor should show an API key field for a provider —
 * required (`needsKey`) or accepted-but-optional (`optionalKey`). Asking for
 * "does this provider need a key?" and rendering the field from the answer
 * hides the field on every custom endpoint, which is how a user with a valid
 * key for their own API ends up with nowhere to paste it.
 */
export const providerAcceptsKey = (
  registryId: string,
  capability?: ProviderCapability | 'decision',
): boolean => {
  // The decision registry is separate (see decision_providers.ts): none of the
  // chat descriptor fields mean anything for a backend that only scores closed
  // questions, but "does this one need a key" is still a real question about it.
  if (capability === 'decision') {
    const decision = decisionProviderEntry(registryId);
    return decision?.needsKey === true || decision?.optionalKey === true;
  }
  const descriptor = findProviderDescriptor(registryId, capability);
  if (!descriptor) {
    return false;
  }
  return descriptor.needsKey || ('optionalKey' in descriptor && descriptor.optionalKey === true);
};

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
export const getProviderCapabilities = (registryId: string): ReadonlyArray<ProviderCapability> => [
  ...new Set(
    ALL_PROVIDER_DESCRIPTORS.filter((provider) => provider.id === registryId).flatMap(
      (provider) => provider.capabilities,
    ),
  ),
];

/**
 * Check if a provider supports a specific capability. C-481.
 */
export const providerSupportsCapability = (
  registryId: string,
  capability: ProviderCapability,
): boolean => findProviderDescriptor(registryId, capability) !== undefined;

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
