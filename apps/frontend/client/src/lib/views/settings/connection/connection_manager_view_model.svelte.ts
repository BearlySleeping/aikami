// apps/frontend/client/src/lib/views/settings/connection/connection_manager_view_model.svelte.ts
//
// ViewModel for the Connection Manager — CRUD, testing, preset management,
// model fetching, provider caching, and per-chat assignment (C-230).

import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  buildVerifyHeaders,
  buildVerifyUrl,
  configService,
  type FetchedModel,
  fetchModelsFromProvider,
  IMAGE_PROVIDERS,
  PROVIDER_ENDPOINTS,
  PROVIDER_MODEL_FETCH,
  VOICE_PROVIDERS,
} from '$services';
import type { Connection, ConnectionCapability, ConnectionId, ConnectionTestResult } from '$types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ConnectionManagerViewModelInterface = BaseViewModelInterface & {
  readonly connections: readonly Connection[];
  readonly editingConnectionId: ConnectionId | undefined;
  readonly draft: Partial<Connection>;
  readonly testResults: Record<ConnectionId, ConnectionTestResult>;
  readonly testingIds: Set<ConnectionId>;
  readonly defaultConnectionId: ConnectionId | null;
  readonly isEditorOpen: boolean;
  readonly isEditing: boolean;
  readonly showApiKey: boolean;
  readonly presetName: string;
  readonly isTestingDraft: boolean;
  readonly draftTestResult: ConnectionTestResult | undefined;
  readonly isTestingDraftModel: boolean;
  readonly draftModelTestResult: ConnectionTestResult | undefined;
  readonly isFetchingModels: boolean;
  readonly modelOptions: readonly FetchedModel[];
  readonly canFetchModels: boolean;
  readonly isModelCustom: boolean;
  /** Human-readable capability label for the editor header. */
  readonly capabilityLabel: string;
  /** Whether to show the generation params section (text only). */
  readonly showGenerationParams: boolean;
  /** Whether model testing is supported (text only). */
  readonly canTestModel: boolean;
  readonly providerLabels: Record<string, string>;
  readonly providerOptions: ReadonlyArray<{ id: string; label: string }>;
  readonly needsApiKey: boolean;
  readonly needsUrl: boolean;
  /** True when the draft provider runs locally (no API key, no cloud auth). */
  readonly isLocalProvider: boolean;
  /** Whether to show the local (Ollama) web setup guide. */
  readonly showLocalGuide: boolean;
  /** Live probe result for the selected local provider (Ollama). */
  readonly localProviderStatus:
    | { checking: boolean; ok: boolean; error?: string; latencyMs?: number; modelCount?: number }
    | undefined;
  readonly draftParams: Connection['generationParams'];
  readonly presetOptions: ReadonlyArray<{ id: string; name: string }>;
  readonly formattedParams: {
    temperature: string;
    topP: string;
    topK: string;
    repetitionPenalty: string;
    maxTokens: string;
  };

  openCreate(): void;
  /** Opens the editor pre-set for a specific capability (text/image/voice). */
  openCreateFor(capability: ConnectionCapability): void;
  openEdit(id: ConnectionId): void;
  cancelEdit(): void;
  setDraftField(field: keyof Connection, value: unknown): void;
  /** Sets the provider, swapping cached apiKey/model and clearing the model. */
  setProvider(provider: string): void;
  saveDraft(): void;
  deleteConnection(id: ConnectionId): void;
  duplicateConnection(id: ConnectionId): void;
  setDefault(id: ConnectionId): void;
  testConnection(id: ConnectionId): Promise<void>;
  applyPreset(presetId: string): void;
  savePreset(name: string): void;
  deletePreset(id: string): void;
  toggleApiKeyVisibility(): void;
  setPresetName(value: string): void;
  savePresetFromInput(): void;
  testDraftConnection(): Promise<void>;
  testDraftModel(): Promise<void>;
  fetchModels(): Promise<void>;
  /** Probes the selected local provider (Ollama) — triggers the browser's local-network prompt. */
  checkLocalProvider(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ConnectionManagerViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 15_000;
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';

/**
 * Local providers that get a live probe + web setup guide when selected.
 * Probing localhost from an HTTPS origin triggers the browser's Private
 * Network Access permission prompt — that's intentional and user-initiated.
 */
const LOCAL_GUIDE_PROVIDERS = new Set(['ollama']);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class ConnectionManagerViewModel
  extends BaseViewModel<ConnectionManagerViewModelOptions>
  implements ConnectionManagerViewModelInterface
{
  editingConnectionId: ConnectionId | undefined = $state(undefined);
  isEditorOpen = $state(false);
  showApiKey = $state(false);
  presetName = $state('');
  testResults: Record<ConnectionId, ConnectionTestResult> = $state({});
  testingIds: Set<ConnectionId> = $state(new Set());
  draft: Partial<Connection> = $state({});
  isTestingDraft = $state(false);
  draftTestResult: ConnectionTestResult | undefined = $state(undefined);
  isTestingDraftModel = $state(false);
  draftModelTestResult: ConnectionTestResult | undefined = $state(undefined);
  isFetchingModels = $state(false);
  localProviderStatus:
    | { checking: boolean; ok: boolean; error?: string; latencyMs?: number; modelCount?: number }
    | undefined = $state(undefined);
  private _availableModels: FetchedModel[] = $state([]);
  private _providerCache: Record<string, { apiKey: string; model: string }> = {};

  // ── Proxied state ─────────────────────────────────────────────────────

  get connections(): readonly Connection[] {
    return configService.state.connections;
  }

  get defaultConnectionId(): ConnectionId | null {
    return configService.state.defaultConnectionId;
  }

  get providerLabels(): Record<string, string> {
    const providers = this._capabilityProviders();
    const labels: Record<string, string> = {};
    for (const p of providers) {
      labels[p.id] = p.label;
    }
    return labels;
  }

  get providerOptions(): ReadonlyArray<{ id: string; label: string }> {
    return this._capabilityProviders().map((p) => ({
      id: p.id,
      label: `${p.label} — ${p.description}`,
    }));
  }

  get isEditing(): boolean {
    return this.editingConnectionId !== undefined;
  }

  get needsApiKey(): boolean {
    const provider = this.draft.provider ?? 'openrouter';
    const desc = this._capabilityProviders().find((p) => p.id === provider);
    if (!desc) {
      return true;
    }
    // Local providers never need an API key — hide the field entirely.
    return !desc.isLocal && desc.needsKey;
  }

  get needsUrl(): boolean {
    const capability = this.draft.capability ?? 'text';
    const provider = this.draft.provider ?? 'openrouter';
    if (capability === 'image') {
      return ['comfyui', 'webui', 'openai-compat'].includes(provider);
    }
    if (capability === 'voice') {
      return ['kokoro', 'voicevox', 'fish-speech'].includes(provider);
    }
    return ['ollama', 'ooba', 'custom'].includes(provider);
  }

  /** True when the draft provider runs locally (no API key, no cloud auth). */
  get isLocalProvider(): boolean {
    const provider = this.draft.provider ?? 'openrouter';
    return this._capabilityProviders().find((p) => p.id === provider)?.isLocal ?? false;
  }

  /** Whether to show the local provider (Ollama) web setup guide. */
  get showLocalGuide(): boolean {
    return LOCAL_GUIDE_PROVIDERS.has(this.draft.provider ?? '');
  }

  get draftParams(): Connection['generationParams'] {
    return this.draft.generationParams ?? configService.state.generationParams;
  }

  get presetOptions(): ReadonlyArray<{ id: string; name: string }> {
    return configService.state.presets.map((p) => ({ id: p.id, name: p.name }));
  }

  get formattedParams() {
    const p = this.draftParams;
    return {
      temperature: p.temperature.toFixed(2),
      topP: p.topP.toFixed(2),
      topK: String(p.topK),
      repetitionPenalty: p.repetitionPenalty.toFixed(2),
      maxTokens: String(p.maxTokens),
    };
  }

  get modelOptions(): readonly FetchedModel[] {
    return this._availableModels;
  }

  get canFetchModels(): boolean {
    return (this.draft.provider ?? 'openrouter') in PROVIDER_MODEL_FETCH;
  }

  /** True when the user selected "— Custom —" in the model dropdown. */
  get isModelCustom(): boolean {
    return this.draft.model === '__custom__';
  }

  /** Human-readable capability label (e.g. "Text", "Image", "Voice"). */
  get capabilityLabel(): string {
    const capability = this.draft.capability ?? 'text';
    if (capability === 'image') {
      return 'Image';
    }
    if (capability === 'voice') {
      return 'Voice';
    }
    return 'Text';
  }

  /** Show generation params section only for text connections. */
  get showGenerationParams(): boolean {
    return (this.draft.capability ?? 'text') === 'text';
  }

  /** Model testing is only supported for text connections currently. */
  get canTestModel(): boolean {
    return (this.draft.capability ?? 'text') === 'text';
  }

  // ── Private: capability-aware helpers ─────────────────────────────────

  /**
   * Returns the provider registry for the draft's current capability.
   * Falls back to TEXT_PROVIDERS for backward compatibility.
   */
  private _capabilityProviders(capabilityOverride?: ConnectionCapability): ReadonlyArray<{
    id: string;
    label: string;
    description: string;
    needsKey: boolean;
    needsUrl?: boolean;
    isLocal: boolean;
  }> {
    const capability = capabilityOverride ?? this.draft.capability ?? 'text';
    if (capability === 'image') {
      return IMAGE_PROVIDERS.map((p) => ({
        ...p,
        needsKey: p.id !== 'comfyui' && p.id !== 'webui',
        needsUrl: p.id === 'comfyui' || p.id === 'webui' || p.id === 'openai-compat',
        isLocal: p.id === 'comfyui' || p.id === 'webui',
      }));
    }
    if (capability === 'voice') {
      return VOICE_PROVIDERS.map((p) => ({
        ...p,
        needsKey: p.id === 'elevenlabs' || p.id === 'openai',
        needsUrl: p.id === 'kokoro' || p.id === 'voicevox' || p.id === 'fish-speech',
        isLocal: p.id === 'kokoro' || p.id === 'voicevox' || p.id === 'fish-speech',
      }));
    }
    return TEXT_PROVIDERS;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.debug('initialize');
    await configService.load();
    await super.initialize();
  }

  // ── Editor management ────────────────────────────────────────────────

  openCreate(): void {
    this.debug('openCreate');
    this._providerCache = {};
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
    this.editingConnectionId = undefined;
    this.isEditorOpen = true;
    const provider = 'openrouter';
    this.draft = {
      apiKey: '',
      baseUrl: '',
      capability: 'text',
      generationParams: { ...configService.state.generationParams },
      isDefault: false,
      model: '',
      // Name is optional — default it to the selected provider's label.
      name: this._capabilityProviders('text').find((p) => p.id === provider)?.label ?? provider,
      provider,
    };
    this.localProviderStatus = undefined;
  }

  openCreateFor(capability: ConnectionCapability): void {
    this.debug('openCreateFor', { capability });
    this._providerCache = {};
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
    this.editingConnectionId = undefined;
    this.isEditorOpen = true;
    // Default provider per capability
    const defaultProvider =
      capability === 'text' ? 'openrouter' : capability === 'image' ? 'comfyui' : 'kokoro';
    this.draft = {
      apiKey: '',
      baseUrl: '',
      capability,
      generationParams: { ...configService.state.generationParams },
      isDefault: false,
      model: '',
      // Name is optional — default it to the selected provider's label.
      name:
        this._capabilityProviders(capability).find((p) => p.id === defaultProvider)?.label ??
        defaultProvider,
      provider: defaultProvider,
    };
    // Local providers (e.g. Ollama) are probed on selection — user-initiated,
    // which is what triggers the browser's local-network permission prompt.
    if (LOCAL_GUIDE_PROVIDERS.has(defaultProvider)) {
      void this.checkLocalProvider();
    } else {
      this.localProviderStatus = undefined;
    }
  }

  openEdit(id: ConnectionId): void {
    this.debug('openEdit', { id });
    const connection = configService.getConnection(id);
    if (!connection) {
      return;
    }
    this._providerCache = {
      [connection.provider]: { apiKey: connection.apiKey, model: connection.model },
    };
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
    this.editingConnectionId = id;
    this.isEditorOpen = true;
    this.draft = { ...connection };
    // Editing a local provider re-probes availability (user-initiated).
    if (LOCAL_GUIDE_PROVIDERS.has(connection.provider)) {
      void this.checkLocalProvider();
    } else {
      this.localProviderStatus = undefined;
    }
  }

  cancelEdit(): void {
    this.debug('cancelEdit');
    this.isEditorOpen = false;
    this.editingConnectionId = undefined;
    this._providerCache = {};
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
  }

  setDraftField(field: keyof Connection, value: unknown): void {
    this.draft = { ...this.draft, [field]: value };
  }

  /** Sets the provider, swapping cached apiKey/model and clearing fetched models. */
  setProvider(provider: string): void {
    const oldProvider = this.draft.provider;
    const oldApiKey = this.draft.apiKey;
    const oldModel = this.draft.model;
    const oldName = this.draft.name;

    // Save current values to cache
    if (oldProvider && (oldApiKey || oldModel)) {
      this._providerCache[oldProvider] = { apiKey: oldApiKey ?? '', model: oldModel ?? '' };
    }

    // Load cached values for new provider
    const cached = this._providerCache[provider];
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;

    // Name is optional and defaults to the provider's label. When the name was
    // auto-filled from the previous provider (or left empty), keep it in sync.
    const previousLabel = oldProvider ? this._providerLabel(oldProvider) : undefined;
    const nameWasAuto = !oldName?.trim() || oldName === previousLabel;

    this.draft = {
      ...this.draft,
      apiKey: cached?.apiKey ?? this._getDefaultApiKey(provider) ?? '',
      model: '',
      name: nameWasAuto ? this._providerLabel(provider) : oldName,
      provider,
    };

    // Selecting a local provider (Ollama) triggers a live probe — this is what
    // makes the browser ask for local-network permission and lets us show the
    // setup guide when the server is unreachable.
    if (LOCAL_GUIDE_PROVIDERS.has(provider)) {
      void this.checkLocalProvider();
    } else {
      this.localProviderStatus = undefined;
    }
  }

  /** Resolves the human-readable label for a provider in the draft's capability. */
  private _providerLabel(provider: string): string {
    return this._capabilityProviders().find((p) => p.id === provider)?.label ?? provider;
  }

  /** Returns the default API key for a provider based on current capability. */
  private _getDefaultApiKey(provider: string): string | undefined {
    const capability = this.draft.capability ?? 'text';
    return this._getFallbackApiKey(provider, capability);
  }

  /**
   * Legacy fallback API key lookup per capability.
   *
   * C-230: text keys live in connections[] (getApiKey); image/voice keys
   * are still read from the legacy image/voice config for backward compat.
   */
  private _getFallbackApiKey(
    provider: string,
    capability: ConnectionCapability,
  ): string | undefined {
    if (capability === 'image') {
      return configService.state.image.apiKey;
    }
    if (capability === 'voice') {
      return configService.state.voice.apiKey;
    }
    return configService.getApiKey(provider, 'text');
  }

  saveDraft(): void {
    this.debug('saveDraft');
    // Name is optional — default it to the selected provider's label.
    const provider = this.draft.provider ?? 'openrouter';
    const name = this.draft.name?.trim() || this._providerLabel(provider);

    const model = this.isModelCustom ? '' : (this.draft.model ?? '');

    if (this.editingConnectionId) {
      configService.updateConnection(this.editingConnectionId, {
        ...this.draft,
        name,
        model,
        updatedAt: new Date().toISOString(),
      });
    } else {
      configService.addConnection({
        ...(this.draft as Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>),
        name,
        model,
        source: 'stored',
      });
    }

    this.isEditorOpen = false;
    this.editingConnectionId = undefined;
    this._providerCache = {};
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
    this.localProviderStatus = undefined;
    void configService.save();
  }

  // ── Connection CRUD ──────────────────────────────────────────────────

  deleteConnection(id: ConnectionId): void {
    this.debug('deleteConnection', { id });
    configService.deleteConnection(id);
    if (this.editingConnectionId === id) {
      this.cancelEdit();
    }
    void configService.save();
  }

  duplicateConnection(id: ConnectionId): void {
    this.debug('duplicateConnection', { id });
    configService.duplicateConnection(id);
    void configService.save();
  }

  setDefault(id: ConnectionId): void {
    this.debug('setDefault', { id });
    configService.setDefaultConnection(id);
    void configService.save();
  }

  // ── Connection testing ──────────────────────────────────────────────

  async testConnection(id: ConnectionId): Promise<void> {
    this.debug('testConnection', { id });
    const connection = configService.getConnection(id);
    if (!connection) {
      return;
    }

    const newTestingIds = new Set(this.testingIds);
    newTestingIds.add(id);
    this.testingIds = newTestingIds;

    const startMs = performance.now();

    try {
      if (connection.provider === 'ollama') {
        await this._testOllama(id, startMs);
      } else {
        await this._testProvider(id, connection, startMs);
      }
    } catch (err) {
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: Math.round(performance.now() - startMs), error: String(err) },
      };
    } finally {
      const newIds = new Set(this.testingIds);
      newIds.delete(id);
      this.testingIds = newIds;
    }
  }

  // ── Presets ─────────────────────────────────────────────────────────

  applyPreset(presetId: string): void {
    const preset = configService.state.presets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this.draft = { ...this.draft, generationParams: { ...preset.params } };
  }

  savePreset(name: string): void {
    if (!name.trim()) {
      return;
    }
    const params = this.draft.generationParams ?? configService.state.generationParams;
    configService.addPreset({ name: name.trim(), params: { ...params } });
    void configService.save();
  }

  deletePreset(id: string): void {
    configService.deletePreset(id);
    void configService.save();
  }

  toggleApiKeyVisibility(): void {
    this.showApiKey = !this.showApiKey;
  }

  setPresetName(value: string): void {
    this.presetName = value;
  }

  savePresetFromInput(): void {
    if (!this.presetName.trim()) {
      return;
    }
    this.savePreset(this.presetName);
    this.presetName = '';
  }

  /** Tests provider auth by pinging the verify endpoint. */
  async testDraftConnection(): Promise<void> {
    const provider = this.draft.provider ?? 'openrouter';
    this.debug('testDraftConnection', { provider });
    this.isTestingDraft = true;
    this.draftTestResult = undefined;

    const startMs = performance.now();

    try {
      if (provider === 'ollama') {
        await this._testDraftOllama(startMs);
      } else {
        await this._testDraftProvider(provider, startMs);
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      this.debug('testDraftConnection:failed', { provider, elapsed, error: String(err) });
      this.draftTestResult = {
        ok: false,
        latencyMs: elapsed,
        error: String(err),
      };
    } finally {
      this.isTestingDraft = false;
    }
  }

  /** Tests the selected model by sending a simple "hi" chat completion. */
  async testDraftModel(): Promise<void> {
    const provider = this.draft.provider ?? 'openrouter';
    const config = PROVIDER_MODEL_FETCH[provider];
    this.debug('testDraftModel', { provider, hasConfig: !!config });
    if (!config?.chatTestUrl) {
      this.draftModelTestResult = {
        ok: false,
        latencyMs: 0,
        error: 'Model testing not supported for this provider',
      };
      return;
    }

    const model = this.isModelCustom ? undefined : this.draft.model;
    if (!model && !this.isModelCustom) {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No model selected' };
      return;
    }

    const capability = this.draft.capability ?? 'text';
    const apiKey = this.draft.apiKey || this._getFallbackApiKey(provider, capability);
    if (config.auth.location === 'header' && config.auth.name && !apiKey) {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No API key configured' };
      return;
    }

    this.isTestingDraftModel = true;
    this.draftModelTestResult = undefined;

    const startMs = performance.now();

    try {
      const headers: Record<string, string> = { ...config.extraHeaders };

      if (config.auth.location === 'header' && apiKey) {
        const prefix = config.auth.prefix ?? '';
        headers[config.auth.name] = `${prefix}${apiKey}`;
      }

      let body: string;
      if (config.chatTestOpenAiCompat) {
        body = JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          // biome-ignore lint/style/useNamingConvention: API contract field name
          max_tokens: 5,
        });
      } else {
        // Ollama native /api/chat format
        body = JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
          options: {
            // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
            num_predict: 5,
          },
        });
      }

      this.debug('testDraftModel:fetch', {
        url: config.chatTestUrl,
        model,
        bodyLength: body.length,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

      try {
        const response = await fetch(config.chatTestUrl, {
          body,
          headers: { 'Content-Type': 'application/json', ...headers },
          method: 'POST',
          signal: controller.signal,
        });
        const elapsed = Math.round(performance.now() - startMs);
        this.debug('testDraftModel:response', { status: response.status, elapsed });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          this.debug('testDraftModel:error', {
            status: response.status,
            errorBody: errorBody.slice(0, 300),
          });
          this.draftModelTestResult = {
            ok: false,
            latencyMs: elapsed,
            error: `HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ''}`,
          };
        } else {
          this.debug('testDraftModel:ok', { elapsed });
          this.draftModelTestResult = { ok: true, latencyMs: elapsed };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      this.debug('testDraftModel:exception', { elapsed, error: String(err) });
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.draftModelTestResult = {
          ok: false,
          latencyMs: elapsed,
          error: 'Connection timed out',
        };
      } else {
        this.draftModelTestResult = { ok: false, latencyMs: elapsed, error: String(err) };
      }
    } finally {
      this.isTestingDraftModel = false;
    }
  }

  /** Fetches available models for the current provider via the generic registry. */
  async fetchModels(): Promise<void> {
    this.debug('fetchModels');
    const provider = this.draft.provider ?? 'openrouter';
    const config = PROVIDER_MODEL_FETCH[provider];
    if (!config) {
      return;
    }

    const capability = this.draft.capability ?? 'text';
    const apiKey = this.draft.apiKey || this._getFallbackApiKey(provider, capability);

    this.isFetchingModels = true;

    try {
      this._availableModels = await fetchModelsFromProvider({
        config,
        apiKey,
        timeoutMs: TEST_TIMEOUT_MS,
      });
    } finally {
      this.isFetchingModels = false;
    }
  }

  /**
   * Probes the selected local provider (Ollama) on localhost. From an HTTPS
   * origin this triggers the browser's Private Network Access permission
   * prompt; the result drives the inline status and the setup guide.
   */
  async checkLocalProvider(): Promise<void> {
    const provider = this.draft.provider ?? 'openrouter';
    this.debug('checkLocalProvider', { provider });
    if (!LOCAL_GUIDE_PROVIDERS.has(provider)) {
      this.localProviderStatus = undefined;
      return;
    }

    this.localProviderStatus = { checking: true, ok: false };
    const startMs = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
      const elapsed = Math.round(performance.now() - startMs);

      if (response.ok) {
        const data = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
        this.localProviderStatus = { checking: false, ok: true, latencyMs: elapsed, modelCount };
        this.debug('checkLocalProvider:ok', { elapsed, modelCount });
        // Populate the model list right away so the user can pick one.
        if (provider in PROVIDER_MODEL_FETCH) {
          void this.fetchModels();
        }
      } else {
        this.localProviderStatus = {
          checking: false,
          ok: false,
          latencyMs: elapsed,
          error: `HTTP ${response.status}`,
        };
        this.debug('checkLocalProvider:failed', { status: response.status, elapsed });
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.localProviderStatus = {
        checking: false,
        ok: false,
        latencyMs: elapsed,
        error: message,
      };
      this.debug('checkLocalProvider:exception', { elapsed, error: message });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Private: saved-connection test helpers ────────────────────────────

  private async _testOllama(id: ConnectionId, startMs: number): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
      const elapsed = Math.round(performance.now() - startMs);

      if (!response.ok) {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: `HTTP ${response.status}` },
        };
        return;
      }

      const data = (await response.json()) as { models?: unknown[] };
      const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
      this.testResults = {
        ...this.testResults,
        [id]: { ok: true, latencyMs: elapsed, modelCount },
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: elapsed, error: message },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _testProvider(
    id: ConnectionId,
    connection: Connection,
    startMs: number,
  ): Promise<void> {
    const endpoint = PROVIDER_ENDPOINTS[connection.provider];
    if (!endpoint) {
      const elapsed = Math.round(performance.now() - startMs);
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: elapsed, error: `Unknown provider: ${connection.provider}` },
      };
      return;
    }

    if (!connection.apiKey) {
      this.testResults = {
        ...this.testResults,
        [id]: {
          ok: false,
          latencyMs: Math.round(performance.now() - startMs),
          error: 'No API key configured',
        },
      };
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const url = buildVerifyUrl(endpoint, connection.apiKey);
      const headers = buildVerifyHeaders(endpoint, connection.apiKey);
      const response = await fetch(url, {
        headers,
        method: endpoint.method,
        signal: controller.signal,
      });
      const elapsed = Math.round(performance.now() - startMs);

      if (!response.ok) {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: `HTTP ${response.status}` },
        };
        return;
      }

      let modelCount: number | undefined;
      try {
        const data = (await response.clone().json()) as Record<string, unknown>;
        if (Array.isArray(data.data)) {
          modelCount = data.data.length;
        } else if (Array.isArray(data.models)) {
          modelCount = data.models.length;
        }
      } catch {
        /* not JSON */
      }

      this.testResults = {
        ...this.testResults,
        [id]: { ok: true, latencyMs: elapsed, modelCount },
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: elapsed, error: message },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Private: draft connection test helpers ────────────────────────────

  private async _testDraftOllama(startMs: number): Promise<void> {
    this.debug('_testDraftOllama:fetch', { url: OLLAMA_TAGS_URL });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
      const elapsed = Math.round(performance.now() - startMs);
      this.debug('_testDraftOllama:response', { status: response.status, elapsed });

      if (!response.ok) {
        this.draftTestResult = { ok: false, latencyMs: elapsed, error: `HTTP ${response.status}` };
        return;
      }

      const data = (await response.json()) as { models?: unknown[] };
      const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
      this.debug('_testDraftOllama:ok', { elapsed, modelCount });
      this.draftTestResult = { ok: true, latencyMs: elapsed, modelCount };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.debug('_testDraftOllama:failed', { elapsed, error: message });
      this.draftTestResult = { ok: false, latencyMs: elapsed, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _testDraftProvider(provider: string, startMs: number): Promise<void> {
    const endpoint = PROVIDER_ENDPOINTS[provider];
    this.debug('_testDraftProvider', { provider, hasEndpoint: !!endpoint });
    if (!endpoint) {
      this.draftTestResult = {
        ok: false,
        latencyMs: Math.round(performance.now() - startMs),
        error: `Unknown provider: ${provider}`,
      };
      return;
    }

    const apiKey = this.draft.apiKey;
    if (!apiKey) {
      this.draftTestResult = {
        ok: false,
        latencyMs: Math.round(performance.now() - startMs),
        error: 'No API key configured',
      };
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const url = buildVerifyUrl(endpoint, apiKey);
      const headers = buildVerifyHeaders(endpoint, apiKey);
      this.debug('_testDraftProvider:fetch', { url, method: endpoint.method });
      const response = await fetch(url, {
        headers,
        method: endpoint.method,
        signal: controller.signal,
      });
      const elapsed = Math.round(performance.now() - startMs);
      this.debug('_testDraftProvider:response', { status: response.status, elapsed });

      if (!response.ok) {
        this.draftTestResult = { ok: false, latencyMs: elapsed, error: `HTTP ${response.status}` };
        return;
      }

      let modelCount: number | undefined;
      try {
        const data = (await response.clone().json()) as Record<string, unknown>;
        if (Array.isArray(data.data)) {
          modelCount = data.data.length;
        } else if (Array.isArray(data.models)) {
          modelCount = data.models.length;
        }
      } catch {
        /* not JSON */
      }

      this.debug('_testDraftProvider:ok', { elapsed, modelCount });
      this.draftTestResult = { ok: true, latencyMs: elapsed, modelCount };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.debug('_testDraftProvider:failed', { elapsed, error: message });
      this.draftTestResult = { ok: false, latencyMs: elapsed, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const getConnectionManagerViewModel = (
  options: ConnectionManagerViewModelOptions,
): ConnectionManagerViewModelInterface => ConnectionManagerViewModel.create(options);
