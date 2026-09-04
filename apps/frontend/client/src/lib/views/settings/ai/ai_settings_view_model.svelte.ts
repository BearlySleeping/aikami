// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.svelte.ts
//
// ViewModel for the AI Settings section. Replaces the old Connections section
// (C-465) with a status board, provider tree, roles drawer, voice/image
// panels, and generation-parameter disclosure.

import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  VOICE_PROVIDERS,
  PROVIDER_ENDPOINTS,
  buildVerifyUrl,
  buildVerifyHeaders,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  configService,
  type FetchedModel,
  fetchModelsFromProvider,
  PROVIDER_MODEL_FETCH,
} from '$services';
import type { AiProvider, AiConnection, AiRole, VoiceArchetype, TextParams, ImageParams, VoiceParams } from '@aikami/types';
import type { ConnectionCapability, ConnectionId, ConnectionTestResult } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-capability connection status for the status board. */
export type CapabilityStatus = 'connected' | 'offline' | 'not_configured' | 'loading';

/** Status board entry for one capability. */
export type CapabilityStatusEntry = {
  capability: ConnectionCapability;
  status: CapabilityStatus;
  label: string;
  modelName: string | undefined;
  latencyMs: number | undefined;
  providerLabel: string | undefined;
};

/** A provider with its nested connections, for the provider tree. */
export type ProviderTreeEntry = {
  provider: AiProvider;
  connections: AiConnection[];
  registryLabel: string;
  isLocal: boolean;
  isRunning: boolean;
  connectionCount: number;
};

/** A connection with its role assignments. */
export type ConnectionWithRoles = {
  connection: AiConnection;
  roles: AiRole[];
};

/** Editor draft state for a new or edited connection. */
export type EditorDraft = {
  providerId: string | undefined;
  registryId: string;
  capability: ConnectionCapability;
  label: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  showApiKey: boolean;
  isEditing: boolean;
  editingConnectionId: ConnectionId | undefined;
};

/** Ambiguous-key prompt state. */
export type KeyConflictPrompt = {
  /** The new key the user pasted. */
  newKey: string;
  /** The provider whose credential would change. */
  providerLabel: string;
  /** How many connections share this provider. */
  sharedConnectionCount: number;
  /** Whether the user chose to update the shared account. */
  resolveUpdate: boolean;
  /** Whether the user chose to create a separate account. */
  resolveSeparate: boolean;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type AiSettingsViewModelInterface = BaseViewModelInterface & {
  // ── Status board ──
  readonly statusEntries: readonly CapabilityStatusEntry[];

  // ── Provider tree ──
  readonly providerTree: readonly ProviderTreeEntry[];
  readonly isAddProviderOpen: boolean;

  // ── Connection editor ──
  readonly draft: EditorDraft;
  readonly isEditorOpen: boolean;
  readonly modelOptions: readonly FetchedModel[];
  readonly isFetchingModels: boolean;
  readonly canFetchModels: boolean;
  readonly needsApiKey: boolean;
  readonly needsUrl: boolean;
  readonly isLocalProvider: boolean;
  readonly providerOptions: ReadonlyArray<{ id: string; label: string; description: string }>;

  // ── Key conflict prompt ──
  readonly keyConflictPrompt: KeyConflictPrompt | undefined;

  // ── Roles drawer ──
  readonly isRolesDrawerOpen: boolean;
  readonly connectionsWithRoles: readonly ConnectionWithRoles[];
  readonly availableRoles: readonly AiRole[];
  readonly unassignedConnections: readonly AiConnection[];

  // ── Testing ──
  readonly testResults: Record<string, ConnectionTestResult>;
  readonly testingIds: Set<string>;

  // ── Actions ──
  openAddProvider(): void;
  closeAddProvider(): void;
  openEditConnection(connectionId: ConnectionId): void;
  cancelEdit(): void;
  setDraftField(field: string, value: unknown): void;
  setDraftProvider(registryId: string): void;
  saveDraft(): void;
  deleteConnection(connectionId: ConnectionId): void;
  testConnection(connectionId: ConnectionId): Promise<void>;
  testDraftConnection(): Promise<void>;
  fetchModels(): Promise<void>;
  toggleApiKeyVisibility(): void;
  resolveKeyConflict(update: boolean): void;
  dismissKeyConflict(): void;

  // ── Role actions ──
  toggleRolesDrawer(): void;
  assignRole(role: AiRole, connectionId: ConnectionId): void;
  clearRole(role: AiRole): void;

  // ── Capability sections ──
  readonly voiceArchetypes: readonly VoiceArchetype[];
  setVoiceArchetype(archetypeId: string, voiceId: string): void;
  readonly imageCheckpoints: readonly string[];
  readonly imageStyleProfiles: readonly string[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AiSettingsViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 15_000;
const LOCAL_PROVIDER_IDS = new Set([
  'ollama', 'llamacpp', 'ooba', 'comfyui', 'webui', 'kokoro', 'voicevox', 'fish-speech',
]);

const ALL_ROLES: readonly AiRole[] = [
  'narration', 'dialogue', 'summarization', 'structured',
  'portrait', 'scene',
  'narrator-voice', 'npc-voice',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _registryForCapability(capability: ConnectionCapability) {
  if (capability === 'image') return IMAGE_PROVIDERS;
  if (capability === 'voice') return VOICE_PROVIDERS;
  return TEXT_PROVIDERS;
}

function _deriveCapabilityStatus(providerCount: number): CapabilityStatus {
  if (providerCount === 0) return 'not_configured';
  return 'connected';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AiSettingsViewModel
  extends BaseViewModel<AiSettingsViewModelOptions>
  implements AiSettingsViewModelInterface
{
  // ── State ──
  isEditorOpen = $state(false);
  isAddProviderOpen = $state(false);
  isRolesDrawerOpen = $state(false);
  isFetchingModels = $state(false);
  testResults: Record<string, ConnectionTestResult> = $state({});
  testingIds: Set<string> = $state(new Set());
  keyConflictPrompt: KeyConflictPrompt | undefined = $state(undefined);
  private _availableModels: FetchedModel[] = $state([]);
  private _voiceArchetypes: VoiceArchetype[] = $state([]);

  draft: EditorDraft = $state({
    providerId: undefined,
    registryId: 'openrouter',
    capability: 'text',
    label: '',
    model: '',
    apiKey: '',
    baseUrl: '',
    showApiKey: false,
    isEditing: false,
    editingConnectionId: undefined,
  });

  // ── Derived: status board ──

  get statusEntries(): readonly CapabilityStatusEntry[] {
    const capabilities: ConnectionCapability[] = ['text', 'voice', 'image'];
    return capabilities.map((cap) => {
      const connections = this._connectionsForCapability(cap);
      const providers = this._providersForCapability(cap);
      const status = _deriveCapabilityStatus(connections.length);
      const firstConn = connections[0];
      const provider = firstConn ? providers.find((p) => p.id === firstConn.providerId) : undefined;
      const registry = _registryForCapability(cap);
      const registryEntry = registry.find((r) => r.id === provider?.registryId);
      return {
        capability: cap,
        status,
        label: cap.charAt(0).toUpperCase() + cap.slice(1),
        modelName: firstConn?.model,
        latencyMs: undefined,
        providerLabel: registryEntry?.label,
      };
    });
  }

  // ── Derived: provider tree ──

  get providerTree(): readonly ProviderTreeEntry[] {
    const providers = configService.getProviders();
    const aiConnections = configService.getAiConnections();
    return providers.map((p) => {
      const conns = aiConnections.filter((c) => c.providerId === p.id);
      const registry = _registryForCapability(conns[0]?.capability ?? 'text');
      const regEntry = registry.find((r) => r.id === p.registryId);
      return {
        provider: p,
        connections: conns,
        registryLabel: regEntry?.label ?? p.registryId,
        isLocal: LOCAL_PROVIDER_IDS.has(p.registryId),
        isRunning: true,
        connectionCount: conns.length,
      };
    });
  }

  // ── Derived: roles ──

  get connectionsWithRoles(): readonly ConnectionWithRoles[] {
    const assignments = configService.getRoleAssignments();
    const connections = configService.getAiConnections();
    return connections.map((c) => {
      const roles = (Object.keys(assignments) as AiRole[]).filter(
        (r) => assignments[r] === c.id,
      );
      return { connection: c, roles };
    });
  }

  get availableRoles(): readonly AiRole[] {
    return ALL_ROLES;
  }

  get unassignedConnections(): readonly AiConnection[] {
    const assignments = configService.getRoleAssignments();
    const assignedIds = new Set(Object.values(assignments));
    return configService.getAiConnections().filter((c) => !assignedIds.has(c.id));
  }

  // ── Derived: editor state ──

  get providerOptions(): ReadonlyArray<{ id: string; label: string; description: string }> {
    return _registryForCapability(this.draft.capability).map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
    }));
  }

  get modelOptions(): readonly FetchedModel[] {
    return this._availableModels;
  }

  get canFetchModels(): boolean {
    return this.draft.registryId in PROVIDER_MODEL_FETCH;
  }

  get needsApiKey(): boolean {
    const regEntry = _registryForCapability(this.draft.capability).find(
      (p) => p.id === this.draft.registryId,
    );
    if (!regEntry) return true;
    return !regEntry.isLocal && regEntry.needsKey;
  }

  get needsUrl(): boolean {
    const cap = this.draft.capability;
    const reg = this.draft.registryId;
    if (cap === 'image') return ['comfyui', 'webui', 'openai-compat'].includes(reg);
    if (cap === 'voice') return ['kokoro', 'voicevox', 'fish-speech'].includes(reg);
    return ['ollama', 'llamacpp', 'ooba', 'custom'].includes(reg);
  }

  get isLocalProvider(): boolean {
    const regEntry = _registryForCapability(this.draft.capability).find(
      (p) => p.id === this.draft.registryId,
    );
    return regEntry?.isLocal ?? false;
  }

  // ── Voice archetypes ──

  get voiceArchetypes(): readonly VoiceArchetype[] {
    return this._voiceArchetypes;
  }

  setVoiceArchetype(archetypeId: string, voiceId: string): void {
    this._voiceArchetypes = this._voiceArchetypes.map((a) =>
      a.id === archetypeId ? { ...a, voiceId } : a,
    );
    // Persist to the narrator-voice connection's params
    const narratorConn = configService.getAiConnections().find((c) => {
      const roles = configService.getRoleAssignments();
      return roles['narrator-voice'] === c.id;
    });
    if (narratorConn) {
      configService.updateAiConnection(narratorConn.id, {
        params: {
          ...(narratorConn.params as VoiceParams),
          archetypes: this._voiceArchetypes,
        } as VoiceParams,
      });
      void configService.save();
    }
  }

  // ── Image section ──

  get imageCheckpoints(): readonly string[] {
    // Read from the first image connection's params
    const imgConn = configService.getAiConnections().find((c) => c.capability === 'image');
    if (imgConn?.params && 'checkpoint' in imgConn.params) {
      return [imgConn.params.checkpoint as string];
    }
    return [];
  }

  get imageStyleProfiles(): readonly string[] {
    // Placeholder — styleProfileService integration deferred
    return [];
  }

  // ── Lifecycle ──

  override async initialize(): Promise<void> {
    this.debug('initialize');
    await configService.load();
    this._loadVoiceArchetypes();
    await super.initialize();
  }

  private _loadVoiceArchetypes(): void {
    // Try to load from the narrator-voice connection first
    const narratorConn = configService.getAiConnections().find((c) => {
      const roles = configService.getRoleAssignments();
      return roles['narrator-voice'] === c.id;
    });
    if (narratorConn?.params && 'archetypes' in narratorConn.params) {
      const loaded = (narratorConn.params as { archetypes?: VoiceArchetype[] }).archetypes;
      if (loaded && loaded.length > 0) {
        this._voiceArchetypes = loaded;
        return;
      }
    }
    // Fallback to legacy voiceArchetypes from voice config
    const legacy = configService.state.voice.voiceArchetypes;
    if (legacy && legacy.length > 0) {
      this._voiceArchetypes = legacy;
    }
  }

  // ── Editor: open / close / save ──

  openAddProvider(): void {
    this.debug('openAddProvider');
    this.isAddProviderOpen = true;
    this.isEditorOpen = true;
    this._resetDraft();
  }

  closeAddProvider(): void {
    this.isAddProviderOpen = false;
    this.cancelEdit();
  }

  openEditConnection(connectionId: ConnectionId): void {
    this.debug('openEditConnection', { connectionId });
    const conn = configService.getAiConnection(connectionId);
    if (!conn) return;
    const provider = configService.getProvider(conn.providerId);
    this.draft = {
      providerId: conn.providerId,
      registryId: provider?.registryId ?? 'openrouter',
      capability: conn.capability,
      label: conn.label,
      model: conn.model,
      apiKey: '',
      baseUrl: provider?.baseUrl ?? '',
      showApiKey: false,
      isEditing: true,
      editingConnectionId: connectionId,
    };
    this.isEditorOpen = true;
  }

  cancelEdit(): void {
    this.isEditorOpen = false;
    this.isAddProviderOpen = false;
    this._resetDraft();
    this._availableModels = [];
  }

  setDraftField(field: string, value: unknown): void {
    this.draft = { ...this.draft, [field]: value };
  }

  setDraftProvider(registryId: string): void {
    this.debug('setDraftProvider', { registryId });
    const oldRegistryId = this.draft.registryId;
    this._availableModels = [];

    // Check if a provider with this registryId already exists
    const existingProvider = this._findProviderByRegistry(registryId);
    const prefillKey = existingProvider?.credential ?? '';

    // Detect key conflict: if user had a different key and now switches
    const oldApiKey = this.draft.apiKey;
    const hasConflict = existingProvider && oldApiKey && oldApiKey !== prefillKey;

    this.draft = {
      ...this.draft,
      registryId,
      providerId: existingProvider?.id,
      apiKey: prefillKey,
      // Keep label in sync
      label: this._registryLabel(registryId) ?? registryId,
    };

    if (hasConflict) {
      this.keyConflictPrompt = {
        newKey: oldApiKey,
        providerLabel: this._registryLabel(registryId) ?? registryId,
        sharedConnectionCount: this._connectionsForProvider(existingProvider!.id).length,
        resolveUpdate: false,
        resolveSeparate: false,
      };
    }
  }

  saveDraft(): void {
    this.debug('saveDraft');

    const reg = this.draft.registryId;
    const cap = this.draft.capability;
    const label = this.draft.label?.trim() || this._registryLabel(reg) || reg;
    const model = this.draft.model;

    if (this.draft.isEditing && this.draft.editingConnectionId) {
      // Update existing connection
      const conn = configService.getAiConnection(this.draft.editingConnectionId);
      if (!conn) return;
      configService.updateAiConnection(this.draft.editingConnectionId, {
        label,
        model,
        // Params stay unchanged during edit for now
      });
      // Update provider credential if changed
      if (this.draft.providerId && this.draft.apiKey) {
        configService.updateProvider(this.draft.providerId, {
          credential: this.draft.apiKey,
        });
      }
    } else {
      // Resolve or create provider
      let providerId = this.draft.providerId;
      if (!providerId) {
        // Try to find existing or create new
        const existing = this._findProviderByRegistry(reg);
        if (existing) {
          providerId = existing.id;
          if (this.draft.apiKey && this.draft.apiKey !== existing.credential) {
            // Key changed — update the shared provider
            configService.updateProvider(existing.id, { credential: this.draft.apiKey });
          }
        } else {
          providerId = configService.addProvider({
            registryId: reg,
            label: this._registryLabel(reg) ?? reg,
            credential: this.draft.apiKey || undefined,
            baseUrl: this.draft.baseUrl || undefined,
            source: 'stored',
          });
        }
      }

      // Create the new connection
      if (providerId) {
        configService.addAiConnection({
          providerId,
          capability: cap,
          label,
          model,
          params: this._defaultParams(cap) as TextParams | ImageParams | VoiceParams,
        });
      }
    }

    void configService.save();
    this.cancelEdit();
  }

  deleteConnection(connectionId: ConnectionId): void {
    this.debug('deleteConnection', { connectionId });
    configService.deleteAiConnection(connectionId);
    void configService.save();
  }

  // ── Testing ──

  async testConnection(connectionId: ConnectionId): Promise<void> {
    this.debug('testConnection', { connectionId });
    const conn = configService.getAiConnection(connectionId);
    if (!conn) return;
    const provider = configService.getProvider(conn.providerId);
    if (!provider) return;

    const newTestingIds = new Set(this.testingIds);
    newTestingIds.add(connectionId);
    this.testingIds = newTestingIds;

    const startMs = performance.now();
    try {
      const endpoint = PROVIDER_ENDPOINTS[provider.registryId];
      if (!endpoint || !provider.credential) {
        this.testResults = {
          ...this.testResults,
          [connectionId]: { ok: false, latencyMs: Math.round(performance.now() - startMs), error: 'No endpoint or key' },
        };
        return;
      }
      const url = buildVerifyUrl({ endpoint, apiKey: provider.credential });
      const headers = buildVerifyHeaders({ endpoint, apiKey: provider.credential });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, { headers, method: endpoint.method, signal: controller.signal });
        const elapsed = Math.round(performance.now() - startMs);
        this.testResults = {
          ...this.testResults,
          [connectionId]: { ok: response.ok, latencyMs: elapsed },
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      this.testResults = {
        ...this.testResults,
        [connectionId]: { ok: false, latencyMs: Math.round(performance.now() - startMs), error: String(err) },
      };
    } finally {
      const newIds = new Set(this.testingIds);
      newIds.delete(connectionId);
      this.testingIds = newIds;
    }
  }

  async testDraftConnection(): Promise<void> {
    this.debug('testDraftConnection');
    // Stub — uses the same verify machinery as testConnection
  }

  async fetchModels(): Promise<void> {
    this.debug('fetchModels');
    const reg = this.draft.registryId;
    const config = PROVIDER_MODEL_FETCH[reg];
    if (!config) return;
    const existing = this._findProviderByRegistry(reg);
    const apiKey = existing?.credential ?? this.draft.apiKey;
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

  toggleApiKeyVisibility(): void {
    this.draft = { ...this.draft, showApiKey: !this.draft.showApiKey };
  }

  // ── Key conflict resolution ──

  resolveKeyConflict(update: boolean): void {
    if (!this.keyConflictPrompt) return;
    if (update) {
      const provider = this._findProviderByRegistry(this.draft.registryId);
      if (provider) {
        configService.updateProvider(provider.id, { credential: this.keyConflictPrompt.newKey });
        void configService.save();
      }
    }
    this.dismissKeyConflict();
  }

  dismissKeyConflict(): void {
    this.keyConflictPrompt = undefined;
  }

  // ── Roles ──

  toggleRolesDrawer(): void {
    this.isRolesDrawerOpen = !this.isRolesDrawerOpen;
  }

  assignRole(role: AiRole, connectionId: ConnectionId): void {
    this.debug('assignRole', { role, connectionId });
    configService.setRoleAssignment(role, connectionId);
    void configService.save();
  }

  clearRole(role: AiRole): void {
    this.debug('clearRole', { role });
    configService.clearRoleAssignment(role);
    void configService.save();
  }

  // ── Private helpers ──

  private _resetDraft(): void {
    this.draft = {
      providerId: undefined,
      registryId: 'openrouter',
      capability: 'text',
      label: '',
      model: '',
      apiKey: '',
      baseUrl: '',
      showApiKey: false,
      isEditing: false,
      editingConnectionId: undefined,
    };
    this._availableModels = [];
  }

  private _registryLabel(registryId: string): string | undefined {
    for (const reg of [TEXT_PROVIDERS, VOICE_PROVIDERS, IMAGE_PROVIDERS]) {
      const found = reg.find((p) => p.id === registryId);
      if (found) return found.label;
    }
    return undefined;
  }

  private _findProviderByRegistry(registryId: string): AiProvider | undefined {
    return configService.getProviders().find((p) => p.registryId === registryId);
  }

  private _connectionsForProvider(providerId: string): AiConnection[] {
    return configService.getAiConnections().filter((c) => c.providerId === providerId);
  }

  private _connectionsForCapability(cap: ConnectionCapability): AiConnection[] {
    return configService.getAiConnections().filter((c) => c.capability === cap);
  }

  private _providersForCapability(cap: ConnectionCapability): AiProvider[] {
    const registryIds = new Set<string>(
      _registryForCapability(cap).map((r) => r.id),
    );
    return configService.getProviders().filter((p) => registryIds.has(p.registryId));
  }

  private _defaultParams(cap: ConnectionCapability): TextParams | ImageParams | VoiceParams {
    if (cap === 'voice') {
      return { voiceId: '', speed: 1.0, pitch: 0 } as VoiceParams;
    }
    if (cap === 'image') {
      return { checkpoint: '', width: 512, height: 512, steps: 20, cfg: 7 } as ImageParams;
    }
    return {
      temperature: 0.7, topP: 1, topK: 40,
      repetitionPenalty: 1, presencePenalty: 0,
      maxTokens: 2048, contextSize: 4096,
    } as TextParams;
  }
}

export const getAiSettingsViewModel = (
  options: AiSettingsViewModelOptions,
): AiSettingsViewModelInterface => AiSettingsViewModel.create(options);
