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
import { configService } from '$lib/services/config/config_service.svelte';
import {
  buildVerifyHeaders,
  buildVerifyUrl,
  type FetchedModel,
  fetchModelsFromProvider,
  PROVIDER_ENDPOINTS,
  PROVIDER_MODEL_FETCH,
} from '$lib/services/config/provider_endpoints';
import type { Connection, ConnectionId, ConnectionTestResult } from '$types/connection';

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
  readonly providerLabels: Record<string, string>;
  readonly providerOptions: ReadonlyArray<{ id: string; label: string }>;
  readonly needsApiKey: boolean;
  readonly needsUrl: boolean;
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
    const labels: Record<string, string> = {};
    for (const p of TEXT_PROVIDERS) {
      labels[p.id] = p.label;
    }
    return labels;
  }

  get providerOptions(): ReadonlyArray<{ id: string; label: string }> {
    return TEXT_PROVIDERS.map((p) => ({ id: p.id, label: `${p.label} — ${p.description}` }));
  }

  get isEditing(): boolean {
    return this.editingConnectionId !== undefined;
  }

  get needsApiKey(): boolean {
    const provider = this.draft.provider ?? 'openrouter';
    return TEXT_PROVIDERS.find((p) => p.id === provider)?.needsKey ?? true;
  }

  get needsUrl(): boolean {
    const provider = this.draft.provider ?? 'openrouter';
    return ['ollama', 'ooba', 'custom'].includes(provider);
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
    this.draft = {
      apiKey: '',
      baseUrl: '',
      generationParams: { ...configService.state.generationParams },
      isDefault: false,
      model: '',
      name: '',
      provider: 'openrouter',
    };
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

    // Save current values to cache
    if (oldProvider && (oldApiKey || oldModel)) {
      this._providerCache[oldProvider] = { apiKey: oldApiKey ?? '', model: oldModel ?? '' };
    }

    // Load cached values for new provider
    const cached = this._providerCache[provider];
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;

    this.draft = {
      ...this.draft,
      apiKey: cached?.apiKey ?? configService.state.text.apiKeys[provider] ?? '',
      model: '',
      provider,
    };
  }

  saveDraft(): void {
    this.debug('saveDraft');
    if (!this.draft.name?.trim()) {
      this.warn('saveDraft: name is required');
      return;
    }

    const model = this.isModelCustom ? '' : (this.draft.model ?? '');

    if (this.editingConnectionId) {
      configService.updateConnection(this.editingConnectionId, {
        ...this.draft,
        model,
        updatedAt: new Date().toISOString(),
      });
    } else {
      configService.addConnection({
        ...(this.draft as Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>),
        model,
      });
    }

    this.isEditorOpen = false;
    this.editingConnectionId = undefined;
    this._providerCache = {};
    this._availableModels = [];
    this.draftTestResult = undefined;
    this.draftModelTestResult = undefined;
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
    this.debug('testDraftConnection');
    this.isTestingDraft = true;
    this.draftTestResult = undefined;

    const startMs = performance.now();
    const provider = this.draft.provider ?? 'openrouter';

    try {
      if (provider === 'ollama') {
        await this._testDraftOllama(startMs);
      } else {
        await this._testDraftProvider(provider, startMs);
      }
    } catch (err) {
      this.draftTestResult = {
        ok: false,
        latencyMs: Math.round(performance.now() - startMs),
        error: String(err),
      };
    } finally {
      this.isTestingDraft = false;
    }
  }

  /** Tests the selected model by sending a simple "hi" chat completion. */
  async testDraftModel(): Promise<void> {
    this.debug('testDraftModel');
    const provider = this.draft.provider ?? 'openrouter';
    const config = PROVIDER_MODEL_FETCH[provider];
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

    const apiKey = this.draft.apiKey || configService.state.text.apiKeys[provider];
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
          max_tokens: 5,
        });
      } else {
        // Ollama native /api/chat format
        body = JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          stream: false,
        });
      }

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

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          this.draftModelTestResult = {
            ok: false,
            latencyMs: elapsed,
            error: `HTTP ${response.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ''}`,
          };
        } else {
          this.draftModelTestResult = { ok: true, latencyMs: elapsed };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
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

    const apiKey = this.draft.apiKey || configService.state.text.apiKeys[provider];

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const response = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal });
      const elapsed = Math.round(performance.now() - startMs);

      if (!response.ok) {
        this.draftTestResult = { ok: false, latencyMs: elapsed, error: `HTTP ${response.status}` };
        return;
      }

      const data = (await response.json()) as { models?: unknown[] };
      const modelCount = Array.isArray(data.models) ? data.models.length : undefined;
      this.draftTestResult = { ok: true, latencyMs: elapsed, modelCount };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.draftTestResult = { ok: false, latencyMs: elapsed, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async _testDraftProvider(provider: string, startMs: number): Promise<void> {
    const endpoint = PROVIDER_ENDPOINTS[provider];
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
      const response = await fetch(url, {
        headers,
        method: endpoint.method,
        signal: controller.signal,
      });
      const elapsed = Math.round(performance.now() - startMs);

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

      this.draftTestResult = { ok: true, latencyMs: elapsed, modelCount };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Connection timed out'
          : String(err);
      this.draftTestResult = { ok: false, latencyMs: elapsed, error: message };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const getConnectionManagerViewModel = (
  options: ConnectionManagerViewModelOptions,
): ConnectionManagerViewModelInterface => ConnectionManagerViewModel.create(options);
