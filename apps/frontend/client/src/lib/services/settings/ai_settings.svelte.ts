// apps/frontend/client/src/lib/services/settings/ai_settings.svelte.ts
//
// Singleton service managing AI provider configuration and generation
// parameters. API keys are encrypted at rest via the crypto_vault.
// Uses Svelte 5 $state for deep reactivity.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { type AdvancedOverrides, configService } from '$services';
import type { GenerationParams, InstructTemplate } from '$types';

// ── Types ──────────────────────────────────────────────────────────────

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

// ── Service interface ──────────────────────────────────────────────────

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

  // ── Proxied state from ConfigService ─────────────────────────────────

  get generationParams(): GenerationParams {
    return configService.state.generationParams;
  }

  get advancedOverrides(): AdvancedOverrides {
    return configService.state.advancedOverrides;
  }

  get instructTemplate(): InstructTemplate {
    return configService.state.instructTemplate;
  }

  get isLoaded(): boolean {
    return configService.isLoaded;
  }

  // ── Persistence (delegated to ConfigService) ─────────────────────────

  async loadFromVault(_pin?: string): Promise<void> {
    await configService.load();

    // Sync provider configs from the central config state
    if (configService.state.text.apiKeys.openrouter) {
      this.textProvider = {
        ...this.textProvider,
        apiKey: configService.state.text.apiKeys.openrouter,
      };
    }
    if (configService.state.preferredModel) {
      this.textProvider = {
        ...this.textProvider,
        model: configService.state.preferredModel,
      };
    }
  }

  async saveToVault(_pin?: string): Promise<void> {
    // Sync provider API keys back to central config
    if (this.textProvider.apiKey) {
      configService.setTextApiKey('openrouter', this.textProvider.apiKey);
    }
    if (this.textProvider.model) {
      configService.setPreferredModel(this.textProvider.model);
    }
    if (this.textProvider.endpoint) {
      // Store as a model config entry if not already present
      const existing = configService.state.models;
      const found = existing.some(
        (m) => m.model === this.textProvider.model && m.provider === 'openrouter',
      );
      if (!found && this.textProvider.model && this.textProvider.endpoint) {
        configService.setModels([
          ...existing,
          {
            endpoint: this.textProvider.endpoint,
            model: this.textProvider.model,
            provider: 'openrouter',
          },
        ]);
      }
    }
    await configService.save();
  }

  async reset(): Promise<void> {
    this.textProvider = { ...DEFAULT_PROVIDER };
    this.ttsProvider = { ...DEFAULT_PROVIDER };
    this.imageProvider = { ...DEFAULT_PROVIDER };
    await configService.reset();
  }

  // ── Mutators ─────────────────────────────────────────────────────────

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
    configService.setGenerationParams(params);
  }

  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void {
    configService.setAdvancedOverrides(overrides);
  }

  setInstructTemplate(template: InstructTemplate): void {
    configService.setInstructTemplate(template);
  }
}

export const aiSettingsService: AISettingsInterface = AISettingsService.create({
  className: 'AISettingsService',
});
