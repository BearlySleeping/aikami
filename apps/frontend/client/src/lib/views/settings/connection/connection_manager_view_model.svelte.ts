// apps/frontend/client/src/lib/views/settings/connection/connection_manager_view_model.svelte.ts
//
// ViewModel for the Connection Manager — CRUD, testing, preset management,
// and per-chat assignment for provider connection profiles (C-230).

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
  PROVIDER_ENDPOINTS,
} from '$lib/services/config/provider_endpoints';
import type { Connection, ConnectionId, ConnectionTestResult } from '$types/connection';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ConnectionManagerViewModelInterface = BaseViewModelInterface & {
  /** All saved connections. */
  readonly connections: readonly Connection[];
  /** Currently active connection being edited (or undefined if none). */
  readonly editingConnectionId: ConnectionId | undefined;
  /** Draft connection fields during creation/editing. */
  readonly draft: Partial<Connection>;
  /** Test results per connection ID. */
  readonly testResults: Record<ConnectionId, ConnectionTestResult>;
  /** Which connections are currently being tested. */
  readonly testingIds: Set<ConnectionId>;
  /** ID of the default connection, or null. */
  readonly defaultConnectionId: ConnectionId | null;
  /** Whether the create/edit form is open. */
  readonly isEditorOpen: boolean;
  /** Whether we are editing an existing connection (not creating). */
  readonly isEditing: boolean;
  /** Whether the API key field is visible. */
  readonly showApiKey: boolean;
  /** Current preset name input value. */
  readonly presetName: string;
  /** Provider label map for display. */
  readonly providerLabels: Record<string, string>;
  /** Provider options for the dropdown (id + label). */
  readonly providerOptions: ReadonlyArray<{ id: string; label: string }>;
  /** Whether the current provider needs an API key. */
  readonly needsApiKey: boolean;
  /** Whether the current provider needs a custom URL. */
  readonly needsUrl: boolean;
  /** Generation params from the current draft. */
  readonly draftParams: Connection['generationParams'];
  /** Presets for the dropdown (built-in + user-defined). */
  readonly presetOptions: ReadonlyArray<{ id: string; name: string }>;
  /** Formatted param strings for the slider labels. */
  readonly formattedParams: {
    temperature: string;
    topP: string;
    topK: string;
    repetitionPenalty: string;
    maxTokens: string;
  };

  /** Opens the editor to create a new connection. */
  openCreate(): void;
  /** Opens the editor to edit an existing connection. */
  openEdit(id: ConnectionId): void;
  /** Cancels editing without saving. */
  cancelEdit(): void;
  /** Updates a single draft field. */
  setDraftField(field: keyof Connection, value: unknown): void;
  /** Saves the current draft (creates or updates). */
  saveDraft(): void;
  /** Deletes a connection. */
  deleteConnection(id: ConnectionId): void;
  /** Duplicates a connection. */
  duplicateConnection(id: ConnectionId): void;
  /** Sets a connection as the default. */
  setDefault(id: ConnectionId): void;
  /** Tests a connection by pinging the provider's verify endpoint. */
  testConnection(id: ConnectionId): Promise<void>;
  /** Applies a preset's generation params to the current draft. */
  applyPreset(presetId: string): void;
  /** Saves the draft's generation params as a new preset. */
  savePreset(name: string): void;
  /** Deletes a user-defined preset. */
  deletePreset(id: string): void;
  /** Toggles API key field visibility. */
  toggleApiKeyVisibility(): void;
  /** Sets the preset name input value. */
  setPresetName(value: string): void;
  /** Saves the draft's generation params as a new preset and clears the input. */
  savePresetFromInput(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ConnectionManagerViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Connection test timeout in milliseconds. */
const TEST_TIMEOUT_MS = 15_000;

/** Ollama tags endpoint for local connection testing. */
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

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.debug('initialize');
    await configService.load();
    await super.initialize();
  }

  // ── Editor management ────────────────────────────────────────────────

  openCreate(): void {
    this.debug('openCreate');
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
    this.editingConnectionId = id;
    this.isEditorOpen = true;
    this.draft = { ...connection };
  }

  cancelEdit(): void {
    this.debug('cancelEdit');
    this.isEditorOpen = false;
    this.editingConnectionId = undefined;
    this.draft = {};
  }

  setDraftField(field: keyof Connection, value: unknown): void {
    this.draft = { ...this.draft, [field]: value };
  }

  saveDraft(): void {
    this.debug('saveDraft');
    if (!this.draft.name?.trim()) {
      this.warn('saveDraft: name is required');
      return;
    }

    const now = new Date().toISOString();

    if (this.editingConnectionId) {
      configService.updateConnection(this.editingConnectionId, {
        ...this.draft,
        updatedAt: now,
      });
    } else {
      configService.addConnection({
        ...(this.draft as Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>),
      });
    }

    this.isEditorOpen = false;
    this.editingConnectionId = undefined;
    this.draft = {};
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
      this.warn('testConnection: connection not found', { id });
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
      const elapsed = Math.round(performance.now() - startMs);
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: elapsed, error: String(err) },
      };
    } finally {
      const newIds = new Set(this.testingIds);
      newIds.delete(id);
      this.testingIds = newIds;
    }
  }

  // ── Presets ─────────────────────────────────────────────────────────

  applyPreset(presetId: string): void {
    this.debug('applyPreset', { presetId });
    const preset = configService.state.presets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this.draft = { ...this.draft, generationParams: { ...preset.params } };
  }

  savePreset(name: string): void {
    this.debug('savePreset', { name });
    if (!name.trim()) {
      return;
    }
    const params = this.draft.generationParams ?? configService.state.generationParams;
    configService.addPreset({ name: name.trim(), params: { ...params } });
    void configService.save();
  }

  deletePreset(id: string): void {
    this.debug('deletePreset', { id });
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

  // ── Private helpers ──────────────────────────────────────────────────

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
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: 'Connection timed out' },
        };
      } else {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: String(err) },
        };
      }
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
      const elapsed = Math.round(performance.now() - startMs);
      this.testResults = {
        ...this.testResults,
        [id]: { ok: false, latencyMs: elapsed, error: 'No API key configured' },
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
        // Response may not be JSON
      }

      this.testResults = {
        ...this.testResults,
        [id]: { ok: true, latencyMs: elapsed, modelCount },
      };
    } catch (err) {
      const elapsed = Math.round(performance.now() - startMs);
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: 'Connection timed out' },
        };
      } else {
        this.testResults = {
          ...this.testResults,
          [id]: { ok: false, latencyMs: elapsed, error: String(err) },
        };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const getConnectionManagerViewModel = (
  options: ConnectionManagerViewModelOptions,
): ConnectionManagerViewModelInterface => ConnectionManagerViewModel.create(options);
