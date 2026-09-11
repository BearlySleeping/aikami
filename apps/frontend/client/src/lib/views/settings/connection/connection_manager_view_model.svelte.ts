// apps/frontend/client/src/lib/views/settings/connection/connection_manager_view_model.svelte.ts
//
// ViewModel for the Connection Manager — CRUD, testing, preset management,
// model fetching, provider caching, and per-chat assignment (C-230).

import {
  buildVerifyHeaders,
  buildVerifyUrl,
  IMAGE_PROVIDERS,
  PROVIDER_ENDPOINTS,
  providerNeedsKey,
  TEXT_PROVIDERS,
  VOICE_PROVIDERS,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type {
  ConfigServiceInterface,
  FetchedModel,
  fetchModelsFromProvider,
  fetchWithCredentialPolicy,
  getOllamaRuntimeEndpoints,
  PROVIDER_MODEL_FETCH,
  resolveChatTestRequest,
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
// Capabilities
// ---------------------------------------------------------------------------

/** The configuration surface the connection manager reads and mutates. */
export type ConnectionManagerConfigCapabilities = Pick<
  ConfigServiceInterface,
  | 'state'
  | 'load'
  | 'save'
  | 'getConnection'
  | 'getApiKey'
  | 'addConnection'
  | 'updateConnection'
  | 'deleteConnection'
  | 'duplicateConnection'
  | 'setDefaultConnection'
  | 'addPreset'
  | 'deletePreset'
>;

/** The provider registry/probe helpers the connection manager drives. */
export type ConnectionManagerAiCapabilities = {
  providerModelFetch: typeof PROVIDER_MODEL_FETCH;
  fetchModelsFromProvider: typeof fetchModelsFromProvider;
  fetchWithCredentialPolicy: typeof fetchWithCredentialPolicy;
  getOllamaRuntimeEndpoints: typeof getOllamaRuntimeEndpoints;
  resolveChatTestRequest: typeof resolveChatTestRequest;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ConnectionManagerViewModelOptions = BaseViewModelOptions & {
  config: ConnectionManagerConfigCapabilities;
  ai: ConnectionManagerAiCapabilities;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 15_000;

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
  private _providerCache: Record<string, { apiKey: string; baseUrl: string; model: string }> = {};
  private readonly _config: ConnectionManagerConfigCapabilities;
  private readonly _ai: ConnectionManagerAiCapabilities;

  constructor(options: ConnectionManagerViewModelOptions) {
    super(options);
    this._config = options.config;
    this._ai = options.ai;
  }

  // ── Proxied state ─────────────────────────────────────────────────────

  get connections(): readonly Connection[] {
    return this._config.state.connections as unknown as Connection[]; // guard-ignore lint/type-safety/casting: connection list parsed from config - runtime shape guaranteed
  }

  get defaultConnectionId(): ConnectionId | null {
    return this._config.state.defaultConnectionId;
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
      return ['comfyui', 'webui', 'sdcpp', 'openai-compat'].includes(provider);
    }
    if (capability === 'voice') {
      return ['kokoro', 'voicevox', 'fish-speech'].includes(provider);
    }
    return ['ollama', 'llamacpp', 'ooba', 'custom'].includes(provider);
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
    return this.draft.generationParams ?? this._config.state.generationParams;
  }

  get presetOptions(): ReadonlyArray<{ id: string; name: string }> {
    return this._config.state.presets.map((p) => ({ id: p.id, name: p.name }));
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
    return (this.draft.provider ?? 'openrouter') in this._ai.providerModelFetch;
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
        needsKey: p.id !== 'comfyui' && p.id !== 'webui' && p.id !== 'sdcpp',
        needsUrl:
          p.id === 'comfyui' || p.id === 'webui' || p.id === 'sdcpp' || p.id === 'openai-compat',
        isLocal: p.id === 'comfyui' || p.id === 'webui' || p.id === 'sdcpp',
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
    await this._config.load();
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
      generationParams: { ...this._config.state.generationParams },
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
    let defaultProvider: string;
    if (capability === 'text') {
      defaultProvider = 'openrouter';
    } else if (capability === 'image') {
      defaultProvider = 'comfyui';
    } else {
      defaultProvider = 'kokoro';
    }
    this.draft = {
      apiKey: '',
      baseUrl: '',
      capability,
      generationParams: { ...this._config.state.generationParams },
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
    const connection = this._config.getConnection(id);
    if (!connection) {
      return;
    }
    this._providerCache = {
      [connection.provider]: {
        apiKey: connection.apiKey,
        baseUrl: connection.baseUrl,
        model: connection.model,
      },
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
    const oldBaseUrl = this.draft.baseUrl;
    const oldModel = this.draft.model;
    const oldName = this.draft.name;

    // Save current values to cache
    if (oldProvider) {
      this._providerCache[oldProvider] = {
        apiKey: oldApiKey ?? '',
        baseUrl: oldBaseUrl ?? '',
        model: oldModel ?? '',
      };
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
      baseUrl: cached?.baseUrl ?? '',
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
    // Connection-backed keys take precedence for every capability (C-230).
    const connectionKey = this._config.getApiKey(provider, capability);
    if (connectionKey) {
      return connectionKey;
    }
    // Legacy fallbacks: image/voice keys may still live in the legacy
    // image/voice config for backward compat.
    if (capability === 'image') {
      return this._config.state.image.apiKey;
    }
    if (capability === 'voice') {
      return this._config.state.voice.apiKey;
    }
    // Text has no legacy key store — getApiKey above already covered it.
    return undefined;
  }

  saveDraft(): void {
    this.debug('saveDraft');
    // Name is optional — default it to the selected provider's label.
    const provider = this.draft.provider ?? 'openrouter';
    const name = this.draft.name?.trim() || this._providerLabel(provider);

    const model = this.isModelCustom ? '' : (this.draft.model ?? '');

    if (this.editingConnectionId) {
      this._config.updateConnection(this.editingConnectionId, {
        ...this.draft,
        name,
        model,
        updatedAt: new Date().toISOString(),
      });
    } else {
      this._config.addConnection({
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
    void this._config.save();
  }

  // ── Connection CRUD ──────────────────────────────────────────────────

  deleteConnection(id: ConnectionId): void {
    this.debug('deleteConnection', { id });
    this._config.deleteConnection(id);
    if (this.editingConnectionId === id) {
      this.cancelEdit();
    }
    void this._config.save();
  }

  duplicateConnection(id: ConnectionId): void {
    this.debug('duplicateConnection', { id });
    this._config.duplicateConnection(id);
    void this._config.save();
  }

  setDefault(id: ConnectionId): void {
    this.debug('setDefault', { id });
    this._config.setDefaultConnection(id);
    void this._config.save();
  }

  // ── Connection testing ──────────────────────────────────────────────

  async testConnection(id: ConnectionId): Promise<void> {
    this.debug('testConnection', { id });
    const connection = this._config.getConnection(id);
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
    const preset = this._config.state.presets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this.draft = { ...this.draft, generationParams: { ...preset.params } };
  }

  savePreset(name: string): void {
    if (!name.trim()) {
      return;
    }
    const params = this.draft.generationParams ?? this._config.state.generationParams;
    this._config.addPreset({ name: name.trim(), params: { ...params } });
    void this._config.save();
  }

  deletePreset(id: string): void {
    this._config.deletePreset(id);
    void this._config.save();
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
    const model = this.draft.model?.trim();
    if (!model || model === '__custom__') {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No model selected' };
      return;
    }

    const capability = this.draft.capability ?? 'text';
    const apiKey = this.draft.apiKey || this._config.getApiKey(provider, capability);
    if (providerNeedsKey(provider) && !apiKey) {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No API key configured' };
      return;
    }

    const request = this._ai.resolveChatTestRequest({
      apiKey,
      baseUrl: this.draft.baseUrl,
      model,
      registryId: provider,
    });

    this.debug('testDraftModel', { provider, hasRequest: !!request, url: request?.url });

    if (!request) {
      this.draftModelTestResult = {
        ok: false,
        latencyMs: 0,
        error: this._modelTestUnavailableError(provider),
      };
      return;
    }

    this.isTestingDraftModel = true;
    this.draftModelTestResult = undefined;

    const startMs = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

      try {
        const response = await this._ai.fetchWithCredentialPolicy({
          url: request.url,
          hasCredential: Boolean(apiKey),
          approvedOrigins: this._ai.providerModelFetch[provider]?.approvedOrigins,
          init: {
            body: request.body,
            headers: { 'Content-Type': 'application/json', ...request.headers },
            method: 'POST',
            signal: controller.signal,
          },
        });
        const elapsed = Math.round(performance.now() - startMs);
        this.debug('testDraftModel:response', { status: response?.status, elapsed });

        if (!response) {
          this.draftModelTestResult = {
            ok: false,
            latencyMs: elapsed,
            error: 'Request blocked by credential policy (unapproved redirect)',
          };
          return;
        }

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
      this.draftModelTestResult = {
        ok: false,
        latencyMs: elapsed,
        error:
          err instanceof DOMException && err.name === 'AbortError'
            ? 'Connection timed out'
            : String(err),
      };
    } finally {
      this.isTestingDraftModel = false;
    }
  }

  /**
   * Explains why a model test has no request to send — a missing endpoint,
   * not an unsupported provider (only ids absent from the registry are).
   */
  private _modelTestUnavailableError(provider: string): string {
    if (!this._ai.providerModelFetch[provider]) {
      return 'Model testing not supported for this provider';
    }
    if (provider === 'ollama') {
      return 'No local text engine configured (text.url missing from config.json)';
    }
    return 'No endpoint configured — set a base URL';
  }

  /** Fetches available models for the current provider via the generic registry. */
  async fetchModels(): Promise<void> {
    this.debug('fetchModels');
    const provider = this.draft.provider ?? 'openrouter';
    const config = this._ai.providerModelFetch[provider];
    if (!config) {
      return;
    }

    const capability = this.draft.capability ?? 'text';
    const apiKey = this.draft.apiKey || this._getFallbackApiKey(provider, capability);

    this.isFetchingModels = true;

    try {
      this._availableModels = await this._ai.fetchModelsFromProvider({
        config,
        apiKey,
        baseUrl: this.draft.baseUrl,
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
      const ollamaUrl = this._ai.getOllamaRuntimeEndpoints().url;
      if (!ollamaUrl) {
        this.localProviderStatus = {
          checking: false,
          ok: false,
          error: 'No Ollama endpoint configured — set text.url in config.json',
        };
        return;
      }
      const response = await fetch(ollamaUrl, { signal: controller.signal });
      const elapsed = Math.round(performance.now() - startMs);

      if (response.ok) {
        const data = (await response.json()) as { models?: unknown[] };
        const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
        this.localProviderStatus = { checking: false, ok: true, latencyMs: elapsed, modelCount };
        this.debug('checkLocalProvider:ok', { elapsed, modelCount });
        // Populate the model list right away so the user can pick one.
        if (provider in this._ai.providerModelFetch) {
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
      const ollamaUrl = this._ai.getOllamaRuntimeEndpoints().url;
      if (!ollamaUrl) {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: 0, error: 'No Ollama endpoint configured' },
        };
        return;
      }
      const response = await fetch(ollamaUrl, { signal: controller.signal });
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
      const url = buildVerifyUrl({ endpoint, apiKey: connection.apiKey });
      const headers = buildVerifyHeaders({ endpoint, apiKey: connection.apiKey });
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
    const ollamaUrl = this._ai.getOllamaRuntimeEndpoints().url;
    if (!ollamaUrl) {
      this.draftTestResult = {
        ok: false,
        latencyMs: 0,
        error: 'No Ollama endpoint configured — set text.url in config.json',
      };
      return;
    }
    this.debug('_testDraftOllama:fetch', { url: ollamaUrl });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(ollamaUrl, { signal: controller.signal });
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
      const url = buildVerifyUrl({ endpoint, apiKey });
      const headers = buildVerifyHeaders({ endpoint, apiKey });
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

export const createConnectionManagerViewModel = (
  options: ConnectionManagerViewModelOptions,
): ConnectionManagerViewModelInterface => ConnectionManagerViewModel.create(options);
