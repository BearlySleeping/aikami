// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
//
// Singleton service that manages the central configuration state for the
// dev/config dashboard. API keys are encrypted at rest via crypto_vault;
// non-sensitive settings are stored as plain JSON in localStorage.
// Firestore sync is optional — works entirely offline for Tauri / local use.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { clearVault, decrypt, encrypt } from '$lib/utils/crypto_vault';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Text AI providers (C-204 expanded: all RisuAI providers)
// ---------------------------------------------------------------------------

/** Text generation provider descriptors. */
export const TEXT_PROVIDERS = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Multi-model aggregator',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT models via OpenAI API',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    description: 'Gemini models via Google AI',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek V3/R1 models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral models via La Plateforme',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'cohere',
    label: 'Cohere',
    description: 'Command R models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    description: 'Open-source model hosting',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'nanogpt',
    label: 'NanoGPT',
    description: 'Pay-per-token model access',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'novelai',
    label: 'NovelAI',
    description: 'Kayra / Clio story models',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'aws',
    label: 'AWS Bedrock',
    description: 'Claude via AWS',
    needsKey: true,
    isLocal: false,
  },
  {
    id: 'horde',
    label: 'AI Horde',
    description: 'Volunteer compute cluster',
    needsKey: false,
    isLocal: false,
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
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  needsKey: boolean;
  needsUrl?: boolean;
  isLocal: boolean;
}>;

export type TextProvider = (typeof TEXT_PROVIDERS)[number]['id'];

/** Map of provider → API key string. */
export type ApiKeys = Record<string, string>;

/** Text generation subsystem configuration. */
export type TextConfig = {
  /** Selected text generation provider. */
  provider: TextProvider;
  /** API keys per provider (encrypted at rest). */
  apiKeys: ApiKeys;
  /** Custom endpoint URL (for ollama, ooba, custom). */
  url?: string;
};

/** Memory subsystem configuration. */
export type MemoryConfig = {
  /** Memory type (algorithm). */
  type: MemoryType;
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum number of conversation turns to retain. */
  maxTurns: number;
  /** Summarization threshold (turns before summarisation kicks in). */
  summarizationThreshold: number;
  /** Whether long-term memory (vector store) is enabled. */
  longTermMemory: boolean;
  /** Embedding model provider for vector search. */
  embeddingModel: EmbeddingModel;
  /** Custom embedding API endpoint (when embeddingModel is 'custom'). */
  embeddingUrl?: string;
  /** API key for custom embedding provider. */
  embeddingKey?: string;
  /** Text chunk size for embedding ingestion. */
  chunkSize: number;
};

// ---------------------------------------------------------------------------
// Memory subsystem (C-204: expanded with embedding provider selection)
// ---------------------------------------------------------------------------

/** Memory subsystem type. */
export const MEMORY_TYPES = ['none', 'basic', 'hypa-style', 'hanurai'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Embedding model providers. */
export const EMBEDDING_MODELS = [
  { id: 'minilm', label: 'MiniLM (local)' },
  { id: 'nomic', label: 'Nomic Embed' },
  { id: 'bge', label: 'BGE (BAAI)' },
  { id: 'openai', label: 'OpenAI Embeddings' },
  { id: 'voyage', label: 'Voyage AI' },
  { id: 'custom', label: 'Custom API' },
] as const;

export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number]['id'];

// ---------------------------------------------------------------------------
// Voice engine selection
// ---------------------------------------------------------------------------

/** Available TTS engines. */
export const VOICE_ENGINES = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
] as const;

/** TTS engine identifier. */
export type VoiceEngine = (typeof VOICE_ENGINES)[number]['id'];

/** A voice option displayed in the dropdown. */
export type VoiceOption = {
  /** Voice identifier (e.g. 'af_heart'). */
  id: string;
  /** Human-readable label. */
  label: string;
};

/** All known Kokoro voices (mirrors the /v1/voices endpoint). */
export const KOKORO_VOICES: readonly VoiceOption[] = [
  // American English — Female
  { id: 'af_heart', label: 'af_heart — Warm, natural (default)' },
  { id: 'af_bella', label: 'af_bella — Expressive' },
  { id: 'af_nova', label: 'af_nova — Clear' },
  { id: 'af_sky', label: 'af_sky — Neutral, versatile' },
  { id: 'af_sarah', label: 'af_sarah — Conversational' },
  { id: 'af_nicole', label: 'af_nicole — Friendly' },
  { id: 'af_alloy', label: 'af_alloy — Balanced' },
  { id: 'af_jessica', label: 'af_jessica — Energetic' },
  { id: 'af_river', label: 'af_river — Calm' },
  // American English — Male
  { id: 'am_adam', label: 'am_adam — Deep' },
  { id: 'am_michael', label: 'am_michael — Clear' },
  { id: 'am_echo', label: 'am_echo — Neutral' },
  { id: 'am_eric', label: 'am_eric — Authoritative' },
  { id: 'am_fenrir', label: 'am_fenrir — Distinctive' },
  { id: 'am_liam', label: 'am_liam — Conversational' },
  { id: 'am_onyx', label: 'am_onyx — Rich' },
  { id: 'am_puck', label: 'am_puck — Expressive' },
  { id: 'am_santa', label: 'am_santa — Warm' },
  // British English — Female
  { id: 'bf_emma', label: 'bf_emma — Clear, professional' },
  { id: 'bf_isabella', label: 'bf_isabella — Warm' },
  { id: 'bf_alice', label: 'bf_alice — Crisp' },
  { id: 'bf_lily', label: 'bf_lily — Soft' },
  // British English — Male
  { id: 'bm_george', label: 'bm_george — Authoritative' },
  { id: 'bm_lewis', label: 'bm_lewis — Smooth' },
  { id: 'bm_daniel', label: 'bm_daniel — Calm' },
  { id: 'bm_fable', label: 'bm_fable — Expressive' },
] as const;

// ---------------------------------------------------------------------------
// Voice TTS providers (C-204: expanded provider selection)
// ---------------------------------------------------------------------------

/** Available TTS provider identifiers. */
export const VOICE_PROVIDERS = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'voicevox', label: 'VOICEVOX', description: 'Local Japanese TTS engine' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
  { id: 'fish-speech', label: 'Fish Speech', description: 'Open-source TTS' },
] as const;

export type VoiceProvider = (typeof VOICE_PROVIDERS)[number]['id'];

/** Voice / TTS subsystem configuration. */
export type VoiceConfig = {
  /** Selected TTS provider (e.g. 'kokoro', 'elevenlabs'). */
  provider: VoiceProvider;
  /** Selected TTS engine (legacy — kept for migration, mirrors provider). */
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

// ---------------------------------------------------------------------------
// Voice archetypes — human-friendly labels mapped to engine voice IDs
// ---------------------------------------------------------------------------

/** A named voice archetype mapped to a provider-specific voice ID. */
export type VoiceArchetype = {
  /** Unique archetype key (e.g. 'female-warm', 'male-deep'). */
  id: string;
  /** Human-readable label (e.g. 'Female — Warm'). */
  label: string;
  /** Provider-specific voice ID (e.g. 'af_heart' for Kokoro). */
  voiceId: string;
};

/** Curated default voice archetypes mapped to Kokoro IDs. */
export const DEFAULT_VOICE_ARCHETYPES: readonly VoiceArchetype[] = [
  // ── Female ─────────────────────────────────────────────────────────
  { id: 'female-warm', label: 'Female — Warm', voiceId: 'af_heart' },
  { id: 'female-clear', label: 'Female — Clear', voiceId: 'af_nova' },
  { id: 'female-expressive', label: 'Female — Expressive', voiceId: 'af_bella' },
  { id: 'female-calm', label: 'Female — Calm', voiceId: 'af_river' },
  { id: 'female-friendly', label: 'Female — Friendly', voiceId: 'af_nicole' },
  { id: 'female-professional', label: 'Female — Professional (UK)', voiceId: 'bf_emma' },
  // ── Male ───────────────────────────────────────────────────────────
  { id: 'male-warm', label: 'Male — Warm', voiceId: 'am_santa' },
  { id: 'male-clear', label: 'Male — Clear', voiceId: 'am_michael' },
  { id: 'male-authoritative', label: 'Male — Authoritative', voiceId: 'bm_george' },
  { id: 'male-deep', label: 'Male — Deep', voiceId: 'am_adam' },
  { id: 'male-expressive', label: 'Male — Expressive', voiceId: 'am_puck' },
  { id: 'male-conversational', label: 'Male — Conversational', voiceId: 'am_liam' },
  { id: 'male-calm', label: 'Male — Calm (UK)', voiceId: 'bm_daniel' },
] as const;

// ---------------------------------------------------------------------------
// Image generation providers (C-204: expanded provider selection)
// ---------------------------------------------------------------------------

/** Available image generation provider identifiers. */
export const IMAGE_PROVIDERS = [
  { id: 'comfyui', label: 'ComfyUI (local)', description: 'Local ComfyUI via Docker' },
  { id: 'webui', label: 'AUTOMATIC1111 WebUI', description: 'Local Stable Diffusion WebUI' },
  { id: 'novelai', label: 'NovelAI', description: 'Cloud-based anime/SD' },
  { id: 'dalle', label: 'DALL·E', description: 'OpenAI DALL·E' },
  { id: 'stability', label: 'Stability AI', description: 'Stability API' },
  { id: 'fal', label: 'fal.ai', description: 'Serverless generative media' },
  { id: 'openai-compat', label: 'OpenAI Compatible', description: 'OpenAI-compatible image API' },
] as const;

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]['id'];

/** Image generation subsystem configuration. */
export type ImageConfig = {
  /** Selected image generation provider. */
  provider: ImageProvider;
  /** Selected image generation backend (legacy — kept for migration, mirrors provider). */
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
};

/** Generic model configuration for a single provider. */
export type ModelConfig = {
  /** Model identifier (e.g. 'claude-3-opus-20240229'). */
  model: string;
  /** Provider this model belongs to. */
  provider: string;
  /** Base URL for the API endpoint. */
  endpoint: string;
};

// ── Emotion config (C-204) ───────────────────────────────────

/** Emotion resolution methods. */
export const EMOTION_METHODS = ['submodel', 'embedding'] as const;
export type EmotionMethod = (typeof EMOTION_METHODS)[number];

/** Emotion resolution configuration. */
export type EmotionConfig = {
  /** How character emotions are resolved. */
  method: EmotionMethod;
  /** Target model for emotion extraction (when method is 'submodel'). */
  targetModel?: string;
};

// ── AI Generation Settings (absorbed from ai_settings.svelte.ts) ────────

/** Supported instruct template formats. */
export const INSTRUCT_TEMPLATES = [
  'chatml',
  'alpaca',
  'vicuna',
  'llama3',
  'mistral',
  'deepseek',
  'custom',
] as const;

export type InstructTemplate = (typeof INSTRUCT_TEMPLATES)[number];

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
  /** Presence penalty (-2–2). */
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

/** Advanced overrides for specific providers. */
export type AdvancedOverrides = {
  /** Thinking/reasoning level for DeepSeek/Claude models. */
  thinkingLevel: number;
};

/** Resolved text generation provider ready for API calls. */
export type ResolvedTextProvider = {
  /** Model identifier (e.g. 'openrouter/owl-alpha'). */
  model: string;
  /** Provider name (e.g. 'openrouter'). */
  provider: string;
  /** Base URL for the provider's API endpoint. */
  endpoint: string;
  /** API key for the resolved provider, or undefined if not configured. */
  apiKey: string | undefined;
};

/** Top-level configuration state. */
export type ConfigState = {
  /** Text generation settings (provider, API keys, URL). */
  text: TextConfig;
  /** Preferred text generation model. */
  preferredModel: string;
  /** Model configurations (provider-agnostic). */
  models: ModelConfig[];
  /** Memory subsystem settings. */
  memory: MemoryConfig;
  /** Voice / TTS settings. */
  voice: VoiceConfig;
  /** Image generation settings. */
  image: ImageConfig;
  /** Emotion resolution settings. */
  emotion: EmotionConfig;
  /** AI generation parameter overrides. */
  generationParams: GenerationParams;
  /** Selected instruct template format. */
  instructTemplate: InstructTemplate;
  /** Advanced provider-specific overrides. */
  advancedOverrides: AdvancedOverrides;
  /** Auxiliary model assignments for specialised tasks. */
  auxiliaryModels: AuxiliaryModels;
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export type ConfigServiceOptions = BaseFrontendClassOptions;

export type ConfigServiceInterface = BaseFrontendClassInterface & {
  /** Current configuration state. */
  readonly state: ConfigState;
  /** Whether the vault has been loaded from localStorage. */
  readonly isLoaded: boolean;

  /** Loads encrypted vault and plain config from localStorage. */
  load(pin?: string): Promise<void>;
  /** Persists all config to localStorage. */
  save(): Promise<void>;
  /** Clears all stored config. */
  reset(): Promise<void>;

  /** Updates the text provider selection. */
  setTextProvider(provider: TextProvider): void;
  /** Updates the API key for the given text provider. */
  setTextApiKey(provider: string, key: string): void;
  /** Updates the custom URL for the text provider. */
  setTextUrl(url: string): void;
  /** Sets the preferred model identifier. */
  setPreferredModel(model: string): void;
  /** Replaces the full models array. */
  setModels(models: ModelConfig[]): void;
  /** Updates a single model config by index. */
  updateModel(index: number, config: Partial<ModelConfig>): void;
  /** Updates memory config (partial merge). */
  setMemoryConfig(config: Partial<MemoryConfig>): void;
  /** Updates voice config (partial merge). */
  setVoiceConfig(config: Partial<VoiceConfig>): void;
  /** Updates image config (partial merge). */
  setImageConfig(config: Partial<ImageConfig>): void;
  /** Updates emotion config (partial merge). */
  setEmotionConfig(config: Partial<EmotionConfig>): void;
  /** Updates generation parameters (partial merge). */
  setGenerationParams(params: Partial<GenerationParams>): void;
  /** Sets the instruct template. */
  setInstructTemplate(template: InstructTemplate): void;
  /** Updates advanced overrides (partial merge). */
  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void;
  /** Updates auxiliary model assignments (partial merge). */
  setAuxiliaryModels(models: Partial<AuxiliaryModels>): void;

  /**
   * Resolves the active text generation provider from the current
   * configuration state.
   *
   * Throws if no model is configured (neither preferredModel nor models
   * array has an entry).
   */
  getActiveTextProvider(): ResolvedTextProvider;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_KEYS: ApiKeys = {};

const DEFAULT_TEXT_CONFIG: TextConfig = {
  apiKeys: {},
  provider: 'openrouter',
};

const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [];

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  chunkSize: 512,
  contextWindow: 8192,
  embeddingModel: 'minilm',
  longTermMemory: false,
  maxTurns: 50,
  summarizationThreshold: 20,
  type: 'basic',
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  autoSpeech: false,
  engine: 'kokoro',
  pitch: 0,
  provider: 'kokoro',
  speed: 1.0,
  voiceArchetypes: [...DEFAULT_VOICE_ARCHETYPES],
  voiceId: 'af_heart',
};

const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  backend: 'comfyui',
  cfgScale: 7.5,
  checkpoint: 'sd_xl_base_1.0',
  height: 1024,
  provider: 'comfyui',
  steps: 30,
  width: 1024,
};

const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  contextSize: 4096,
  maxTokens: 1024,
  presencePenalty: 0,
  repetitionPenalty: 1.1,
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
};

const DEFAULT_ADVANCED_OVERRIDES: AdvancedOverrides = {
  thinkingLevel: 0,
};

const DEFAULT_AUXILIARY_MODELS: AuxiliaryModels = {
  embedding: undefined,
  summarization: undefined,
  vision: undefined,
};

const DEFAULT_EMOTION_CONFIG: EmotionConfig = {
  method: 'submodel',
};

const DEFAULT_TEMPLATE: InstructTemplate = 'chatml';

const DEFAULT_STATE: ConfigState = {
  advancedOverrides: { ...DEFAULT_ADVANCED_OVERRIDES },
  auxiliaryModels: { ...DEFAULT_AUXILIARY_MODELS },
  emotion: { ...DEFAULT_EMOTION_CONFIG },
  generationParams: { ...DEFAULT_GENERATION_PARAMS },
  image: { ...DEFAULT_IMAGE_CONFIG },
  instructTemplate: DEFAULT_TEMPLATE,
  memory: { ...DEFAULT_MEMORY_CONFIG },
  models: [...DEFAULT_MODEL_CONFIGS],
  preferredModel: '',
  text: { ...DEFAULT_TEXT_CONFIG },
  voice: { ...DEFAULT_VOICE_CONFIG },
};

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const PLAIN_CONFIG_KEY = 'aikami_config';

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class ConfigService
  extends BaseFrontendClass<ConfigServiceOptions>
  implements ConfigServiceInterface
{
  state = $state<ConfigState>({ ...DEFAULT_STATE });
  isLoaded = $state(false);

  private _envDefaultsInjected = false;

  // ── Persistence ───────────────────────────────────────────────────────

  async load(pin?: string): Promise<void> {
    logger.debug('ConfigService.load');

    // 1. Load API keys + text provider from encrypted vault
    const raw = await decrypt({ pin });
    if (raw) {
      try {
        const vault = JSON.parse(raw) as Record<string, unknown>;
        const apiKeys: ApiKeys =
          vault.apiKeys && typeof vault.apiKeys === 'object'
            ? { ...DEFAULT_API_KEYS, ...(vault.apiKeys as ApiKeys) }
            : { ...DEFAULT_API_KEYS };
        const provider: TextProvider =
          typeof vault.textProvider === 'string'
            ? (vault.textProvider as TextProvider)
            : this.state.text.provider;
        const url: string | undefined =
          typeof vault.textUrl === 'string' ? vault.textUrl : this.state.text.url;
        this.state.text = {
          ...DEFAULT_TEXT_CONFIG,
          apiKeys,
          provider,
          url,
        };
      } catch {
        this.warn('load: failed to parse vault JSON');
      }
    }

    // 2. Load non-sensitive config from plain localStorage
    const plain = localStorage.getItem(PLAIN_CONFIG_KEY);
    if (plain) {
      try {
        const parsed = JSON.parse(plain) as Partial<ConfigState>;
        if (parsed.preferredModel !== undefined) {
          this.state.preferredModel = parsed.preferredModel;
        }
        if (parsed.models) {
          this.state.models = parsed.models;
        }
        if (parsed.memory) {
          this.state.memory = { ...DEFAULT_MEMORY_CONFIG, ...parsed.memory };
        }
        if (parsed.voice) {
          this.state.voice = { ...DEFAULT_VOICE_CONFIG, ...parsed.voice };
        }
        if (parsed.image) {
          this.state.image = { ...DEFAULT_IMAGE_CONFIG, ...parsed.image };
        }
        if (parsed.emotion) {
          this.state.emotion = { ...DEFAULT_EMOTION_CONFIG, ...parsed.emotion };
        }
        if (parsed.generationParams) {
          this.state.generationParams = {
            ...DEFAULT_GENERATION_PARAMS,
            ...(parsed.generationParams as Partial<GenerationParams>),
          };
        }
        if (
          typeof parsed.instructTemplate === 'string' &&
          INSTRUCT_TEMPLATES.includes(parsed.instructTemplate as InstructTemplate)
        ) {
          this.state.instructTemplate = parsed.instructTemplate as InstructTemplate;
        }
        if (parsed.advancedOverrides) {
          this.state.advancedOverrides = {
            ...DEFAULT_ADVANCED_OVERRIDES,
            ...(parsed.advancedOverrides as Partial<AdvancedOverrides>),
          };
        }
        if (parsed.auxiliaryModels) {
          this.state.auxiliaryModels = {
            ...DEFAULT_AUXILIARY_MODELS,
            ...(parsed.auxiliaryModels as Partial<AuxiliaryModels>),
          };
        }
      } catch {
        this.warn('load: failed to parse plain config');
      }
    }

    // 3. Inject env defaults when no user config is present
    this._injectEnvDefaults();

    this.isLoaded = true;
  }

  async save(): Promise<void> {
    logger.debug('ConfigService.save');

    // Encrypt sensitive text config (apiKeys, provider, url)
    const vaultPayload = JSON.stringify({
      apiKeys: this.state.text.apiKeys,
      textProvider: this.state.text.provider,
      textUrl: this.state.text.url,
    });
    await encrypt({ text: vaultPayload });

    // Plain config (non-sensitive)
    const plain: Record<string, unknown> = {
      advancedOverrides: this.state.advancedOverrides,
      auxiliaryModels: this.state.auxiliaryModels,
      emotion: this.state.emotion,
      generationParams: this.state.generationParams,
      image: this.state.image,
      instructTemplate: this.state.instructTemplate,
      memory: this.state.memory,
      models: this.state.models,
      preferredModel: this.state.preferredModel,
      voice: this.state.voice,
    };
    localStorage.setItem(PLAIN_CONFIG_KEY, JSON.stringify(plain));
  }

  async reset(): Promise<void> {
    logger.debug('ConfigService.reset');
    this.state = this._makeDefaultState();
    await clearVault();
    localStorage.removeItem(PLAIN_CONFIG_KEY);
  }

  // ── Mutators ──────────────────────────────────────────────────────────

  setTextProvider(provider: TextProvider): void {
    this.state.text.provider = provider;
  }

  setTextApiKey(provider: string, key: string): void {
    this.state.text.apiKeys = { ...this.state.text.apiKeys, [provider]: key };
  }

  setTextUrl(url: string): void {
    this.state.text.url = url;
  }

  setPreferredModel(model: string): void {
    this.state.preferredModel = model;
  }

  setModels(models: ModelConfig[]): void {
    this.state.models = models;
  }

  updateModel(index: number, config: Partial<ModelConfig>): void {
    if (index < 0 || index >= this.state.models.length) {
      return;
    }
    this.state.models = this.state.models.map((m, i) => (i === index ? { ...m, ...config } : m));
  }

  setMemoryConfig(config: Partial<MemoryConfig>): void {
    this.state.memory = { ...this.state.memory, ...config };
  }

  setVoiceConfig(config: Partial<VoiceConfig>): void {
    this.state.voice = { ...this.state.voice, ...config };
  }

  setImageConfig(config: Partial<ImageConfig>): void {
    this.state.image = { ...this.state.image, ...config };
  }

  setEmotionConfig(config: Partial<EmotionConfig>): void {
    this.state.emotion = { ...this.state.emotion, ...config };
  }

  setGenerationParams(params: Partial<GenerationParams>): void {
    this.state.generationParams = { ...this.state.generationParams, ...params };
  }

  setInstructTemplate(template: InstructTemplate): void {
    this.state.instructTemplate = template;
  }

  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void {
    this.state.advancedOverrides = { ...this.state.advancedOverrides, ...overrides };
  }

  setAuxiliaryModels(models: Partial<AuxiliaryModels>): void {
    this.state.auxiliaryModels = { ...this.state.auxiliaryModels, ...models };
  }

  // ── Text provider resolution ─────────────────────────────────────────

  getActiveTextProvider(): ResolvedTextProvider {
    // Lazy env injection — ensures defaults are available even if load()
    // hasn't been called yet (e.g. first render before Config dashboard opens).
    if (!this._envDefaultsInjected) {
      this._envDefaultsInjected = true;
      this._injectEnvDefaults();
    }

    const { text, preferredModel, models } = this.state;
    const provider = text.provider;

    // Endpoint: user-configured URL → models array → provider defaults
    let endpoint = text.url ?? '';

    // Model: preferredModel → models array → provider defaults
    let model = preferredModel;

    if (!model && models.length > 0) {
      // Look for a model matching the current provider first
      const match = models.find((m) => m.provider === provider);
      if (match) {
        model = match.model;
        endpoint = endpoint || match.endpoint || '';
      } else {
        model = models[0].model;
        endpoint = endpoint || models[0].endpoint || '';
      }
    }

    // If we have a model, enrich endpoint from models array if not yet set
    if (model && !endpoint && models.length > 0) {
      const match = models.find((m) => m.model === model);
      if (match) {
        endpoint = match.endpoint || '';
      }
    }

    // Provider-specific defaults for local providers with no saved config
    if (!endpoint) {
      if (provider === 'ollama') {
        endpoint = 'http://localhost:11434/v1';
      } else if (provider === 'ooba') {
        endpoint = 'http://localhost:5000/v1';
      }
    }

    if (!model) {
      // Use provider-appropriate defaults when no preferred model is set
      if (provider === 'ollama') {
        model = 'llama3.2';
      } else if (provider === 'openai') {
        model = 'gpt-4o-mini';
      } else if (provider === 'anthropic') {
        model = 'claude-3-haiku-20240307';
      } else if (provider === 'deepseek') {
        model = 'deepseek-chat';
      } else {
        throw new Error(
          'No text generation provider configured. ' +
            'Open the Config dashboard or set PUBLIC_OPENROUTER_MODEL in your .env file.',
        );
      }
    }

    return {
      model,
      provider,
      endpoint,
      apiKey: text.apiKeys[provider],
    };
  }

  // ── Private: env helpers ─────────────────────────────────────────────

  /** Returns a fresh deep copy of the default state (no shared references). */
  private _makeDefaultState(): ConfigState {
    return {
      advancedOverrides: { ...DEFAULT_ADVANCED_OVERRIDES },
      auxiliaryModels: { ...DEFAULT_AUXILIARY_MODELS },
      emotion: { ...DEFAULT_EMOTION_CONFIG },
      generationParams: { ...DEFAULT_GENERATION_PARAMS },
      image: { ...DEFAULT_IMAGE_CONFIG },
      instructTemplate: DEFAULT_TEMPLATE,
      memory: { ...DEFAULT_MEMORY_CONFIG },
      models: [],
      preferredModel: '',
      text: { apiKeys: {}, provider: 'openrouter' },
      voice: { ...DEFAULT_VOICE_CONFIG },
    };
  }

  /**
   * Injects defaults from environment variables. The preferred model is
   * only injected when no user configuration exists in localStorage, but
   * the API key is always injected from env if available and not already
   * set — this ensures the key survives stale vaults and model-only saves.
   */
  private _injectEnvDefaults(): void {
    const envModel = this._readEnv('PUBLIC_OPENROUTER_MODEL');
    const envKey = this._readEnv('PUBLIC_OPENROUTER_API_KEY');

    if (!this.state.preferredModel && this.state.models.length === 0 && envModel) {
      this.state.preferredModel = envModel;
    }

    if (envKey && !this.state.text.apiKeys.openrouter) {
      this.state.text = {
        ...this.state.text,
        apiKeys: { ...this.state.text.apiKeys, openrouter: envKey },
      };
    }
  }

  /** Safely reads a Vite PUBLIC_* env var. Returns undefined in tests. */
  private _readEnv(name: string): string | undefined {
    try {
      const value = (import.meta.env as Record<string, string | undefined>)[name];
      return value && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

export { ConfigService };

export const configService: ConfigServiceInterface = ConfigService.create({
  className: 'ConfigService',
});
