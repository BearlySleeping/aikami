// apps/frontend/pwa/src/lib/client/services/settings/ai_settings.svelte.ts
//
// Singleton service managing AI provider configuration and generation
// parameters. API keys are encrypted at rest via the crypto_vault.
// Uses Svelte 5 $state for deep reactivity.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { encrypt, decrypt, clearVault } from '$lib/client/utils/crypto_vault';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** Configuration for a single provider endpoint. */
export type ProviderConfig = {
  /** API key (encrypted at rest, decrypted in memory on load). */
  apiKey: string;
  /** Base URL for the API endpoint. */
  endpoint: string;
  /** Model identifier (e.g. 'deepseek-chat', 'claude-3-opus-20240229'). */
  model: string;
};

/** Provider type categories. */
export const PROVIDER_TYPES = ['openai', 'openrouter', 'anthropic', 'elevenlabs', 'local'] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

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

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export type AISettingsOptions = BaseFrontendClassOptions;

export type AISettingsInterface = BaseFrontendClassInterface & {
  /** Active text generation provider config. */
  readonly textProvider: ProviderConfig;
  /** Active TTS provider config. */
  readonly ttsProvider: ProviderConfig;
  /** Active image generation provider config. */
  readonly imageProvider: ProviderConfig;
  /** Generation parameter overrides. */
  readonly generationParams: GenerationParams;
  /** Advanced overrides. */
  readonly advancedOverrides: AdvancedOverrides;
  /** Selected instruct template. */
  readonly instructTemplate: InstructTemplate;
  /** Whether the vault has been loaded from localStorage. */
  readonly isLoaded: boolean;

  /** Loads the encrypted vault from localStorage. */
  loadFromVault(pin?: string): Promise<void>;
  /** Persists the current state into the encrypted vault. */
  saveToVault(pin?: string): Promise<void>;
  /** Clears the vault and resets to defaults. */
  reset(): Promise<void>;
  /** Updates the text provider configuration. */
  setTextProvider(config: Partial<ProviderConfig>): void;
  /** Updates the TTS provider configuration. */
  setTTSProvider(config: Partial<ProviderConfig>): void;
  /** Updates the image provider configuration. */
  setImageProvider(config: Partial<ProviderConfig>): void;
  /** Updates generation parameters. */
  setGenerationParams(params: Partial<GenerationParams>): void;
  /** Updates advanced overrides. */
  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void;
  /** Sets the instruct template. */
  setInstructTemplate(template: InstructTemplate): void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER: ProviderConfig = {
  apiKey: '',
  endpoint: '',
  model: '',
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

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class AISettingsService
  extends BaseFrontendClass<AISettingsOptions>
  implements AISettingsInterface
{
  textProvider = $state<ProviderConfig>({ ...DEFAULT_PROVIDER });
  ttsProvider = $state<ProviderConfig>({ ...DEFAULT_PROVIDER });
  imageProvider = $state<ProviderConfig>({ ...DEFAULT_PROVIDER });
  generationParams = $state<GenerationParams>({ ...DEFAULT_GENERATION_PARAMS });
  advancedOverrides = $state<AdvancedOverrides>({ ...DEFAULT_ADVANCED_OVERRIDES });
  instructTemplate = $state<InstructTemplate>(DEFAULT_TEMPLATE);
  isLoaded = $state(false);

  async loadFromVault(pin?: string): Promise<void> {
    this.debug('loadFromVault');

    const raw = await decrypt({ pin });
    if (!raw) {
      this.isLoaded = true;
      return;
    }

    try {
      const data = JSON.parse(raw) as Record<string, unknown>;

      if (data.textProvider && typeof data.textProvider === 'object') {
        this.textProvider = { ...DEFAULT_PROVIDER, ...(data.textProvider as Partial<ProviderConfig>) };
      }
      if (data.ttsProvider && typeof data.ttsProvider === 'object') {
        this.ttsProvider = { ...DEFAULT_PROVIDER, ...(data.ttsProvider as Partial<ProviderConfig>) };
      }
      if (data.imageProvider && typeof data.imageProvider === 'object') {
        this.imageProvider = { ...DEFAULT_PROVIDER, ...(data.imageProvider as Partial<ProviderConfig>) };
      }
      if (data.generationParams && typeof data.generationParams === 'object') {
        this.generationParams = {
          ...DEFAULT_GENERATION_PARAMS,
          ...(data.generationParams as Partial<GenerationParams>),
        };
      }
      if (data.advancedOverrides && typeof data.advancedOverrides === 'object') {
        this.advancedOverrides = {
          ...DEFAULT_ADVANCED_OVERRIDES,
          ...(data.advancedOverrides as Partial<AdvancedOverrides>),
        };
      }
      if (
        typeof data.instructTemplate === 'string' &&
        INSTRUCT_TEMPLATES.includes(data.instructTemplate as InstructTemplate)
      ) {
        this.instructTemplate = data.instructTemplate as InstructTemplate;
      }
    } catch (err) {
      this.warn('loadFromVault: failed to parse vault JSON', err);
    }

    this.isLoaded = true;
  }

  async saveToVault(pin?: string): Promise<void> {
    this.debug('saveToVault');

    const payload = JSON.stringify({
      advancedOverrides: this.advancedOverrides,
      generationParams: this.generationParams,
      imageProvider: this.imageProvider,
      instructTemplate: this.instructTemplate,
      textProvider: this.textProvider,
      ttsProvider: this.ttsProvider,
    });

    await encrypt({ pin, text: payload });
  }

  async reset(): Promise<void> {
    this.debug('reset');

    this.textProvider = { ...DEFAULT_PROVIDER };
    this.ttsProvider = { ...DEFAULT_PROVIDER };
    this.imageProvider = { ...DEFAULT_PROVIDER };
    this.generationParams = { ...DEFAULT_GENERATION_PARAMS };
    this.advancedOverrides = { ...DEFAULT_ADVANCED_OVERRIDES };
    this.instructTemplate = DEFAULT_TEMPLATE;
    await clearVault();
  }

  setTextProvider(config: Partial<ProviderConfig>): void {
    this.textProvider = { ...this.textProvider, ...config };
  }

  setTTSProvider(config: Partial<ProviderConfig>): void {
    this.ttsProvider = { ...this.ttsProvider, ...config };
  }

  setImageProvider(config: Partial<ProviderConfig>): void {
    this.imageProvider = { ...this.imageProvider, ...config };
  }

  setGenerationParams(params: Partial<GenerationParams>): void {
    this.generationParams = { ...this.generationParams, ...params };
  }

  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void {
    this.advancedOverrides = { ...this.advancedOverrides, ...overrides };
  }

  setInstructTemplate(template: InstructTemplate): void {
    this.instructTemplate = template;
  }
}

export const aiSettingsService: AISettingsInterface = new AISettingsService({
  className: 'AISettingsService',
});
