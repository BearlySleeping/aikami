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
  /** Capability-appropriate params carried by the resolved AiConnection, when present (C-463 wiring). */
  params: TextParams | ImageParams | VoiceParams | undefined;
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

/** Every capability, in a stable order for projection. */
const CAPABILITIES: readonly ConnectionCapability[] = ['text', 'image', 'voice'];

/** Roles each capability owns. */
const ROLES_BY_CAPABILITY: Record<ConnectionCapability, readonly AiRole[]> = {
  text: ['narration', 'dialogue', 'summarization', 'structured'],
  image: ['portrait', 'scene'],
  voice: ['narrator-voice', 'npc-voice'],
};

/**
 * The role a capability's "default" maps onto. `defaultByCapability` and the
 * legacy `defaultConnectionId` are projections of these three.
 */
const PRIMARY_ROLE: Record<ConnectionCapability, AiRole> = {
  text: 'narration',
  image: 'portrait',
  voice: 'narrator-voice',
};

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
          if (typeof vault.voiceApiKey === 'string') {
            vaultVoiceApiKey = vault.voiceApiKey;
          }
          if (typeof vault.imageApiKey === 'string') {
            vaultImageApiKey = vault.imageApiKey;
          }

          // Vaults written by the first C-463 build kept UI-created rows only
          // under `legacy`, because the legacy CRUD did not write through.
          // Absorb them into the real model so `legacy` stops being load-bearing.
          this._absorbLegacyPayload(vault.legacy);
          this._reproject();
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

            this._reproject();

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
    this._reproject();

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
      voiceApiKey: this.state.voice.apiKey ?? '',
      imageApiKey: this.state.image.apiKey ?? '',
      // Rollback only — the loader must not depend on this. See
      // `_absorbLegacyPayload`, which exists because it once did.
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
      presets: [...BUILT_IN_PRESETS],
      voice: { ...DEFAULT_VOICE_CONFIG },
    };
  }

  /**
   * Backfills the legacy `connections` array from the new `aiConnections`
   * and `providers` arrays for ViewModel backward compatibility.
   */
  /** Projects one AiConnection + its provider into the legacy Connection shape. */
  private _projectConnection(options: {
    aiConn: AiConnection;
    provider: AiProvider | undefined;
    isDefault: boolean;
  }): Connection {
    const { aiConn, provider, isDefault } = options;
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
        isDefault,
        source: provider?.source ?? 'stored',
        createdAt: aiConn.createdAt,
        updatedAt: aiConn.updatedAt,
        imageOptions,
        voiceOptions,
    };
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
            params: aiConn.params as TextParams,
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
          params: conn.generationParams as TextParams,
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
          params: conn.generationParams as TextParams,
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
        params: conn.generationParams as TextParams,
      };
    }

    throw new Error(
      'No text generation provider configured. ' +
        'Create a Connection in Settings or add a provider on the capability screen.',
    );
  }

  // ── Connection management (C-230 / C-463) ─────────────────────────

  // ── Legacy Connection API — adapters over the C-463 model ──────────
  //
  // These keep the pre-C-463 `Connection` shape for the ~11 existing call
  // sites, but every mutation now lands in `providers` / `aiConnections` /
  // `roles`. `state.connections`, `defaultConnectionId` and
  // `defaultByCapability` are pure projections rebuilt by `_reproject()` —
  // nothing writes them directly.

  addConnection(connection: Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId {
    const capability = this._capabilityOf(connection);
    const providerId = this._resolveOrCreateProvider({
      registryId: connection.provider,
      baseUrl: connection.baseUrl ?? '',
      credential: connection.apiKey ?? '',
      source: (connection.source ?? 'stored') as AiProvider['source'],
      label: connection.name,
    });

    const id = this.addAiConnection({
      providerId,
      capability,
      label: connection.name,
      model: connection.model,
      params: this._paramsFromLegacy(connection, capability),
    });

    const claimsDefault = connection.isDefault || this.state.roles[PRIMARY_ROLE[capability]] == null;
    if (claimsDefault) {
      this._assignCapabilityRoles({ id, capability });
    }
    this._reproject();
    return id;
  }

  updateConnection(id: ConnectionId, patch: Partial<Omit<Connection, 'id' | 'createdAt'>>): void {
    const existing = this.state.aiConnections.find((c) => c.id === id);
    if (!existing) {
      return;
    }
    const projected = this.state.connections.find((c) => c.id === id);
    const capability = patch.capability ?? existing.capability;

    // Provider-level fields re-resolve the provider: changing a key must
    // update the shared credential, not fork a copy onto this connection.
    const touchesProvider =
      patch.provider !== undefined || patch.apiKey !== undefined || patch.baseUrl !== undefined;
    let providerId = existing.providerId;
    if (touchesProvider) {
      const current = this.state.providers.find((p) => p.id === existing.providerId);
      const registryId = patch.provider ?? current?.registryId ?? '';
      const nextKey = patch.apiKey ?? current?.credential ?? '';
      const nextUrl = patch.baseUrl ?? current?.baseUrl ?? '';
      const sameRegistry = registryId === current?.registryId;
      if (current && sameRegistry) {
        // Same account, edited in place — every sibling connection follows.
        this.updateProvider(current.id, { credential: nextKey, baseUrl: nextUrl });
      } else {
        providerId = this._resolveOrCreateProvider({
          registryId,
          baseUrl: nextUrl,
          credential: nextKey,
          source: (patch.source ?? projected?.source ?? 'stored') as AiProvider['source'],
          label: patch.name ?? existing.label,
        });
      }
    }

    const merged = {
      ...existing,
      providerId,
      capability,
      label: patch.name ?? existing.label,
      model: patch.model ?? existing.model,
    };
    const changesParams =
      capability !== existing.capability ||
      (capability === 'text' && patch.generationParams !== undefined) ||
      (capability === 'image' && patch.imageOptions !== undefined) ||
      (capability === 'voice' && patch.voiceOptions !== undefined);
    if (changesParams) {
      merged.params = this._paramsFromLegacy(patch, capability);
    }
    this.updateAiConnection(id, merged);

    if (patch.isDefault) {
      this._assignCapabilityRoles({ id, capability });
    }
    this._pruneOrphanProviders();
    this._reproject();
  }

  deleteConnection(id: ConnectionId): void {
    const removed = this.state.aiConnections.find((c) => c.id === id);
    if (!removed) {
      return;
    }
    const { capability } = removed;
    this.deleteAiConnection(id);

    // Promote a replacement from the SAME capability into the roles the
    // deletion just freed. Promoting across capabilities is what once let a
    // voice connection become the text default.
    const replacement = this.state.aiConnections.find((c) => c.capability === capability);
    if (replacement) {
      this._assignCapabilityRoles({ id: replacement.id, capability, onlyUnassigned: true });
    }

    this._pruneOrphanProviders();
    this._reproject();
  }

  duplicateConnection(id: ConnectionId): ConnectionId | undefined {
    const original = this.state.aiConnections.find((c) => c.id === id);
    if (!original) {
      return undefined;
    }
    // A copy shares the account — it points at the same provider rather than
    // cloning the credential.
    const newId = this.addAiConnection({
      providerId: original.providerId,
      capability: original.capability,
      label: `${original.label} (copy)`,
      model: original.model,
      params: original.params,
    });
    this._reproject();
    return newId;
  }

  setDefaultConnection(id: ConnectionId): void {
    const connection = this.state.aiConnections.find((c) => c.id === id);
    if (!connection) {
      return;
    }
    this._assignCapabilityRoles({ id, capability: connection.capability });
    this._reproject();
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
      params: aiConn.params,
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

  // ── Private: the C-463 model is the single source of truth ──────────
  //
  // `roles` decides everything. `state.connections`, `defaultConnectionId`,
  // `defaultByCapability` and each row's `isDefault` are projections rebuilt
  // by `_reproject()`. Nothing else may write them.

  /** Capability of a connection, defaulting to 'text' for pre-C-230 rows. */
  private _capabilityOf(connection: { capability?: string }): ConnectionCapability {
    return (connection.capability ?? 'text') as ConnectionCapability; // guard-ignore lint/type-safety/casting: capability is a closed union persisted as string
  }

  /**
   * Finds a provider matching the account triple, or creates one. This is
   * what makes "same key, many models" a single credential: two connections
   * with the same registry id, URL and key resolve to one provider.
   */
  private _resolveOrCreateProvider(options: {
    registryId: string;
    baseUrl: string;
    credential: string;
    source: AiProvider['source'];
    label: string;
  }): ProviderId {
    const existing = this.state.providers.find(
      (p) =>
        p.registryId === options.registryId &&
        (p.baseUrl ?? '') === options.baseUrl &&
        (p.credential ?? '') === options.credential,
    );
    if (existing) {
      return existing.id;
    }
    return this.addProvider({
      registryId: options.registryId,
      label: options.label || options.registryId,
      credential: options.credential || undefined,
      baseUrl: options.baseUrl || undefined,
      source: options.source,
    });
  }

  /**
   * Pulls rows out of a v2 vault's `legacy` payload into the real model.
   *
   * The first C-463 build wrote through only on migration: connections
   * created afterwards through the UI landed in `legacy.connections` alone,
   * which made a rollback-only key load-bearing. This absorbs them once, and
   * is a no-op on vaults that never had the problem.
   */
  private _absorbLegacyPayload(legacy: unknown): void {
    if (!legacy || typeof legacy !== 'object') {
      return;
    }
    const payload = legacy as Record<string, unknown>;
    const rows = Array.isArray(payload.connections) ? (payload.connections as Connection[]) : [];
    const known = new Set(this.state.aiConnections.map((c) => c.id));
    const orphans = rows.filter((row) => !known.has(row.id));

    for (const row of orphans) {
      const capability = this._capabilityOf(row);
      const providerId = this._resolveOrCreateProvider({
        registryId: row.provider,
        baseUrl: row.baseUrl ?? '',
        credential: row.apiKey ?? '',
        source: (row.source ?? 'stored') as AiProvider['source'],
        label: row.name,
      });
      // Keep the original id so role assignments and per-agent overrides
      // pointing at it keep resolving.
      this.state.aiConnections = [
        ...this.state.aiConnections,
        {
          id: row.id,
          providerId,
          capability,
          label: row.name,
          model: row.model,
          params: this._paramsFromLegacy(row, capability),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      ];
    }

    // Seed roles from the legacy defaults for anything still unassigned.
    const byCapability = (payload.defaultByCapability ?? {}) as Record<string, string | null>;
    for (const capability of CAPABILITIES) {
      const id = byCapability[capability];
      if (id && this.state.aiConnections.some((c) => c.id === id)) {
        this._assignCapabilityRoles({ id, capability, onlyUnassigned: true });
      }
    }
    for (const capability of CAPABILITIES) {
      if (this.state.roles[PRIMARY_ROLE[capability]]) {
        continue;
      }
      const first = this.state.aiConnections.find((c) => c.capability === capability);
      if (first) {
        this._assignCapabilityRoles({ id: first.id, capability, onlyUnassigned: true });
      }
    }

    if (orphans.length > 0) {
      this.info('load:absorbed-legacy-connections', { count: orphans.length });
    }
  }

  /** Drops providers no connection references any more. */
  private _pruneOrphanProviders(): void {
    const referenced = new Set(this.state.aiConnections.map((c) => c.providerId));
    this.state.providers = this.state.providers.filter((p) => referenced.has(p.id));
  }

  /** Builds capability-shaped params from the legacy Connection fields. */
  private _paramsFromLegacy(
    connection: Partial<Connection>,
    capability: ConnectionCapability,
  ): AiConnection['params'] {
    if (capability === 'image') {
      const o = connection.imageOptions;
      return {
        checkpoint: o?.checkpoint ?? '',
        width: o?.width ?? 1024,
        height: o?.height ?? 1024,
        steps: o?.steps ?? 20,
        cfg: o?.cfg ?? 7,
      };
    }
    if (capability === 'voice') {
      const o = connection.voiceOptions;
      return { voiceId: o?.voiceId ?? '', speed: o?.speed ?? 1, pitch: o?.pitch ?? 0 };
    }
    const g = connection.generationParams ?? this.state.generationParams;
    return {
      temperature: g.temperature,
      topP: g.topP,
      topK: g.topK,
      repetitionPenalty: g.repetitionPenalty,
      presencePenalty: g.presencePenalty,
      maxTokens: g.maxTokens,
      contextSize: g.contextSize,
    };
  }

  /**
   * Points a capability's roles at a connection. The primary role always
   * moves; the secondary roles only fill when unassigned, so a deliberate
   * fine-grained choice (Haiku for summarization) survives someone starring
   * a different connection.
   */
  private _assignCapabilityRoles(options: {
    id: ConnectionId;
    capability: ConnectionCapability;
    onlyUnassigned?: boolean;
  }): void {
    const next = { ...this.state.roles };
    const valid = new Set(this.state.aiConnections.map((c) => c.id));
    for (const role of ROLES_BY_CAPABILITY[options.capability]) {
      const isPrimary = role === PRIMARY_ROLE[options.capability];
      const current = next[role];
      const currentIsStale = current !== undefined && !valid.has(current);
      if ((isPrimary && !options.onlyUnassigned) || current === undefined || currentIsStale) {
        next[role] = options.id;
      }
    }
    this.state.roles = next;
  }

  /**
   * Rebuilds every legacy projection from providers/aiConnections/roles.
   * Skips the `connections` write when the projection is unchanged —
   * capability_view_model runs an $effect over it and an unconditional new
   * array would wake it on every no-op.
   */
  private _reproject(): void {
    // Drop role assignments whose connection is gone.
    const valid = new Set(this.state.aiConnections.map((c) => c.id));
    const prunedRoles = Object.fromEntries(
      Object.entries(this.state.roles).filter(([, id]) => id !== undefined && valid.has(id)),
    );
    if (Object.keys(prunedRoles).length !== Object.keys(this.state.roles).length) {
      this.state.roles = prunedRoles;
    }

    const next = this.state.aiConnections.map((aiConn) => {
      const provider = this.state.providers.find((p) => p.id === aiConn.providerId);
      const isDefault = this.state.roles[PRIMARY_ROLE[aiConn.capability]] === aiConn.id;
      return this._projectConnection({ aiConn, provider, isDefault });
    });

    const unchanged =
      next.length === this.state.connections.length &&
      next.every((c, i) => {
        const prev = this.state.connections[i];
        return (
          prev !== undefined &&
          prev.id === c.id &&
          prev.isDefault === c.isDefault &&
          prev.model === c.model &&
          prev.apiKey === c.apiKey &&
          prev.baseUrl === c.baseUrl &&
          prev.provider === c.provider &&
          prev.name === c.name &&
          prev.capability === c.capability &&
          prev.source === c.source &&
          JSON.stringify(prev.generationParams) === JSON.stringify(c.generationParams) &&
          JSON.stringify(prev.imageOptions) === JSON.stringify(c.imageOptions) &&
          JSON.stringify(prev.voiceOptions) === JSON.stringify(c.voiceOptions)
        );
      });
    if (!unchanged) {
      this.state.connections = next as unknown as import('@aikami/types').ConnectionEntry[]; // guard-ignore lint/type-safety/casting: projection of the C-463 model into the legacy persisted shape
    }

    const defaults: Record<string, string | null> = {};
    for (const capability of CAPABILITIES) {
      const id = this.state.roles[PRIMARY_ROLE[capability]];
      if (id) {
        defaults[capability] = id;
      }
    }
    this.state.defaultByCapability = defaults;
    this.state.defaultConnectionId = this.state.roles.narration ?? null;
  }

  getConnection(id: ConnectionId): Connection | undefined {
    return this.state.connections.find((c) => c.id === id) as Connection | undefined;
  }

  getApiKey(provider: string, capability: ConnectionCapability = 'text'): string | undefined {
    // Resolved through the provider, which is where the credential lives.
    // Prefer the capability's primary-role connection when it is on this
    // provider, so a user with two accounts gets the one they chose.
    const onProvider = (connection: AiConnection): boolean =>
      connection.capability === capability &&
      this.state.providers.find((p) => p.id === connection.providerId)?.registryId === provider;

    const primaryId = this.state.roles[PRIMARY_ROLE[capability]];
    const preferred = primaryId
      ? this.state.aiConnections.find((c) => c.id === primaryId && onProvider(c))
      : undefined;
    const connection = preferred ?? this.state.aiConnections.find(onProvider);
    if (!connection) {
      return undefined;
    }
    return (
      this.state.providers.find((p) => p.id === connection.providerId)?.credential || undefined
    );
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
