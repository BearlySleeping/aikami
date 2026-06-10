// apps/frontend/pwa/src/lib/services/config/config_service.svelte.ts
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
};

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
}

export { ConfigService };

export const configService: ConfigServiceInterface = ConfigService.create({
  className: 'ConfigService',
});
