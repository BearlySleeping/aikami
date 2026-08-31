// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
//
// Singleton service that manages the central configuration state for the
// dev/config dashboard. API keys are encrypted at rest via crypto_vault;
// non-sensitive settings are stored as plain JSON in localStorage.
// Firestore sync is optional — works entirely offline for Tauri / local use.

import { BUILT_IN_PRESETS, DEFAULT_VOICE_ARCHETYPES, type GenParamPreset } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AdvancedOverrides,
  ConfigState,
  EmotionConfig,
  ImageConfig,
  MemoryConfig,
  ModelConfigEntry,
  TextConfig,
  VoiceConfig,
} from '@aikami/types';
import { clearVault, decrypt, encrypt } from '$lib/views/utils/crypto_vault';
import type { ConnectionCapability, Lorebook, LorebookEntry } from '$types';
import {
  type AuxiliaryModels,
  type GenerationParams,
  INSTRUCT_TEMPLATES,
  type InstructTemplate,
} from '$types';

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

import type { Connection, ConnectionId } from '$types';

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
  setTextProvider(provider: string): void;
  /** Sets the preferred model identifier. */
  setPreferredModel(model: string): void;
  /** Replaces the full models array. */
  setModels(models: ModelConfigEntry[]): void;
  /** Updates a single model config by index. */
  updateModel(index: number, config: Partial<ModelConfigEntry>): void;
  /** Updates memory config (partial merge). */
  setMemoryConfig(config: Partial<MemoryConfig>): void;
  /** Updates voice config (partial merge). */
  setVoiceConfig(config: Partial<VoiceConfig>): void;
  /** Updates image config (partial merge). */
  setImageConfig(config: Partial<ImageConfig>): void;
  /** Updates emotion config (partial merge). */
  setEmotionConfig(config: Partial<EmotionConfig>): void;
  /** Updates generation parameters (partial merge). */
  setGenerationParams(params: Partial<GenerationParams>): void;
  /** Sets the instruct template. */
  setInstructTemplate(template: InstructTemplate): void;
  /** Updates advanced overrides (partial merge). */
  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void;
  /** Updates auxiliary model assignments (partial merge). */
  setAuxiliaryModels(models: Partial<AuxiliaryModels>): void;

  /**
   * Resolves the active text generation provider from the current
   * configuration state.
   *
   * Throws if no model is configured (neither preferredModel nor models
   * array has an entry).
   */
  getActiveTextProvider(): ResolvedTextProvider;

  // ── Connection management (C-230) ──────────────────────────────────

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

const DEFAULT_TEXT_CONFIG: TextConfig = {
  provider: 'openrouter',
};

const DEFAULT_MODEL_CONFIGS: ModelConfigEntry[] = [];

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  chunkSize: 512,
  contextWindow: 8192,
  embeddingModel: 'minilm',
  longTermMemory: false,
  maxTurns: 50,
  summarizationThreshold: 20,
  type: 'basic',
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

const DEFAULT_ADVANCED_OVERRIDES: AdvancedOverrides = {
  thinkingLevel: 0,
};

const DEFAULT_AUXILIARY_MODELS: AuxiliaryModels = {
  embedding: undefined,
  summarization: undefined,
  vision: undefined,
};

const DEFAULT_EMOTION_CONFIG: EmotionConfig = {
  method: 'submodel',
};

const DEFAULT_TEMPLATE: InstructTemplate = 'chatml';

const DEFAULT_STATE: ConfigState = {
  activeLorebookIds: [],
  advancedOverrides: { ...DEFAULT_ADVANCED_OVERRIDES },
  auxiliaryModels: { ...DEFAULT_AUXILIARY_MODELS },
  connections: [],
  defaultConnectionId: null,
  defaultByCapability: {},
  emotion: { ...DEFAULT_EMOTION_CONFIG },
  generationParams: { ...DEFAULT_GENERATION_PARAMS },
  image: { ...DEFAULT_IMAGE_CONFIG },
  instructTemplate: DEFAULT_TEMPLATE,
  lorebooks: [],
  memory: { ...DEFAULT_MEMORY_CONFIG },
  models: [...DEFAULT_MODEL_CONFIGS],
  preferredModel: '',
  presets: [...BUILT_IN_PRESETS],
  text: { ...DEFAULT_TEXT_CONFIG },
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

    // 1. Load connections from encrypted vault
    const raw = await decrypt({ pin });
    if (raw) {
      try {
        const vault = JSON.parse(raw) as Record<string, unknown>;

        // Load connections from vault (C-230)
        if (Array.isArray(vault.connections)) {
          // Prune stale auto-seeded connections:
          // - env-seeded with no API key (phantom from old _seedConnectionsFromEnv bug)
          // - detected connections from previous sessions (re-detected on every capability scan)
          const cleaned = (vault.connections as Connection[]).filter(
            (c) =>
              // Keep manually created/stored connections
              c.source === 'stored' ||
              (c.source === 'env' &&
                // Keep env connections that have a real API key
                ((c.apiKey && c.apiKey.length > 0) ||
                  // Or local providers (Ollama, llama.cpp, etc.) which don't need API keys
                  c.provider === 'ollama' ||
                  c.provider === 'llamacpp' ||
                  c.provider === 'ooba')) ||
              // Keep detected connections ONLY if they're local providers
              (c.source === 'detected' &&
                (c.provider === 'ollama' ||
                  c.provider === 'llamacpp' ||
                  c.provider === 'ooba' ||
                  c.provider === 'comfyui' ||
                  c.provider === 'kokoro')),
          );
          this.state.connections = cleaned;
        }
        if (typeof vault.defaultConnectionId === 'string' || vault.defaultConnectionId === null) {
          this.state.defaultConnectionId = vault.defaultConnectionId as ConnectionId | null;
        }
        // Load user presets from vault (built-in presets are merged on load)
        if (Array.isArray(vault.userPresets)) {
          const userPresets = vault.userPresets as GenParamPreset[];
          // Merge user presets on top of built-in presets (user wins on duplicate IDs)
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
        if (parsed.preferredModel !== undefined) {
          this.state.preferredModel = parsed.preferredModel;
        }
        if (parsed.models) {
          this.state.models = parsed.models;
        }
        if (parsed.memory) {
          this.state.memory = { ...DEFAULT_MEMORY_CONFIG, ...parsed.memory };
        }
        if (parsed.voice) {
          this.state.voice = { ...DEFAULT_VOICE_CONFIG, ...parsed.voice };
        }
        if (parsed.image) {
          this.state.image = { ...DEFAULT_IMAGE_CONFIG, ...parsed.image };
        }
        if (parsed.emotion) {
          this.state.emotion = { ...DEFAULT_EMOTION_CONFIG, ...parsed.emotion };
        }
        if (parsed.generationParams) {
          this.state.generationParams = {
            ...DEFAULT_GENERATION_PARAMS,
            ...(parsed.generationParams as Partial<GenerationParams>),
          };
        }
        if (
          typeof parsed.instructTemplate === 'string' &&
          INSTRUCT_TEMPLATES.includes(parsed.instructTemplate as InstructTemplate)
        ) {
          this.state.instructTemplate = parsed.instructTemplate as InstructTemplate;
        }
        if (parsed.advancedOverrides) {
          this.state.advancedOverrides = {
            ...DEFAULT_ADVANCED_OVERRIDES,
            ...(parsed.advancedOverrides as Partial<AdvancedOverrides>),
          };
        }
        if (parsed.auxiliaryModels) {
          this.state.auxiliaryModels = {
            ...DEFAULT_AUXILIARY_MODELS,
            ...(parsed.auxiliaryModels as Partial<AuxiliaryModels>),
          };
        }
        if (Array.isArray(parsed.lorebooks)) {
          this.state.lorebooks = parsed.lorebooks as Lorebook[];
        }
        if (Array.isArray(parsed.activeLorebookIds)) {
          this.state.activeLorebookIds = parsed.activeLorebookIds as string[];
        }
      } catch {
        this.warn('load: failed to parse plain config');
      }
    }

    this.isLoaded = true;
  }

  async save(): Promise<void> {
    this.debug('ConfigService.save');

    // Encrypt sensitive data: connections (API keys)
    const userPresets = this.state.presets.filter((p) => !p.isBuiltIn);
    const vaultPayload = JSON.stringify({
      connections: this.state.connections,
      defaultConnectionId: this.state.defaultConnectionId,
      userPresets,
    });
    await encrypt({ text: vaultPayload });

    // Plain config (non-sensitive)
    const plain: Record<string, unknown> = {
      activeLorebookIds: this.state.activeLorebookIds,
      advancedOverrides: this.state.advancedOverrides,
      auxiliaryModels: this.state.auxiliaryModels,
      emotion: this.state.emotion,
      generationParams: this.state.generationParams,
      image: this.state.image,
      instructTemplate: this.state.instructTemplate,
      lorebooks: this.state.lorebooks,
      memory: this.state.memory,
      models: this.state.models,
      preferredModel: this.state.preferredModel,
      voice: this.state.voice,
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
      advancedOverrides: { ...DEFAULT_ADVANCED_OVERRIDES },
      auxiliaryModels: { ...DEFAULT_AUXILIARY_MODELS },
      connections: [],
      defaultConnectionId: null,
      defaultByCapability: {},
      emotion: { ...DEFAULT_EMOTION_CONFIG },
      generationParams: { ...DEFAULT_GENERATION_PARAMS },
      image: { ...DEFAULT_IMAGE_CONFIG },
      instructTemplate: DEFAULT_TEMPLATE,
      lorebooks: [],
      memory: { ...DEFAULT_MEMORY_CONFIG },
      models: [],
      preferredModel: '',
      presets: [...BUILT_IN_PRESETS],
      text: { provider: 'openrouter' },
      voice: { ...DEFAULT_VOICE_CONFIG },
    };
  }

  // ── Mutators ──────────────────────────────────────────────────────────

  setTextProvider(provider: string): void {
    this.state.text.provider = provider;
  }

  setPreferredModel(model: string): void {
    this.state.preferredModel = model;
  }

  setModels(models: ModelConfigEntry[]): void {
    this.state.models = models;
  }

  updateModel(index: number, config: Partial<ModelConfigEntry>): void {
    if (index < 0 || index >= this.state.models.length) {
      return;
    }
    this.state.models = this.state.models.map((m, i) => (i === index ? { ...m, ...config } : m));
  }

  setMemoryConfig(config: Partial<MemoryConfig>): void {
    this.state.memory = { ...this.state.memory, ...config };
  }

  setVoiceConfig(config: Partial<VoiceConfig>): void {
    this.state.voice = { ...this.state.voice, ...config };
  }

  setImageConfig(config: Partial<ImageConfig>): void {
    this.state.image = { ...this.state.image, ...config };
  }

  setEmotionConfig(config: Partial<EmotionConfig>): void {
    this.state.emotion = { ...this.state.emotion, ...config };
  }

  setGenerationParams(params: Partial<GenerationParams>): void {
    this.state.generationParams = { ...this.state.generationParams, ...params };
  }

  setInstructTemplate(template: InstructTemplate): void {
    this.state.instructTemplate = template;
  }

  setAdvancedOverrides(overrides: Partial<AdvancedOverrides>): void {
    this.state.advancedOverrides = { ...this.state.advancedOverrides, ...overrides };
  }

  setAuxiliaryModels(models: Partial<AuxiliaryModels>): void {
    this.state.auxiliaryModels = { ...this.state.auxiliaryModels, ...models };
  }

  // ── Text provider resolution ─────────────────────────────────────────

  getActiveTextProvider(): ResolvedTextProvider {
    const { connections: allConnections = [], defaultConnectionId } = this.state;

    // Only consider text connections — voice/image connections are irrelevant
    // for text provider resolution and can cause the wrong provider (e.g.,
    // 'kokoro') to be returned for text requests.
    const connections = allConnections.filter((c) => (c.capability ?? 'text') === 'text');

    // ── Priority 1: Default connection (C-230) ──────────────────────
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

    // ── Priority 2: First available connection ──────────────────────
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

  // ── Connection management (C-230) ──────────────────────────────────

  addConnection(connection: Omit<Connection, 'id' | 'createdAt' | 'updatedAt'>): ConnectionId {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newConnection: Connection = {
      ...connection,
      createdAt: now,
      id,
      updatedAt: now,
    };

    // If this is marked as default, clear previous default
    if (newConnection.isDefault) {
      this.state.connections = this.state.connections.map((c) =>
        c.isDefault ? { ...c, isDefault: false } : c,
      );
      this.state.defaultConnectionId = id;
    }

    // If this is the first connection, make it default automatically
    if (
      this.state.connections.length === 0 &&
      !newConnection.isDefault &&
      this.state.defaultConnectionId === null
    ) {
      newConnection.isDefault = true;
      this.state.defaultConnectionId = id;
    }

    this.state.connections = [...this.state.connections, newConnection];
    return id;
  }

  updateConnection(id: ConnectionId, patch: Partial<Omit<Connection, 'id' | 'createdAt'>>): void {
    this.state.connections = this.state.connections.map((c) => {
      if (c.id !== id) {
        return c;
      }
      const updated = { ...c, ...patch, id: c.id, updatedAt: new Date().toISOString() };

      // Handle default switching
      if (patch.isDefault && c.isDefault === false) {
        // Clear previous default on other connections
        this.state.connections = this.state.connections.map((oc) =>
          oc.id !== id && oc.isDefault ? { ...oc, isDefault: false } : oc,
        );
        this.state.defaultConnectionId = id;
      }

      return updated;
    });
  }

  deleteConnection(id: ConnectionId): void {
    const filtered = this.state.connections.filter((c) => c.id !== id);
    this.state.connections = filtered;

    // If the deleted connection was the default, pick the first remaining
    if (this.state.defaultConnectionId === id) {
      if (filtered.length > 0) {
        const newDefault = { ...filtered[0], isDefault: true };
        this.state.connections = [newDefault, ...filtered.slice(1)];
        this.state.defaultConnectionId = newDefault.id;
      } else {
        this.state.defaultConnectionId = null;
      }
    }
  }

  duplicateConnection(id: ConnectionId): ConnectionId | undefined {
    const original = this.state.connections.find((c) => c.id === id);
    if (!original) {
      return undefined;
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const copy: Connection = {
      ...original,
      createdAt: now,
      id: newId,
      isDefault: false,
      name: `${original.name} (copy)`,
      updatedAt: now,
    };

    this.state.connections = [...this.state.connections, copy];
    return newId;
  }

  setDefaultConnection(id: ConnectionId): void {
    this.state.connections = this.state.connections.map((c) => ({
      ...c,
      isDefault: c.id === id,
    }));
    this.state.defaultConnectionId = id;

    // Track per-capability default
    const connection = this.state.connections.find((c) => c.id === id);
    if (connection) {
      const capability = connection.capability ?? 'text';
      this.state.defaultByCapability = {
        ...this.state.defaultByCapability,
        [capability]: id,
      };
    }
  }

  getConnection(id: ConnectionId): Connection | undefined {
    return this.state.connections.find((c) => c.id === id);
  }

  getApiKey(provider: string, capability: ConnectionCapability = 'text'): string | undefined {
    const matches = (c: Connection): boolean =>
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
    this.state.lorebooks = [...this.state.lorebooks, lorebook];
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
    return this.state.lorebooks;
  }

  getLorebook(options: { id: string }): Lorebook | undefined {
    const { id } = options;
    return this.state.lorebooks.find((lb) => lb.id === id);
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
    });
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
    });
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
    });
  }

  reorderEntries(options: { lorebookId: string; entryIds: string[] }): void {
    const { lorebookId, entryIds } = options;
    const now = new Date().toISOString();

    this.state.lorebooks = this.state.lorebooks.map((lb) => {
      if (lb.id !== lorebookId) {
        return lb;
      }
      const entryMap = new Map(lb.entries.map((e) => [e.id, e]));
      const reordered = entryIds
        .map((id) => entryMap.get(id))
        .filter((e): e is LorebookEntry => e !== undefined);
      return { ...lb, entries: reordered, updatedAt: now };
    });
  }

  setActiveLorebookIds(options: { ids: string[] }): void {
    this.state.activeLorebookIds = options.ids;
  }
}

export { ConfigService };

export const configService: ConfigServiceInterface = ConfigService.create({
  className: 'ConfigService',
});
