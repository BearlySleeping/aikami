// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.dev.svelte.ts
//
// Dev-only fixture lifecycle for the AI settings sandbox.

import type { BaseViewModelOptions } from '@aikami/frontend/services';
import { configService } from '$services';
import {
  AiSettingsViewModel,
  type AiSettingsViewModelInterface,
} from './ai_settings_view_model.svelte';

type AiSettingsFixture = 'zero' | 'one' | 'several' | 'three-models' | 'bad-key';

const FIXTURE_LABELS: ReadonlyArray<{ id: AiSettingsFixture; label: string }> = [
  { id: 'zero', label: '0 connections' },
  { id: 'one', label: '1 connection' },
  { id: 'several', label: 'Several providers' },
  { id: 'three-models', label: '3 models' },
  { id: 'bad-key', label: 'Bad key' },
];

/** Dev controls exposed alongside the production AI settings contract. */
export type AiSettingsDevViewModelInterface = AiSettingsViewModelInterface & {
  readonly fixture: AiSettingsFixture;
  readonly isSeeding: boolean;
  readonly fixtureOptions: ReadonlyArray<{
    id: AiSettingsFixture;
    label: string;
    buttonClass: string;
  }>;
  selectFixture(fixture: AiSettingsFixture): Promise<void>;
};

class AiSettingsDevViewModel
  extends AiSettingsViewModel
  implements AiSettingsDevViewModelInterface
{
  fixture = $state<AiSettingsFixture>('zero');
  isSeeding = $state(false);

  get fixtureOptions(): AiSettingsDevViewModelInterface['fixtureOptions'] {
    return FIXTURE_LABELS.map((option) => ({
      ...option,
      buttonClass: this.fixture === option.id ? 'btn-primary' : 'btn-ghost',
    }));
  }

  override async initialize(): Promise<void> {
    await configService.load();
    await this._seedConnections(this.fixture);
  }

  async selectFixture(fixture: AiSettingsFixture): Promise<void> {
    this.fixture = fixture;
    await this._seedConnections(fixture);
  }

  private async _seedConnections(fixture: AiSettingsFixture): Promise<void> {
    this.isSeeding = true;
    try {
      for (const connection of configService.getAiConnections()) {
        configService.deleteAiConnection(connection.id);
      }
      for (const provider of configService.getProviders()) {
        configService.deleteProvider(provider.id);
      }

      if (fixture === 'one') {
        this._seedOneConnection();
      } else if (fixture === 'several') {
        this._seedSeveralProviders();
      } else if (fixture === 'three-models') {
        this._seedThreeModels();
      } else if (fixture === 'bad-key') {
        this._seedBadKey();
      }

      await configService.save();
      await super.initialize();
    } finally {
      this.isSeeding = false;
    }
  }

  private _seedOneConnection(): void {
    const providerId = configService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
      source: 'stored',
    });
    this._addTextConnection({
      providerId,
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      maxTokens: 2048,
      temperature: 0.7,
    });
  }

  private _seedSeveralProviders(): void {
    const openRouterProviderId = configService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
      source: 'stored',
    });
    this._addTextConnection({
      providerId: openRouterProviderId,
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      maxTokens: 2048,
      temperature: 0.7,
    });
    this._addTextConnection({
      providerId: openRouterProviderId,
      label: 'Haiku',
      model: 'anthropic/claude-haiku',
      maxTokens: 1024,
      temperature: 0.5,
    });

    const kokoroProviderId = configService.addProvider({
      registryId: 'kokoro',
      label: 'Kokoro',
      source: 'stored',
    });
    configService.addAiConnection({
      providerId: kokoroProviderId,
      capability: 'voice',
      label: 'Kokoro TTS',
      model: 'kokoro',
      params: { voiceId: 'af_bella', speed: 1, pitch: 0 },
    });
    const narrationConnection = configService.getAiConnections()[0];
    if (narrationConnection) {
      configService.setRoleAssignment('narration', narrationConnection.id);
    }
  }

  private _seedThreeModels(): void {
    const providerId = configService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
      source: 'stored',
    });
    this._addTextConnection({
      providerId,
      label: 'Opus',
      model: 'anthropic/claude-opus',
      maxTokens: 2048,
      temperature: 0.7,
    });
    this._addTextConnection({
      providerId,
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      maxTokens: 2048,
      temperature: 0.7,
    });
    this._addTextConnection({
      providerId,
      label: 'Haiku',
      model: 'anthropic/claude-haiku',
      maxTokens: 1024,
      temperature: 0.5,
    });
  }

  private _seedBadKey(): void {
    const providerId = configService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-invalid-key',
      source: 'stored',
    });
    this._addTextConnection({
      providerId,
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      maxTokens: 2048,
      temperature: 0.7,
    });
  }

  private _addTextConnection(options: {
    providerId: string;
    label: string;
    model: string;
    maxTokens: number;
    temperature: number;
  }): void {
    configService.addAiConnection({
      providerId: options.providerId,
      capability: 'text',
      label: options.label,
      model: options.model,
      params: {
        temperature: options.temperature,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: options.maxTokens,
        contextSize: 4096,
      },
    });
  }
}

/** Creates the AI settings sandbox ViewModel with dev fixture controls. */
export const getAiSettingsDevViewModel = (
  options: BaseViewModelOptions,
): AiSettingsDevViewModelInterface => AiSettingsDevViewModel.create(options);
