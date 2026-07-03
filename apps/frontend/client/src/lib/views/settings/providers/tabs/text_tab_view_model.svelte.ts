// apps/frontend/client/src/lib/views/settings/providers/tabs/text_tab_view_model.svelte.ts
//
// ViewModel for the Text provider configuration tab.
// Extracted from providers_view_model.svelte.ts for separation of concerns.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  type AuxiliaryModels,
  type ConfigState,
  configService,
  INSTRUCT_TEMPLATES,
  type InstructTemplate,
  TEXT_PROVIDERS,
  type TextProvider,
} from '$lib/services/config/config_service.svelte';
import {
  fetchOpenRouterModels,
  type OpenRouterModel,
} from '$lib/services/config/openrouter_models';
import {
  buildVerifyHeaders,
  buildVerifyUrl,
  PROVIDER_ENDPOINTS,
} from '$lib/services/config/provider_endpoints';

export type TextTabViewModelInterface = BaseViewModelInterface & {
  readonly config: ConfigState;
  readonly textProvider: string;
  readonly textApiKey: string;
  readonly textUrl: string;
  readonly savedKeys: Record<string, string>;
  readonly selectedProviderLabel: string;
  readonly selectedProviderDescription: string;
  readonly selectedProviderNeedsKey: boolean;
  readonly selectedProviderNeedsUrl: boolean;
  readonly hasOpenRouterKey: boolean;
  readonly isOpenRouterKeyVerified: boolean;
  readonly keyVisible: boolean;
  readonly verificationStatus: Record<string, 'idle' | 'checking' | 'valid' | 'invalid'>;
  readonly availableOpenRouterModels: readonly OpenRouterModel[];
  readonly isFetchingModels: boolean;
  readonly modelSearchQuery: string;
  readonly auxiliaryModels: AuxiliaryModels;
  readonly instructTemplates: readonly string[];

  toggleKeyVisibility(): void;
  setTextProvider(provider: string): void;
  setTextApiKey(provider: string, key: string): void;
  setTextUrl(url: string): void;
  setPreferredModel(model: string): void;
  setModelField(index: number, field: string, value: string): void;
  verifyApiKey(provider: string): Promise<void>;
  fetchModels(): Promise<void>;
  setModelSearchQuery(query: string): void;
  setAuxiliaryModel(task: keyof AuxiliaryModels, modelId: string | undefined): void;
  setInstructTemplate(template: InstructTemplate): void;
  onSaveRequested(): void;
};

class TextTabViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements TextTabViewModelInterface
{
  keyVisible = $state(false);
  verificationStatus: Record<string, 'idle' | 'checking' | 'valid' | 'invalid'> = $state({});
  availableOpenRouterModels: OpenRouterModel[] = $state([]);
  isFetchingModels = $state(false);
  modelSearchQuery = $state('');

  get config(): ConfigState {
    return configService.state;
  }

  get auxiliaryModels(): AuxiliaryModels {
    return configService.state.auxiliaryModels;
  }

  get instructTemplates(): readonly string[] {
    return INSTRUCT_TEMPLATES;
  }

  // ── Computed text provider values (was $derived in the view) ──

  get textProvider(): string {
    return this.config.text.provider;
  }

  get textApiKey(): string {
    return this.config.text.apiKeys[this.textProvider] ?? '';
  }

  get textUrl(): string {
    return this.config.text.url ?? '';
  }

  get savedKeys(): Record<string, string> {
    return this.config.text.apiKeys;
  }

  private get _selectedProvider(): (typeof TEXT_PROVIDERS)[number] {
    return TEXT_PROVIDERS.find((p) => p.id === this.textProvider) ?? TEXT_PROVIDERS[0];
  }

  get selectedProviderLabel(): string {
    return this._selectedProvider.label;
  }

  get selectedProviderDescription(): string {
    return this._selectedProvider.description;
  }

  get selectedProviderNeedsKey(): boolean {
    return this._selectedProvider.needsKey;
  }

  get selectedProviderNeedsUrl(): boolean {
    return (this._selectedProvider as { needsUrl?: boolean }).needsUrl ?? false;
  }

  get hasOpenRouterKey(): boolean {
    return (this.config.text.apiKeys.openrouter?.length ?? 0) > 0;
  }

  get isOpenRouterKeyVerified(): boolean {
    return this.verificationStatus.openrouter === 'valid';
  }

  async initialize(): Promise<void> {
    await configService.load();

    // Auto-detect Ollama: if it's running locally, default to ollama provider
    const keys = configService.state.text.apiKeys;
    const hasNoKeys = Object.values(keys).every((k) => !k);
    if (hasNoKeys) {
      try {
        const res = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok && configService.state.text.provider !== 'ollama') {
          configService.setTextProvider('ollama');
          configService.setTextUrl('http://localhost:11434/v1');
          configService.setPreferredModel('llama3.2');
        }
      } catch {
        // Ollama not running — keep defaults
      }
    }

    await super.initialize();
  }

  toggleKeyVisibility(): void {
    this.keyVisible = !this.keyVisible;
  }

  setTextProvider(provider: string): void {
    configService.setTextProvider(provider as TextProvider);
    this.onSaveRequested();
  }

  setTextApiKey(provider: string, key: string): void {
    configService.setTextApiKey(provider, key);
    this.onSaveRequested();
  }

  setTextUrl(url: string): void {
    configService.setTextUrl(url);
    this.onSaveRequested();
  }

  setPreferredModel(model: string): void {
    configService.setPreferredModel(model);
    this.onSaveRequested();
  }

  setModelField(index: number, field: string, value: string): void {
    configService.updateModel(index, { [field]: value } as Record<string, string>);
    this.onSaveRequested();
  }

  async verifyApiKey(provider: string): Promise<void> {
    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      return;
    }
    const apiKey = configService.state.text.apiKeys[provider];
    if (!apiKey) {
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
      return;
    }
    this.verificationStatus = { ...this.verificationStatus, [provider]: 'checking' };
    try {
      const url = buildVerifyUrl(endpoint, apiKey);
      const headers = buildVerifyHeaders(endpoint, apiKey);
      const response = await fetch(url, { method: endpoint.method, headers });
      this.verificationStatus = {
        ...this.verificationStatus,
        [provider]: response.ok ? 'valid' : 'invalid',
      };
    } catch {
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
    }
  }

  async fetchModels(): Promise<void> {
    const apiKey = configService.state.text.apiKeys.openrouter;
    if (!apiKey) {
      return;
    }
    this.isFetchingModels = true;
    try {
      this.availableOpenRouterModels = await fetchOpenRouterModels(apiKey);
    } finally {
      this.isFetchingModels = false;
    }
  }

  setModelSearchQuery(query: string): void {
    this.modelSearchQuery = query;
  }

  setAuxiliaryModel(task: keyof AuxiliaryModels, modelId: string | undefined): void {
    configService.setAuxiliaryModels({ [task]: modelId || undefined });
    this.onSaveRequested();
  }

  setInstructTemplate(template: InstructTemplate): void {
    configService.setInstructTemplate(template);
    this.onSaveRequested();
  }

  /** Notifies the parent to schedule a debounced save. */
  onSaveRequested(): void {
    // The parent ProvidersViewModel handles the actual save
  }
}

export const getTextTabViewModel = (options: BaseViewModelOptions): TextTabViewModelInterface =>
  TextTabViewModel.create(options);
