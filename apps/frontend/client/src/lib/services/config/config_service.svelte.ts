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

/** Supported API key provider identifiers. */
export const API_KEY_PROVIDERS = [
  'openrouter',
  'gemini',
  'anthropic',
  'openai',
  'deepseek',
] as const;

export type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/** Map of provider → API key string. */
export type ApiKeys = Partial<Record<ApiKeyProvider, string>>;

/** Memory subsystem configuration. */
export type MemoryConfig = {
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum number of conversation turns to retain. */
  maxTurns: number;
  /** Summarization threshold (turns before summarisation kicks in). */
  summarizationThreshold: number;
  /** Whether long-term memory (vector store) is enabled. */
  longTermMemory: boolean;
};

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

/** Voice / TTS subsystem configuration. */
export type VoiceConfig = {
  /** Selected TTS engine (e.g. 'kokoro', 'elevenlabs'). */
  engine: string;
  /** Voice style or speaker ID. */
  voiceId: string;
  /** Speech rate multiplier (0.5–2.0). */
  speed: number;
  /** Pitch adjustment (-20–20). */
  pitch: number;
  /** User-editable voice archetype → Kokoro ID mappings. */
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

/** Image generation subsystem configuration. */
export type ImageConfig = {
  /** Selected image generation backend. */
  backend: string;
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
  /** Repetition penalty (1–2). */
  repetitionPenalty: number;
  /** Maximum tokens to generate. */
  maxTokens: number;
  /** Maximum context window size in tokens. */
  contextSize: number;
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
  /** Encrypted API keys per provider. */
  apiKeys: ApiKeys;
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
  /** AI generation parameter overrides. */
  generationParams: GenerationParams;
  /** Selected instruct template format. */
  instructTemplate: InstructTemplate;
  /** Advanced provider-specific overrides. */
  advancedOverrides: AdvancedOverrides;
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

  /** Updates API keys. */
  setApiKeys(keys: Partial<ApiKeys>): void;
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
  /** Updates generation parameters (partial merge). */
  setGenerationParams(params: Partial<GenerationParams>): void;
  /** Sets the instruct template. */
  setInstructTemplate(template: InstructTemplate): void;
  /** Updates advanced overrides (partial merge). */
  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void;

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

const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [];

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  contextWindow: 8192,
  longTermMemory: false,
  maxTurns: 50,
  summarizationThreshold: 20,
};

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  engine: 'kokoro',
  pitch: 0,
  speed: 1.0,
  voiceArchetypes: [...DEFAULT_VOICE_ARCHETYPES],
  voiceId: 'af_heart',
};

const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  backend: 'comfyui',
  cfgScale: 7.5,
  checkpoint: 'sd_xl_base_1.0',
  height: 1024,
  steps: 30,
  width: 1024,
};

const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  contextSize: 4096,
  maxTokens: 1024,
  repetitionPenalty: 1.1,
  temperature: 0.7,
  topP: 0.9,
};

const DEFAULT_ADVANCED_OVERRIDES: AdvancedOverrides = {
  thinkingLevel: 0,
};

const DEFAULT_TEMPLATE: InstructTemplate = 'chatml';

const DEFAULT_STATE: ConfigState = {
  advancedOverrides: { ...DEFAULT_ADVANCED_OVERRIDES },
  apiKeys: { ...DEFAULT_API_KEYS },
  generationParams: { ...DEFAULT_GENERATION_PARAMS },
  image: { ...DEFAULT_IMAGE_CONFIG },
  instructTemplate: DEFAULT_TEMPLATE,
  memory: { ...DEFAULT_MEMORY_CONFIG },
  models: [...DEFAULT_MODEL_CONFIGS],
  preferredModel: '',
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

    // 1. Load API keys from encrypted vault
    const raw = await decrypt({ pin });
    if (raw) {
      try {
        const vault = JSON.parse(raw) as Record<string, unknown>;
        if (vault.apiKeys && typeof vault.apiKeys === 'object') {
          this.state.apiKeys = { ...DEFAULT_API_KEYS, ...(vault.apiKeys as ApiKeys) };
        }
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

    // Encrypt API keys
    const vaultPayload = JSON.stringify({ apiKeys: this.state.apiKeys });
    await encrypt({ text: vaultPayload });

    // Plain config (non-sensitive)
    const plain: Record<string, unknown> = {
      advancedOverrides: this.state.advancedOverrides,
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
    this.state = { ...DEFAULT_STATE };
    await clearVault();
    localStorage.removeItem(PLAIN_CONFIG_KEY);
  }

  // ── Mutators ──────────────────────────────────────────────────────────

  setApiKeys(keys: Partial<ApiKeys>): void {
    this.state.apiKeys = { ...this.state.apiKeys, ...keys };
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

  setGenerationParams(params: Partial<GenerationParams>): void {
    this.state.generationParams = { ...this.state.generationParams, ...params };
  }

  setInstructTemplate(template: InstructTemplate): void {
    this.state.instructTemplate = template;
  }

  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void {
    this.state.advancedOverrides = { ...this.state.advancedOverrides, ...overrides };
  }

  // ── Text provider resolution ─────────────────────────────────────────

  getActiveTextProvider(): ResolvedTextProvider {
    // Lazy env injection — ensures defaults are available even if load()
    // hasn't been called yet (e.g. first render before Config dashboard opens).
    if (!this._envDefaultsInjected) {
      this._envDefaultsInjected = true;
      this._injectEnvDefaults();
    }

    const { preferredModel, models } = this.state;

    let model = preferredModel;
    let provider = 'openrouter';
    let endpoint = '';

    if (model && models.length > 0) {
      const match = models.find((m) => m.model === model);
      if (match) {
        provider = match.provider || 'openrouter';
        endpoint = match.endpoint || '';
      }
    } else if (models.length > 0) {
      model = models[0].model;
      provider = models[0].provider || 'openrouter';
      endpoint = models[0].endpoint || '';
    }

    if (!model) {
      throw new Error(
        'No text generation provider configured. ' +
          'Open the Config dashboard or set PUBLIC_OPENROUTER_MODEL in your .env file.',
      );
    }

    return {
      model,
      provider,
      endpoint,
      apiKey: this.state.apiKeys[provider as ApiKeyProvider],
    };
  }

  // ── Private: env helpers ─────────────────────────────────────────────

  /**
   * Injects defaults from environment variables. The preferred model is
   * only injected when no user configuration exists in localStorage, but
   * the API key is always injected from env if available and not already
   * set — this ensures the key survives stale vaults and model-only saves.
   */
  private _injectEnvDefaults(): void {
    const envModel = this._readEnv('PUBLIC_OPENROUTER_MODEL');
    const envKey = this._readEnv('PUBLIC_OPENROUTER_API_KEY');

    // Only inject the model from env when no user config has been saved.
    if (!this.state.preferredModel && this.state.models.length === 0 && envModel) {
      this.state.preferredModel = envModel;
    }

    // Always inject the API key from env when available and not already set.
    if (envKey && !this.state.apiKeys.openrouter) {
      this.state.apiKeys = { ...this.state.apiKeys, openrouter: envKey };
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
