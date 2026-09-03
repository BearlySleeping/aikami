// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
//
// Singleton service that manages the central configuration state for the
// dev/config dashboard. API keys are encrypted at rest via crypto_vault;
// non-sensitive settings are stored as plain JSON in localStorage.
// Firestore sync is optional — works entirely offline for Tauri / local use.
//
// C-463: Now manages AiProvider/AiConnection/RoleAssignments alongside the
// legacy ConnectionEntry shape. On load, v1 vaults are migrated to v2.
//
// Contract: C-463

import { BUILT_IN_PRESETS, DEFAULT_VOICE_ARCHETYPES, type GenParamPreset } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AiConnection,
  AiProvider,
  AiRole,
  ConfigState,
  ImageConfig,
  ImageParams,
  ModelConfigEntry,
  ProviderId,
  RoleAssignments,
  TextParams,
  VoiceConfig,
  VoiceParams,
} from '@aikami/types';
import { clearVault, decrypt, encrypt } from '$lib/views/utils/crypto_vault';
import type {
  Connection,
  ConnectionCapability,
  ConnectionId,
  GenerationParams,
  Lorebook,
  LorebookEntry,
} from '$types';
import { migrateVaultV1ToV2 } from './config_migration.ts';

// ---------------------------------------------------------------------------
// Re-exports from @aikami/constants and @aikami/types for backward compatibility
// ---------------------------------------------------------------------------

export {
  BUILT_IN_PRESETS,
  DEFAULT_VOICE_ARCHETYPES,
  EMBEDDING_MODELS,
  EMOTION_METHODS,
  type GenParamPreset,
  IMAGE_PROVIDERS,
  KOKORO_VOICES,
  MEMORY_TYPES,
  TEXT_PROVIDERS,
  VOICE_ENGINES,
  VOICE_PROVIDERS,
} from '@aikami/constants';

/** Resolved text generation provider ready for API calls. */
type ResolvedTextProvider = {
  /** Model identifier (e.g. 'openrouter/owl-alpha'). */
  model: string;
  /** Provider name (e.g. 'openrouter'). */
  provider: string;
  /** Base URL for the provider's API endpoint. */
  endpoint: string;
  /** API key for the resolved provider, or undefined if not configured. */
  apiKey: string | undefined;
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export type ConfigServiceOptions = BaseFrontendClassOptions;

export type ConfigServiceInterface = BaseFrontendClassInterface & {
  /** Current configuration state. */
  readonly state: ConfigState;
  /** Whether the vault has been loaded from localStorage. */
  readonly isLoaded: boolean;

  /** Loads encrypted vault and plain config from localStorage. */
  load(pin?: string): Promise<void>;
  /** Persists all config to localStorage. */
  save(): Promise<void>;
  /** Clears all stored config. */
  reset(): Promise<void>;

  /** Updates the text provider selection (legacy — prefer connections). */
  /** Replaces the full models array. */
  setModels(models: ModelConfigEntry[]): void;
  /** Updates a single model config by index. */
  updateModel(index: number, config: Partial<ModelConfigEntry>): void;
  /** Updates voice config (partial merge). */
  setVoiceConfig(config: Partial<VoiceConfig>): void;
  /** Updates image config (partial merge). */
  setImageConfig(config: Partial<ImageConfig>): void;
  /** Updates generation parameters (partial merge). */
  setGenerationParams(params: Partial<GenerationParams>): void;

  /**
   * Resolves the active text generation provider from the current
   * configuration state. Resolves through the `narration` role (C-463).
   *
   * Throws if no model is configured.
   */
  getActiveTextProvider(): ResolvedTextProvider;

  // ── Connection management (C-230 / C-463) ──────────────────────────

  /** Adds a new connection and returns its ID. */
  addConnection(connection: Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId;
  /** Updates an existing connection by ID. */
  updateConnection(id: ConnectionId, patch: Partial<Omit<Connection, 'id' | 'createdAt'>>): void;
  /** Deletes a connection by ID. */
  deleteConnection(id: ConnectionId): void;
  /** Duplicates a connection (new UUID, "(copy)" suffix). */
  duplicateConnection(id: ConnectionId): ConnectionId | undefined;
  /** Sets the default connection (clears previous default). */
  setDefaultConnection(id: ConnectionId): void;
  /** Returns a connection by ID, or undefined. */
  getConnection(id: ConnectionId): Connection | undefined;

  /**
   * Returns the stored API key for a provider within a capability.
   *
   * Reads from `connections[]` (the canonical store since C-230). Returns
   * `undefined` when no matching connection exists or no key is set.
   */
  getApiKey(provider: string, capability?: ConnectionCapability): string | undefined;

  // ── Provider management (C-463) ────────────────────────────────────

  /** Adds a new provider and returns its ID. */
  addProvider(options: Omit<AiProvider, 'id'>): ProviderId;
  /** Updates an existing provider by ID. */
  updateProvider(id: ProviderId, patch: Partial<Omit<AiProvider, 'id'>>): void;
  /** Deletes a provider and its connections by ID. */
  deleteProvider(id: ProviderId): void;
  /** Returns a provider by ID, or undefined. */
  getProvider(id: ProviderId): AiProvider | undefined;
  /** Returns all providers. */
  getProviders(): readonly AiProvider[];

  // ── AiConnection management (C-463) ────────────────────────────────

  /** Adds a new AI connection and returns its ID. */
  addAiConnection(options: Omit<AiConnection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId;
  /** Updates an existing AI connection by ID. */
  updateAiConnection(id: ConnectionId, patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>>): void;
  /** Deletes an AI connection by ID. */
  deleteAiConnection(id: ConnectionId): void;
  /** Returns an AI connection by ID, or undefined. */
  getAiConnection(id: ConnectionId): AiConnection | undefined;
  /** Returns all AI connections. */
  getAiConnections(): readonly AiConnection[];

  // ── Role management (C-463) ────────────────────────────────────────

  /** Assigns a connection to a role. */
  setRoleAssignment(role: AiRole, connectionId: ConnectionId): void;
  /** Clears a role assignment. */
  clearRoleAssignment(role: AiRole): void;
  /** Returns all role assignments. */
  getRoleAssignments(): RoleAssignments;
  /**
   * Resolves the active provider+connection for a role.
   * Returns undefined if the role has no assignment or the connection is gone.
   */
  resolveRole(role: AiRole): ResolvedTextProvider | undefined;

  // ── Preset management (C-230) ─────────────────────────────────────

  /** Adds a user-defined preset. */
  addPreset(preset: Omit<GenParamPreset, 'id' | 'isBuiltIn'>): string;
  /** Deletes a user-defined preset. Built-in presets are a no-op. */
  deletePreset(id: string): void;
  /** Returns all presets (built-in merged with user-defined). */
  getPresets(): GenParamPreset[];

  // ── Macro preset integration (C-237) ──────────────────────────────
  /** Loads macro presets from localStorage. */
  loadMacroPresets: () => void;

  // ── Lorebook management (C-238) ──────────────────────────────────

  /** Adds a new lorebook and returns its ID. */
  addLorebook: (options: { name: string; description: string }) => string;
  /** Updates an existing lorebook by ID. */
  updateLorebook: (options: {
    id: string;
    patch: Partial<Pick<Lorebook, 'name' | 'description'>>;
  }) => void;
  /** Deletes a lorebook and all its entries. */
  deleteLorebook: (options: { id: string }) => void;
  /** Returns all lorebooks. */
  getLorebooks: () => Lorebook[];
  /** Returns a single lorebook by ID, or undefined. */
  getLorebook: (options: { id: string }) => Lorebook | undefined;

  /** Adds an entry to a lorebook. Returns the entry ID. */
  addEntry: (options: {
    lorebookId: string;
    entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>;
  }) => string;
  /** Updates an entry within a lorebook. */
  updateEntry: (options: {
    lorebookId: string;
    entryId: string;
    patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt' | 'lorebookId'>>;
  }) => void;
  /** Deletes an entry from a lorebook. */
  deleteEntry: (options: { lorebookId: string; entryId: string }) => void;
  /** Reorders entries within a lorebook (provides the full new order by entry ID). */
  reorderEntries: (options: { lorebookId: string; entryIds: string[] }) => void;

  /** Sets the lorebook IDs assigned to the active chat session. */
  setActiveLorebookIds: (options: { ids: string[] }) => void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_CONFIGS: ModelConfigEntry[] = [];

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  autoSpeech: false,
  engine: 'kokoro',
  pitch: 0,
  provider: 'kokoro',
  speed: 1.0,
  voiceArchetypes: [...DEFAULT_VOICE_ARCHETYPES],
  voiceId: 'af_heart',
};

const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  backend: 'comfyui',
  cfgScale: 7.5,
  checkpoint: 'sd_xl_base_1.0',
  height: 1024,
  provider: 'comfyui',
  reviewBeforeGenerate: false,
  steps: 30,
  styleProfileId: 'auto',
  width: 1024,
};

const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  contextSize: 4096,
  maxTokens: 1024,
  presencePenalty: 0,
  repetitionPenalty: 1.1,
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
};

const DEFAULT_STATE: ConfigState = {
  activeLorebookIds: [],
  connections: [],
  defaultConnectionId: null,
  defaultByCapability: {},
  providers: [],
  aiConnections: [],
  roles: {},
  schemaVersion: 0,
  generationParams: { ...DEFAULT_GENERATION_PARAMS },
  image: { ...DEFAULT_IMAGE_CONFIG },
  lorebooks: [],
  models: [...DEFAULT_MODEL_CONFIGS],
  presets: [...BUILT_IN_PRESETS],
  voice: { ...DEFAULT_VOICE_CONFIG },
};

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const PLAIN_CONFIG_KEY = 'aikami_config';

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

class ConfigService
  extends BaseFrontendClass<ConfigServiceOptions>
  implements ConfigServiceInterface
{
  state = $state<ConfigState>({ ...DEFAULT_STATE });
  isLoaded = $state(false);

  // ── Persistence ───────────────────────────────────────────────────────

  async load(pin?: string): Promise<void> {
    this.debug('ConfigService.load');

    // Vault-held provider keys are applied after step 2, because the plain
    // config replaces the whole voice/image object and would clobber them.
    let vaultVoiceApiKey: string | undefined;
    let vaultImageApiKey: string | undefined;

    // 1. Load from encrypted vault
    const raw = await decrypt({ pin });
    if (raw) {
      try {
        const vault = JSON.parse(raw) as Record<string, unknown>;

        // C-463: Detect v1 vs v2 vault by schemaVersion
        const schemaVersion = (vault.schemaVersion as number) ?? 0;

        if (schemaVersion === 2) {
          // ── v2 vault: load the new shape directly ────────────────
          if (Array.isArray(vault.providers)) {
            this.state.providers = vault.providers as AiProvider[];
          }
          if (Array.isArray(vault.connections)) {
            this.state.aiConnections = vault.connections as AiConnection[];
          }
          if (vault.roles && typeof vault.roles === 'object') {
            this.state.roles = vault.roles as RoleAssignments;
          }
          this.state.schemaVersion = 2;

          // Backfill legacy connections array from v2 connections for ViewModel compat
          this._backfillLegacyConnections();

          // Preserve legacy-only rows that do not have a corresponding v2 connection.
          if (vault.legacy) {
            const legacyPayload = vault.legacy as Record<string, unknown>;
            if (Array.isArray(legacyPayload.connections)) {
              const aiConnectionIds = new Set(
                this.state.aiConnections.map((connection) => connection.id),
              );
              const legacyConnections = (legacyPayload.connections as Connection[]).filter(
                (connection) => !aiConnectionIds.has(connection.id),
              );
              this.state.connections = [...this.state.connections, ...legacyConnections];
            }
          }
        } else {
          // ── v1 vault: migrate to v2 ──────────────────────────────
          try {
            // Prune stale connections first (existing behavior)
            if (Array.isArray(vault.connections)) {
              const cleaned = (vault.connections as Connection[]).filter(
                (c) =>
                  c.source === 'stored' ||
                  (c.source === 'env' &&
                    ((c.apiKey && c.apiKey.length > 0) ||
                      c.provider === 'ollama' ||
                      c.provider === 'llamacpp' ||
                      c.provider === 'ooba')) ||
                  (c.source === 'detected' &&
                    (c.provider === 'ollama' ||
                      c.provider === 'llamacpp' ||
                      c.provider === 'ooba' ||
                      c.provider === 'comfyui' ||
                      c.provider === 'kokoro')),
              );
              vault.connections = cleaned;
            }

            // Run migration
            const v2 = migrateVaultV1ToV2(vault as Record<string, unknown>);

            this.state.providers = v2.providers;
            this.state.aiConnections = v2.connections;
            this.state.roles = v2.roles;
            this.state.schemaVersion = 2;

            // Keep user presets from migrated vault
            if (Array.isArray(v2.userPresets)) {
              const userPresets = v2.userPresets as GenParamPreset[];
              const builtInIds = new Set<string>(BUILT_IN_PRESETS.map((p) => p.id));
              this.state.presets = [
                ...BUILT_IN_PRESETS,
                ...userPresets.filter((p) => !builtInIds.has(p.id)),
              ];
            }

            // Backfill legacy connections array
            this._backfillLegacyConnections();

            this.info('migration:completed', {
              providersCreated: v2.providers.length,
              connectionsMigrated: v2.connections.length,
              rolesSeeded: Object.keys(v2.roles).length,
            });
          } catch (migrationError) {
            // AC-6: Failed migration never writes partial vault.
            // Log a warning, fall back to empty state.
            this.warn('load:migration-failed', { error: String(migrationError) });
            this.state = this._makeDefaultState();
            this.state.schemaVersion = 2;
          }
        }

        // Legacy: load defaultConnectionId and defaultByCapability for ViewModel compat.
        // In v2 vaults these are stored inside `legacy`.
        const legacySource =
          schemaVersion === 2
            ? ((vault.legacy as Record<string, unknown> | undefined) ?? vault)
            : vault;

        if (
          typeof legacySource.defaultConnectionId === 'string' ||
          legacySource.defaultConnectionId === null
        ) {
          this.state.defaultConnectionId = legacySource.defaultConnectionId as ConnectionId | null;
        }
        if (legacySource.defaultByCapability && typeof legacySource.defaultByCapability === 'object') {
          this.state.defaultByCapability = legacySource.defaultByCapability as Record<
            string,
            string | null
          >;
        }
        if (typeof legacySource.voiceApiKey === 'string') {
          vaultVoiceApiKey = legacySource.voiceApiKey as string;
        }
        if (typeof legacySource.imageApiKey === 'string') {
          vaultImageApiKey = legacySource.imageApiKey as string;
        }

        // Load user presets from vault (only if not already set by migration)
        if (
          Array.isArray(vault.userPresets) &&
          this.state.presets.every((preset) => preset.isBuiltIn)
        ) {
          const userPresets = vault.userPresets as GenParamPreset[];
          const builtInIds = new Set<string>(BUILT_IN_PRESETS.map((p) => p.id));
          this.state.presets = [
            ...BUILT_IN_PRESETS,
            ...userPresets.filter((p) => !builtInIds.has(p.id)),
          ];
        }
      } catch {
        this.warn('load: failed to parse vault JSON');
      }
    }

    // 2. Load non-sensitive config from plain localStorage
    const plain = localStorage.getItem(PLAIN_CONFIG_KEY);
    if (plain) {
      try {
        const parsed = JSON.parse(plain) as Partial<ConfigState>;
        if (parsed.models) {
          this.state.models = parsed.models;
        }
        if (parsed.voice) {
          this.state.voice = { ...DEFAULT_VOICE_CONFIG, ...parsed.voice };
        }
        if (parsed.image) {
          this.state.image = { ...DEFAULT_IMAGE_CONFIG, ...parsed.image };
        }
        if (parsed.generationParams) {
          this.state.generationParams = {
            ...DEFAULT_GENERATION_PARAMS,
            ...(parsed.generationParams as Partial<GenerationParams>),
          };
        }
        if (Array.isArray(parsed.lorebooks)) {
          this.state.lorebooks = parsed.lorebooks.map(this._normalizeLorebook) as unknown as import('@aikami/types').LorebookEntry[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
        }
        if (Array.isArray(parsed.activeLorebookIds)) {
          this.state.activeLorebookIds = parsed.activeLorebookIds as string[];
        }
      } catch {
        this.warn('load: failed to parse plain config');
      }
    }

    // 3. Apply vault-held provider keys over the plain config. A key still
    //    sitting in the plain blob is pre-migration cleartext — keep it so
    //    nothing is lost, and the next save() moves it into the vault.
    if (vaultVoiceApiKey) {
      this.state.voice = { ...this.state.voice, apiKey: vaultVoiceApiKey };
    }
    if (vaultImageApiKey) {
      this.state.image = { ...this.state.image, apiKey: vaultImageApiKey };
    }

    // 4. Reconcile defaults: drop any pointing at a pruned connection, then
    //    re-derive isDefault so the persisted flags cannot contradict the map.
    this._pruneDefaults();
    this._backfillDefaultsFromFlags();
    this._syncDefaultFlags();

    this.isLoaded = true;
  }

  async save(): Promise<void> {
    this.debug('ConfigService.save');

    // C-463: Build v2 vault payload. Credentials live on providers.
    const userPresets = this.state.presets.filter((p) => !p.isBuiltIn);

    // Build legacy payload for rollback (exactly one release).
    // Always populated — the loader reads `defaultByCapability`,
    // `voiceApiKey` etc. from `legacy` in v2 vaults.
    const legacyPayload = {
      connections: this.state.connections,
      defaultConnectionId: this.state.defaultConnectionId,
      defaultByCapability: this.state.defaultByCapability,
      voiceApiKey: this.state.voice.apiKey ?? '',
      imageApiKey: this.state.image.apiKey ?? '',
      userPresets,
    };

    const vaultPayload = JSON.stringify({
      schemaVersion: 2,
      providers: this.state.providers,
      connections: this.state.aiConnections,
      roles: this.state.roles,
      userPresets,
      // legacy payload for rollback (one release window)
      legacy: legacyPayload,
    });
    await encrypt({ text: vaultPayload });

    // Plain config (non-sensitive). `apiKey` is stripped from voice/image —
    // it used to be written here in cleartext alongside the encrypted vault.
    const { apiKey: _voiceKey, ...voiceWithoutKey } = this.state.voice;
    const { apiKey: _imageKey, ...imageWithoutKey } = this.state.image;
    const plain: Record<string, unknown> = {
      activeLorebookIds: this.state.activeLorebookIds,
      generationParams: this.state.generationParams,
      image: imageWithoutKey,
      lorebooks: this.state.lorebooks,
      models: this.state.models,
      voice: voiceWithoutKey,
    };
    localStorage.setItem(PLAIN_CONFIG_KEY, JSON.stringify(plain));
  }

  async reset(): Promise<void> {
    this.debug('ConfigService.reset');
    this.state = this._makeDefaultState();
    await clearVault();
    localStorage.removeItem(PLAIN_CONFIG_KEY);
  }

  /** Returns a fresh deep copy of the default state (no shared references). */
  private _makeDefaultState(): ConfigState {
    return {
      activeLorebookIds: [],
      connections: [],
      defaultConnectionId: null,
      defaultByCapability: {},
      providers: [],
      aiConnections: [],
      roles: {},
      schemaVersion: 0,
      generationParams: { ...DEFAULT_GENERATION_PARAMS },
      image: { ...DEFAULT_IMAGE_CONFIG },
      lorebooks: [],
      models: [],
      presets: [...BUILT_IN_PRESETS],
      voice: { ...DEFAULT_VOICE_CONFIG },
    };
  }

  /**
   * Backfills the legacy `connections` array from the new `aiConnections`
   * and `providers` arrays for ViewModel backward compatibility.
   */
  private _backfillLegacyConnections(): void {
    this.state.connections = this.state.aiConnections.map((aiConn): Connection => {
      const provider = this.state.providers.find((p) => p.id === aiConn.providerId);
      const textParams = aiConn.capability === 'text' ? (aiConn.params as TextParams) : undefined;
      const genParams = {
        temperature: textParams?.temperature ?? 0.7,
        topP: textParams?.topP ?? 0.9,
        topK: textParams?.topK ?? 40,
        repetitionPenalty: textParams?.repetitionPenalty ?? 1.1,
        presencePenalty: textParams?.presencePenalty ?? 0,
        maxTokens: textParams?.maxTokens ?? 1024,
        contextSize: textParams?.contextSize ?? 4096,
      };
      let imageOptions: Connection['imageOptions'];
      if (aiConn.capability === 'image') {
        const imageParams = aiConn.params as ImageParams;
        imageOptions = {
          checkpoint: imageParams.checkpoint,
          width: imageParams.width,
          height: imageParams.height,
          steps: imageParams.steps,
          cfg: imageParams.cfg,
        };
      }
      let voiceOptions: Connection['voiceOptions'];
      if (aiConn.capability === 'voice') {
        const voiceParams = aiConn.params as VoiceParams;
        voiceOptions = {
          voiceId: voiceParams.voiceId,
          speed: voiceParams.speed,
          pitch: voiceParams.pitch,
        };
      }

      return {
        id: aiConn.id,
        name: aiConn.label,
        capability: aiConn.capability,
        provider: provider?.registryId ?? '',
        apiKey: provider?.credential ?? '',
        baseUrl: provider?.baseUrl ?? '',
        model: aiConn.model,
        generationParams: genParams,
        isDefault: false,
        source: provider?.source ?? 'stored',
        createdAt: aiConn.createdAt,
        updatedAt: aiConn.updatedAt,
        imageOptions,
        voiceOptions,
      };
    });
  }

  /** Normalizes a persisted lorebook from the shared storage shape to the client-local Lorebook type. */
  private _normalizeLorebook(lb: import('@aikami/types').LorebookEntry): Lorebook {
    return {
      id: lb.id,
      name: lb.name,
      description: lb.description,
      entries: (lb.entries ?? []).map((e) => ({
        id: e.id,
        keywords: e.keywords ?? [],
        content: e.content,
        priority: e.priority ?? 0,
        constant: e.constant ?? false,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      createdAt: lb.createdAt,
      updatedAt: lb.updatedAt,
    };
  }

  // ── Mutators ──────────────────────────────────────────────────────────

  setModels(models: ModelConfigEntry[]): void {
    this.state.models = models;
  }

  updateModel(index: number, config: Partial<ModelConfigEntry>): void {
    if (index < 0 || index >= this.state.models.length) {
      return;
    }
    this.state.models = this.state.models.map((m, i) => (i === index ? { ...m, ...config } : m));
  }

  setVoiceConfig(config: Partial<VoiceConfig>): void {
    this.state.voice = { ...this.state.voice, ...config };
  }

  setImageConfig(config: Partial<ImageConfig>): void {
    this.state.image = { ...this.state.image, ...config };
  }

  setGenerationParams(params: Partial<GenerationParams>): void {
    this.state.generationParams = { ...this.state.generationParams, ...params };
  }

  // ── Text provider resolution ─────────────────────────────────────────

  getActiveTextProvider(): ResolvedTextProvider {
    // C-463: Resolve through the `narration` role first.
    const narrationId = this.state.roles.narration;
    if (narrationId) {
      const aiConn = this.state.aiConnections.find((c) => c.id === narrationId);
      if (aiConn && aiConn.capability === 'text') {
        const provider = this.state.providers.find((p) => p.id === aiConn.providerId);
        if (provider) {
          return {
            model: aiConn.model,
            provider: provider.registryId,
            endpoint: provider.baseUrl || '',
            apiKey: provider.credential || '',
          };
        }
      }
    }

    // Fallback: legacy resolution from connections array
    const { connections: allConnections = [], defaultConnectionId } = this.state;
    const connections = allConnections.filter((c) => this._capabilityOf(c) === 'text');

    // Legacy Priority 1: text capability default
    const textDefaultId = this.state.defaultByCapability?.text;
    if (textDefaultId) {
      const conn = connections.find((c) => c.id === textDefaultId);
      if (conn) {
        return {
          model: conn.model,
          provider: conn.provider,
          endpoint: conn.baseUrl || '',
          apiKey: conn.apiKey || '',
        };
      }
    }

    // Legacy Priority 2: defaultConnectionId
    if (defaultConnectionId) {
      const conn = connections.find((c) => c.id === defaultConnectionId);
      if (conn) {
        return {
          model: conn.model,
          provider: conn.provider,
          endpoint: conn.baseUrl || '',
          apiKey: conn.apiKey || '',
        };
      }
    }

    // Legacy Priority 3: first available
    if (connections.length > 0) {
      const conn = connections[0];
      return {
        model: conn.model,
        provider: conn.provider,
        endpoint: conn.baseUrl || '',
        apiKey: conn.apiKey || '',
      };
    }

    throw new Error(
      'No text generation provider configured. ' +
        'Create a Connection in Settings or add a provider on the capability screen.',
    );
  }

  // ── Connection management (C-230 / C-463) ─────────────────────────

  addConnection(connection: Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newConnection: Connection = {
      ...connection,
      createdAt: now,
      id,
      updatedAt: now,
    };

    const capability = this._capabilityOf(newConnection);
    const claimsDefault =
      newConnection.isDefault || this.state.defaultByCapability?.[capability] == null;

    this.state.connections = [...this.state.connections, newConnection];

    // First connection of a capability claims that capability's default —
    // capabilities never compete with each other for one global slot.
    if (claimsDefault) {
      this._setCapabilityDefault({ id, capability });
    } else {
      this._syncDefaultFlags();
    }

    return id;
  }

  updateConnection(id: ConnectionId, patch: Partial<Omit<Connection, 'id' | 'createdAt'>>): void {
    // Build the next array in one pass. The previous implementation reassigned
    // `this.state.connections` from inside this callback to clear the old
    // default, and the outer map — built from the pre-mutation array — then
    // overwrote it, leaving two connections flagged default.
    const next = this.state.connections.map((c) =>
      c.id === id ? { ...c, ...patch, id: c.id, updatedAt: new Date().toISOString() } : c,
    );
    this.state.connections = next;

    const updated = next.find((c) => c.id === id);
    if (!updated) {
      return;
    }

    if (patch.isDefault) {
      this._setCapabilityDefault({ id, capability: this._capabilityOf(updated) });
      return;
    }

    // A capability change can orphan the old capability's default.
    this._pruneDefaults();
    this._syncDefaultFlags();
  }

  deleteConnection(id: ConnectionId): void {
    const removed = this.state.connections.find((c) => c.id === id);
    this.state.connections = this.state.connections.filter((c) => c.id !== id);

    if (!removed) {
      return;
    }

    // Promote a replacement from the SAME capability. Promoting the first
    // remaining connection of any capability is what let a voice connection
    // become the text default.
    const capability = this._capabilityOf(removed);
    if (this.state.defaultByCapability?.[capability] === id) {
      const replacement = this.state.connections.find(
        (c) => this._capabilityOf(c) === capability,
      );
      if (replacement) {
        this._setCapabilityDefault({ id: replacement.id, capability });
      } else {
        this._clearCapabilityDefault(capability);
      }
      return;
    }

    this._pruneDefaults();
    this._syncDefaultFlags();
  }

  duplicateConnection(id: ConnectionId): ConnectionId | undefined {
    const original = this.state.connections.find((c) => c.id === id);
    if (!original) {
      return undefined;
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const copy = {
      ...original,
      createdAt: now,
      id: newId,
      isDefault: false,
      name: `${original.name} (copy)`,
      updatedAt: now,
    } as unknown as import('@aikami/types').ConnectionEntry; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation

    this.state.connections = [...this.state.connections, copy];
    return newId;
  }

  setDefaultConnection(id: ConnectionId): void {
    const connection = this.state.connections.find((c) => c.id === id);
    if (!connection) {
      return;
    }
    this._setCapabilityDefault({ id, capability: this._capabilityOf(connection) });
  }

  // ── C-463: Provider management ─────────────────────────────────────

  addProvider(options: Omit<AiProvider, 'id'>): ProviderId {
    const id = crypto.randomUUID();
    const provider: AiProvider = { id, ...options };
    this.state.providers = [...this.state.providers, provider];
    return id;
  }

  updateProvider(id: ProviderId, patch: Partial<Omit<AiProvider, 'id'>>): void {
    this.state.providers = this.state.providers.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    );
  }

  deleteProvider(id: ProviderId): void {
    // Also delete connections referencing this provider
    const deletedConnectionIds = new Set(
      this.state.aiConnections
        .filter((connection) => connection.providerId === id)
        .map((connection) => connection.id),
    );
    this.state.aiConnections = this.state.aiConnections.filter(
      (c) => c.providerId !== id,
    );
    this._clearRolesForConnectionIds(deletedConnectionIds);
    this.state.providers = this.state.providers.filter((p) => p.id !== id);
  }

  getProvider(id: ProviderId): AiProvider | undefined {
    return this.state.providers.find((p) => p.id === id);
  }

  getProviders(): readonly AiProvider[] {
    return this.state.providers;
  }

  // ── C-463: AiConnection management ─────────────────────────────────

  addAiConnection(options: Omit<AiConnection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const conn: AiConnection = {
      ...options,
      createdAt: now,
      id,
      updatedAt: now,
    };
    this.state.aiConnections = [...this.state.aiConnections, conn];
    return id;
  }

  updateAiConnection(id: ConnectionId, patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>>): void {
    this.state.aiConnections = this.state.aiConnections.map((c) =>
      c.id === id ? { ...c, ...patch, id: c.id, updatedAt: new Date().toISOString() } : c,
    );
  }

  deleteAiConnection(id: ConnectionId): void {
    this.state.aiConnections = this.state.aiConnections.filter((c) => c.id !== id);
    this._clearRolesForConnectionIds(new Set([id]));
  }

  getAiConnection(id: ConnectionId): AiConnection | undefined {
    return this.state.aiConnections.find((c) => c.id === id);
  }

  getAiConnections(): readonly AiConnection[] {
    return this.state.aiConnections;
  }

  // ── C-463: Role management ─────────────────────────────────────────

  setRoleAssignment(role: AiRole, connectionId: ConnectionId): void {
    this.state.roles = { ...this.state.roles, [role]: connectionId };
  }

  clearRoleAssignment(role: AiRole): void {
    const next = { ...this.state.roles };
    delete next[role];
    this.state.roles = next;
  }

  getRoleAssignments(): RoleAssignments {
    return { ...this.state.roles };
  }

  resolveRole(role: AiRole): ResolvedTextProvider | undefined {
    const connectionId = this.state.roles[role];
    if (!connectionId) {
      return undefined;
    }

    const aiConn = this.state.aiConnections.find((c) => c.id === connectionId);
    if (!aiConn) {
      return undefined;
    }

    const provider = this.state.providers.find((p) => p.id === aiConn.providerId);
    if (!provider) {
      return undefined;
    }

    return {
      model: aiConn.model,
      provider: provider.registryId,
      endpoint: provider.baseUrl || '',
      apiKey: provider.credential || '',
    };
  }

  /** Clears role assignments that reference connections removed from the configuration. */
  private _clearRolesForConnectionIds(connectionIds: ReadonlySet<ConnectionId>): void {
    this.state.roles = Object.fromEntries(
      Object.entries(this.state.roles).filter(
        ([, connectionId]) => !connectionIds.has(connectionId),
      ),
    );
  }

  // ── Private: default bookkeeping ─────────────────────────────────────
  //
  // `defaultByCapability` is the single source of truth. `isDefault` on each
  // connection is derived from it, and `defaultConnectionId` is a legacy
  // alias that mirrors the *text* default only — it is still read by older
  // persisted vaults and by getActiveTextProvider's fallback rung.

  /** Capability of a connection, defaulting to 'text' for pre-C-230 rows. */
  private _capabilityOf(connection: { capability?: string }): ConnectionCapability {
    return (connection.capability ?? 'text') as ConnectionCapability; // guard-ignore lint/type-safety/casting: capability is a closed union persisted as string
  }

  /** Points a capability at a connection and re-derives every isDefault flag. */
  private _setCapabilityDefault(options: {
    id: ConnectionId;
    capability: ConnectionCapability;
  }): void {
    this.state.defaultByCapability = {
      ...this.state.defaultByCapability,
      [options.capability]: options.id,
    };
    if (options.capability === 'text') {
      this.state.defaultConnectionId = options.id;
    }
    this._syncDefaultFlags();
  }

  /** Drops a capability's default and re-derives every isDefault flag. */
  private _clearCapabilityDefault(capability: ConnectionCapability): void {
    const next = { ...this.state.defaultByCapability };
    delete next[capability];
    this.state.defaultByCapability = next;
    if (capability === 'text') {
      this.state.defaultConnectionId = null;
    }
    this._syncDefaultFlags();
  }

  /** Removes capability defaults whose connection no longer exists. */
  private _pruneDefaults(): void {
    const ids = new Set(this.state.connections.map((c) => c.id));
    const next: Record<string, string | null> = {};
    for (const [capability, id] of Object.entries(this.state.defaultByCapability ?? {})) {
      if (id && ids.has(id)) {
        next[capability] = id;
      }
    }
    this.state.defaultByCapability = next;
    if (this.state.defaultConnectionId && !ids.has(this.state.defaultConnectionId)) {
      this.state.defaultConnectionId = null;
    }
  }

  /**
   * Seeds missing capability defaults from vaults written before the map was
   * persisted: prefer a connection already flagged `isDefault`, else the
   * legacy `defaultConnectionId`, else the first of that capability.
   */
  private _backfillDefaultsFromFlags(): void {
    const defaults = { ...(this.state.defaultByCapability ?? {}) };
    for (const connection of this.state.connections) {
      const capability = this._capabilityOf(connection);
      if (defaults[capability]) {
        continue;
      }
      const candidates = this.state.connections.filter(
        (c) => this._capabilityOf(c) === capability,
      );
      const chosen =
        candidates.find((c) => c.isDefault) ??
        candidates.find((c) => c.id === this.state.defaultConnectionId) ??
        candidates[0];
      if (chosen) {
        defaults[capability] = chosen.id;
      }
    }
    this.state.defaultByCapability = defaults;
    const textDefault = defaults.text;
    if (textDefault) {
      this.state.defaultConnectionId = textDefault;
    }
  }

  /** Re-derives `isDefault` on every connection from `defaultByCapability`. */
  private _syncDefaultFlags(): void {
    const defaults = this.state.defaultByCapability ?? {};
    let changed = false;
    const next = this.state.connections.map((c) => {
      const isDefault = defaults[this._capabilityOf(c)] === c.id;
      if (c.isDefault === isDefault) {
        return c;
      }
      changed = true;
      return { ...c, isDefault };
    });
    // Only reassign when a flag actually moved — capability_view_model runs
    // an $effect over `connections`, and an unconditional new array would
    // wake it on every no-op reconcile.
    if (changed) {
      this.state.connections = next;
    }
  }

  getConnection(id: ConnectionId): Connection | undefined {
    return this.state.connections.find((c) => c.id === id) as Connection | undefined;
  }

  getApiKey(provider: string, capability: ConnectionCapability = 'text'): string | undefined {
    const matches = (c: import('@aikami/types').ConnectionEntry): boolean =>
      (c.capability ?? 'text') === capability && c.provider === provider;

    // Prefer the default connection, but only when it also matches the
    // requested provider and capability; otherwise fall back to the first
    // matching connection.
    const defaultConnection = this.state.defaultConnectionId
      ? this.state.connections.find((c) => c.id === this.state.defaultConnectionId && matches(c))
      : undefined;
    const connection = defaultConnection ?? this.state.connections.find(matches);
    return connection?.apiKey || undefined;
  }

  // ── Preset management (C-230) ─────────────────────────────────────

  addPreset(preset: Omit<GenParamPreset, 'id' | 'isBuiltIn'>): string {
    const id = `user-${crypto.randomUUID()}`;
    const newPreset: GenParamPreset = {
      ...preset,
      id,
      isBuiltIn: false,
    };
    this.state.presets = [...this.state.presets, newPreset];
    return id;
  }

  deletePreset(id: string): void {
    const preset = this.state.presets.find((p) => p.id === id);
    if (!preset || preset.isBuiltIn) {
      this.warn('deletePreset: cannot delete built-in or missing preset', { id });
      return;
    }
    this.state.presets = this.state.presets.filter((p) => p.id !== id);
  }

  getPresets(): GenParamPreset[] {
    return this.state.presets;
  }

  // ── Macro preset integration (C-237) ──────────────────────────────

  loadMacroPresets(): void {
    import('$services').then((mod) => {
      mod.macroPresetStore.loadPresets();
      this.debug('loadMacroPresets:loaded', { count: mod.macroPresetStore.presets.length });
    });
  }

  // ── Lorebook management (C-238) ──────────────────────────────────

  addLorebook(options: { name: string; description: string }): string {
    const { name, description } = options;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const lorebook: Lorebook = {
      id,
      name,
      description,
      entries: [],
      createdAt: now,
      updatedAt: now,
    };
    this.state.lorebooks = [
      ...this.state.lorebooks,
      lorebook as unknown as import('@aikami/types').LorebookEntry, // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
    ];
    return id;
  }

  updateLorebook(options: {
    id: string;
    patch: Partial<Pick<Lorebook, 'name' | 'description'>>;
  }): void {
    const { id, patch } = options;
    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== id) {
        return lb;
      }
      return { ...lb, ...patch, updatedAt: new Date().toISOString() };
    });
  }

  deleteLorebook(options: { id: string }): void {
    const { id } = options;
    this.state.lorebooks = this.state.lorebooks.filter((lb) => lb.id !== id);
  }

  getLorebooks(): Lorebook[] {
    return this.state.lorebooks as unknown as Lorebook[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
  }

  getLorebook(options: { id: string }): Lorebook | undefined {
    return this.state.lorebooks.find((lb) => lb.id === options.id) as unknown as Lorebook | undefined; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
  }

  addEntry(options: {
    lorebookId: string;
    entry: Omit<LorebookEntry, 'id' | 'createdAt' | 'updatedAt'>;
  }): string {
    const { lorebookId, entry } = options;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newEntry: LorebookEntry = { ...entry, id, createdAt: now, updatedAt: now };

    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== lorebookId) {
        return lb;
      }
      return { ...lb, entries: [...lb.entries, newEntry], updatedAt: now };
    }) as unknown as import('@aikami/types').LorebookEntry[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
    return id;
  }

  updateEntry(options: {
    lorebookId: string;
    entryId: string;
    patch: Partial<Omit<LorebookEntry, 'id' | 'createdAt' | 'lorebookId'>>;
  }): void {
    const { lorebookId, entryId, patch } = options;
    const now = new Date().toISOString();

    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== lorebookId) {
        return lb;
      }
      return {
        ...lb,
        entries: lb.entries.map((e) => {
          if (e.id !== entryId) {
            return e;
          }
          return { ...e, ...patch, updatedAt: now };
        }),
        updatedAt: now,
      };
    }) as unknown as import('@aikami/types').LorebookEntry[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
  }

  deleteEntry(options: { lorebookId: string; entryId: string }): void {
    const { lorebookId, entryId } = options;
    const now = new Date().toISOString();

    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== lorebookId) {
        return lb;
      }
      return {
        ...lb,
        entries: lb.entries.filter((e) => e.id !== entryId),
        updatedAt: now,
      };
    }) as unknown as import('@aikami/types').LorebookEntry[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
  }

  reorderEntries(options: { lorebookId: string; entryIds: string[] }): void {
    const { lorebookId, entryIds } = options;
    const now = new Date().toISOString();

    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== lorebookId) {
        return lb;
      }
      const book = lb as unknown as Lorebook; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
      const entryMap = new Map(book.entries.map((e) => [e.id, e]));
      const reordered = entryIds
        .map((id) => entryMap.get(id))
        .filter((e): e is LorebookEntry => e !== undefined);
      return { ...lb, entries: reordered, updatedAt: now };
    }) as unknown as import('@aikami/types').LorebookEntry[]; // guard-ignore lint/type-safety/casting: config service internal state - parsed JSON guaranteed by upstream schema validation
  }

  setActiveLorebookIds(options: { ids: string[] }): void {
    this.state.activeLorebookIds = options.ids;
  }
}

export { ConfigService };

export const configService: ConfigServiceInterface = ConfigService.create({
  className: 'ConfigService',
});
