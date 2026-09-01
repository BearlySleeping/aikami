// apps/frontend/client/src/lib/views/settings/providers/tabs/text_tab_view_model.svelte.ts
//
// ViewModel for the Text provider configuration tab.
// Extracted from providers_view_model.svelte.ts for separation of concerns.

import {
  buildVerifyHeaders,
  buildVerifyUrl,
  PROVIDER_ENDPOINTS,
  TEXT_PROVIDERS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ConfigState, OpenRouterModel } from '@aikami/types';
import { configService, fetchOpenRouterModels, getOllamaRuntimeEndpoints } from '$services';
import { type AuxiliaryModels, INSTRUCT_TEMPLATES, type InstructTemplate } from '$types';

export type TextTabViewModelOptions = BaseViewModelOptions;

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
  readonly textProviders: typeof TEXT_PROVIDERS;

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

  get textProviders(): typeof TEXT_PROVIDERS {
    return TEXT_PROVIDERS;
  }

  // ── Computed text provider values (was $derived in the view) ──

  get textProvider(): string {
    return this.config.text.provider;
  }

  get textApiKey(): string {
    return configService.getApiKey(this.textProvider) ?? '';
  }

  get textUrl(): string {
    // C-230: custom URLs live on connections (baseUrl) — legacy text.url removed.
    // Match the ACTIVE provider so switching providers reads the right connection.
    return (
      this.config.connections.find(
        (c) => (c.capability ?? 'text') === 'text' && c.provider === this.textProvider,
      )?.baseUrl ?? ''
    );
  }

  get savedKeys(): Record<string, string> {
    // C-230: API keys live in connections[] — derive the legacy-shaped
    // provider → key map from text-capability connections.
    const keys: Record<string, string> = {};
    for (const c of this.config.connections) {
      if ((c.capability ?? 'text') === 'text' && c.apiKey) {
        keys[c.provider] = c.apiKey;
      }
    }
    return keys;
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
    return (configService.getApiKey('openrouter')?.length ?? 0) > 0;
  }

  get isOpenRouterKeyVerified(): boolean {
    return this.verificationStatus.openrouter === 'valid';
  }

  async initialize(): Promise<void> {
    await configService.load();

    // Auto-detect Ollama: probe the runtime-configured text engine (C-389)
    // instead of a hardcoded localhost port. No engine configured → skip.
    const keys = this.savedKeys;
    const hasNoKeys = Object.values(keys).every((k) => !k);
    const isOllamaProvider = configService.state.text.provider === 'ollama';
    if (hasNoKeys || isOllamaProvider) {
      const ollamaTagsUrl = getOllamaRuntimeEndpoints().url;
      if (ollamaTagsUrl) {
        try {
          const res = await fetch(ollamaTagsUrl, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            let needsSave = false;
            if (!isOllamaProvider) {
              configService.setTextProvider('ollama');
              needsSave = true;
            }
            const textUrl = this.config.connections.find(
              (c) => (c.capability ?? 'text') === 'text' && c.provider === 'ollama',
            )?.baseUrl;
            if (!textUrl) {
              const ollamaBase = getOllamaRuntimeEndpoints()
                .chatTestUrl?.replace(/\/api\/chat$/, '')
                .replace(/\/+$/, '');
              if (ollamaBase) {
                this.setTextUrl(ollamaBase);
                needsSave = true;
              }
            }
            if (
              !configService.state.preferredModel ||
              configService.state.preferredModel.startsWith('openrouter/')
            ) {
              // No default model — user must configure via Connections
              needsSave = true;
            }
            if (needsSave) {
              await configService.save();
            }
          }
        } catch {
          // Ollama not running — keep defaults
        }
      }
    }

    await super.initialize();
  }

  toggleKeyVisibility(): void {
    this.keyVisible = !this.keyVisible;
  }

  setTextProvider(provider: string): void {
    configService.setTextProvider(provider);
    this.onSaveRequested();
  }

  /**
   * Legacy text-tab setter. API keys are managed via Connections (C-230) —
   * write through to the matching text connection when one exists.
   */
  setTextApiKey(provider: string, key: string): void {
    const connection = configService.state.connections.find(
      (c) => (c.capability ?? 'text') === 'text' && c.provider === provider,
    );
    if (connection) {
      configService.updateConnection(connection.id, { apiKey: key });
    } else {
      this.warn('setTextApiKey:no-connection', { provider });
    }
    this.onSaveRequested();
  }

  /** Legacy text-tab setter — mirrors setTextApiKey for the custom URL. */
  setTextUrl(url: string): void {
    const connection = configService.state.connections.find(
      (c) => (c.capability ?? 'text') === 'text' && c.provider === this.textProvider,
    );
    if (connection) {
      configService.updateConnection(connection.id, { baseUrl: url });
    } else {
      // Resolve-or-create: no connection for the active provider yet —
      // create one so the URL (e.g. the auto-detected Ollama endpoint)
      // is persisted instead of being dropped.
      configService.addConnection({
        provider: this.textProvider,
        capability: 'text',
        name: this._selectedProvider.label,
        apiKey: '',
        baseUrl: url,
        model: '',
        generationParams: { ...configService.state.generationParams },
        isDefault: false,
        source: 'stored',
      });
    }
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
    const apiKey = configService.getApiKey(provider);
    if (!apiKey) {
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
      return;
    }
    this.verificationStatus = { ...this.verificationStatus, [provider]: 'checking' };
    try {
      const url = buildVerifyUrl({ endpoint, apiKey });
      const headers = buildVerifyHeaders({ endpoint, apiKey });
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
    const apiKey = configService.getApiKey('openrouter');
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

  /** Persists text config changes immediately to the encrypted vault. */
  onSaveRequested(): void {
    configService.save();
  }
}

export const getTextTabViewModel = (options: BaseViewModelOptions): TextTabViewModelInterface =>
  TextTabViewModel.create(options);
