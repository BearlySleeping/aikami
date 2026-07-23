// apps/frontend/client/src/lib/services/config/config_service.svelte.ts
//
// Singleton service that manages the central configuration state for the
// dev/config dashboard. API keys are encrypted at rest via crypto_vault;
// non-sensitive settings are stored as plain JSON in localStorage.
// Firestore sync is optional — works entirely offline for Tauri / local use.

import {
  BUILT_IN_PRESETS,
  type GenParamPreset,
  TEXT_PROVIDERS,
  type TextProvider,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { clearVault, decrypt, encrypt } from '$lib/utils/crypto_vault';
import { logger } from '$logger';
import type { Connection, ConnectionId, Lorebook, LorebookEntry } from '$types';
import {
  type AuxiliaryModels,
  type GenerationParams,
  INSTRUCT_TEMPLATES,
  type InstructTemplate,
} from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Re-exports from @aikami/constants for backward compatibility
// ---------------------------------------------------------------------------

export { TEXT_PROVIDERS, type TextProvider } from '@aikami/constants';

// ---------------------------------------------------------------------------
// Text AI providers (re-exported from @aikami/constants)
// ---------------------------------------------------------------------------

/** Map of provider → API key string. */
export type ApiKeys = Record<string, string>;

/** Text generation subsystem configuration. */
export type TextConfig = {
  /** Selected text generation provider. */
  provider: TextProvider;
  /** API keys per provider (encrypted at rest). */
  apiKeys: ApiKeys;
  /** Custom endpoint URL (for ollama, ooba, custom). */
  url?: string;
};

/** Memory subsystem configuration. */
export type MemoryConfig = {
  /** Memory type (algorithm). */
  type: MemoryType;
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum number of conversation turns to retain. */
  maxTurns: number;
  /** Summarization threshold (turns before summarisation kicks in). */
  summarizationThreshold: number;
  /** Whether long-term memory (vector store) is enabled. */
  longTermMemory: boolean;
  /** Embedding model provider for vector search. */
  embeddingModel: EmbeddingModel;
  /** Custom embedding API endpoint (when embeddingModel is 'custom'). */
  embeddingUrl?: string;
  /** API key for custom embedding provider. */
  embeddingKey?: string;
  /** Text chunk size for embedding ingestion. */
  chunkSize: number;
};

// ---------------------------------------------------------------------------
// Memory subsystem (C-204: expanded with embedding provider selection)
// ---------------------------------------------------------------------------

/** Memory subsystem type. */
export const MEMORY_TYPES = ['none', 'basic', 'hypa-style', 'hanurai'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Embedding model providers. */
export const EMBEDDING_MODELS = [
  { id: 'minilm', label: 'MiniLM (local)' },
  { id: 'nomic', label: 'Nomic Embed' },
  { id: 'bge', label: 'BGE (BAAI)' },
  { id: 'openai', label: 'OpenAI Embeddings' },
  { id: 'voyage', label: 'Voyage AI' },
  { id: 'custom', label: 'Custom API' },
] as const;

export type EmbeddingModel = (typeof EMBEDDING_MODELS)[number]['id'];

// ---------------------------------------------------------------------------
// Voice engine selection
// ---------------------------------------------------------------------------

/** Available TTS engines. */
export const VOICE_ENGINES = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
] as const;

/** TTS engine identifier. */
export type VoiceEngine = (typeof VOICE_ENGINES)[number]['id'];

/** A voice option displayed in the dropdown. */
export type VoiceOption = {
  /** Voice identifier (e.g. 'af_heart'). */
  id: string;
  /** Human-readable label. */
  label: string;
};

/** All known Kokoro voices (mirrors the /v1/voices endpoint). */
export const KOKORO_VOICES: readonly VoiceOption[] = [
  // American English — Female
  { id: 'af_heart', label: 'af_heart — Warm, natural (default)' },
  { id: 'af_bella', label: 'af_bella — Expressive' },
  { id: 'af_nova', label: 'af_nova — Clear' },
  { id: 'af_sky', label: 'af_sky — Neutral, versatile' },
  { id: 'af_sarah', label: 'af_sarah — Conversational' },
  { id: 'af_nicole', label: 'af_nicole — Friendly' },
  { id: 'af_alloy', label: 'af_alloy — Balanced' },
  { id: 'af_jessica', label: 'af_jessica — Energetic' },
  { id: 'af_river', label: 'af_river — Calm' },
  // American English — Male
  { id: 'am_adam', label: 'am_adam — Deep' },
  { id: 'am_michael', label: 'am_michael — Clear' },
  { id: 'am_echo', label: 'am_echo — Neutral' },
  { id: 'am_eric', label: 'am_eric — Authoritative' },
  { id: 'am_fenrir', label: 'am_fenrir — Distinctive' },
  { id: 'am_liam', label: 'am_liam — Conversational' },
  { id: 'am_onyx', label: 'am_onyx — Rich' },
  { id: 'am_puck', label: 'am_puck — Expressive' },
  { id: 'am_santa', label: 'am_santa — Warm' },
  // British English — Female
  { id: 'bf_emma', label: 'bf_emma — Clear, professional' },
  { id: 'bf_isabella', label: 'bf_isabella — Warm' },
  { id: 'bf_alice', label: 'bf_alice — Crisp' },
  { id: 'bf_lily', label: 'bf_lily — Soft' },
  // British English — Male
  { id: 'bm_george', label: 'bm_george — Authoritative' },
  { id: 'bm_lewis', label: 'bm_lewis — Smooth' },
  { id: 'bm_daniel', label: 'bm_daniel — Calm' },
  { id: 'bm_fable', label: 'bm_fable — Expressive' },
] as const;

// ---------------------------------------------------------------------------
// Voice TTS providers (C-204: expanded provider selection)
// ---------------------------------------------------------------------------

/** Available TTS provider identifiers. */
export const VOICE_PROVIDERS = [
  { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
  { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
  { id: 'voicevox', label: 'VOICEVOX', description: 'Local Japanese TTS engine' },
  { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
  { id: 'fish-speech', label: 'Fish Speech', description: 'Open-source TTS' },
] as const;

export type VoiceProvider = (typeof VOICE_PROVIDERS)[number]['id'];

/** Voice / TTS subsystem configuration. */
export type VoiceConfig = {
  /** Selected TTS provider (e.g. 'kokoro', 'elevenlabs'). */
  provider: VoiceProvider;
  /** Selected TTS engine (legacy — kept for migration, mirrors provider). */
  engine: string;
  /** Custom server URL for local providers (voicevox, etc.). */
  url?: string;
  /** API key for cloud providers. */
  apiKey?: string;
  /** Voice style or speaker ID. */
  voiceId: string;
  /** Speech rate multiplier (0.5–2.0). */
  speed: number;
  /** Pitch adjustment (-20–20). */
  pitch: number;
  /** Auto-speech: automatically generate TTS for NPC dialogue. */
  autoSpeech: boolean;
  /** User-editable voice archetype → voice ID mappings. */
  voiceArchetypes: VoiceArchetype[];
};

// ---------------------------------------------------------------------------
// Voice archetypes — human-friendly labels mapped to engine voice IDs
// ---------------------------------------------------------------------------

/** A named voice archetype mapped to a provider-specific voice ID. */
export type VoiceArchetype = {
  /** Unique archetype key (e.g. 'female-warm', 'male-deep'). */
  id: string;
  /** Human-readable label (e.g. 'Female — Warm'). */
  label: string;
  /** Provider-specific voice ID (e.g. 'af_heart' for Kokoro). */
  voiceId: string;
};

/** Curated default voice archetypes mapped to Kokoro IDs. */
export const DEFAULT_VOICE_ARCHETYPES: readonly VoiceArchetype[] = [
  // ── Female ─────────────────────────────────────────────────────────
  { id: 'female-warm', label: 'Female — Warm', voiceId: 'af_heart' },
  { id: 'female-clear', label: 'Female — Clear', voiceId: 'af_nova' },
  { id: 'female-expressive', label: 'Female — Expressive', voiceId: 'af_bella' },
  { id: 'female-calm', label: 'Female — Calm', voiceId: 'af_river' },
  { id: 'female-friendly', label: 'Female — Friendly', voiceId: 'af_nicole' },
  { id: 'female-professional', label: 'Female — Professional (UK)', voiceId: 'bf_emma' },
  // ── Male ───────────────────────────────────────────────────────────
  { id: 'male-warm', label: 'Male — Warm', voiceId: 'am_santa' },
  { id: 'male-clear', label: 'Male — Clear', voiceId: 'am_michael' },
  { id: 'male-authoritative', label: 'Male — Authoritative', voiceId: 'bm_george' },
  { id: 'male-deep', label: 'Male — Deep', voiceId: 'am_adam' },
  { id: 'male-expressive', label: 'Male — Expressive', voiceId: 'am_puck' },
  { id: 'male-conversational', label: 'Male — Conversational', voiceId: 'am_liam' },
  { id: 'male-calm', label: 'Male — Calm (UK)', voiceId: 'bm_daniel' },
] as const;

// ---------------------------------------------------------------------------
// Image generation providers (C-204: expanded provider selection)
// ---------------------------------------------------------------------------

/** Available image generation provider identifiers. */
export const IMAGE_PROVIDERS = [
  { id: 'comfyui', label: 'ComfyUI (local)', description: 'Local ComfyUI via Docker' },
  { id: 'webui', label: 'AUTOMATIC1111 WebUI', description: 'Local Stable Diffusion WebUI' },
  { id: 'novelai', label: 'NovelAI', description: 'Cloud-based anime/SD' },
  { id: 'dalle', label: 'DALL·E', description: 'OpenAI DALL·E' },
  { id: 'stability', label: 'Stability AI', description: 'Stability API' },
  { id: 'fal', label: 'fal.ai', description: 'Serverless generative media' },
  { id: 'openai-compat', label: 'OpenAI Compatible', description: 'OpenAI-compatible image API' },
] as const;

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]['id'];

/** Image generation subsystem configuration. */
export type ImageConfig = {
  /** Selected image generation provider. */
  provider: ImageProvider;
  /** Selected image generation backend (legacy — kept for migration, mirrors provider). */
  backend: string;
  /** Custom server URL for local providers. */
  url?: string;
  /** API key for cloud providers. */
  apiKey?: string;
  /** Default checkpoint / model ID. */
  checkpoint: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Generation steps. */
  steps: number;
  /** CFG guidance scale. */
  cfgScale: number;
  /** Sampler name (e.g. 'euler_a', 'dpmpp_2m'). */
  sampler?: string;
  /** Whether img2img mode is enabled by default. */
  enableI2I?: boolean;
  /** ComfyUI workflow JSON string (provider-specific). */
  comfyWorkflow?: string;
  /** NovelAI noise schedule override (provider-specific). */
  novelAiNoiseSchedule?: string;
  /** Active style profile ID for the image generation pipeline (C-242). */
  styleProfileId: string;
  /** Whether to show a review/edit modal before each image generation (C-242). */
  reviewBeforeGenerate: boolean;
};

/** Generic model configuration for a single provider. */
export type ModelConfig = {
  /** Model identifier (e.g. 'claude-3-opus-20240229'). */
  model: string;
  /** Provider this model belongs to. */
  provider: string;
  /** Base URL for the API endpoint. */
  endpoint: string;
};

// ── Emotion config (C-204) ───────────────────────────────────

/** Emotion resolution methods. */
export const EMOTION_METHODS = ['submodel', 'embedding'] as const;
export type EmotionMethod = (typeof EMOTION_METHODS)[number];

/** Emotion resolution configuration. */
export type EmotionConfig = {
  /** How character emotions are resolved. */
  method: EmotionMethod;
  /** Target model for emotion extraction (when method is 'submodel'). */
  targetModel?: string;
};

// ── AI Generation Settings (absorbed from ai_settings.svelte.ts) ────────

/** Advanced overrides for specific providers. */
export type AdvancedOverrides = {
  /** Thinking/reasoning level for DeepSeek/Claude models. */
  thinkingLevel: number;
};

/** Resolved text generation provider ready for API calls. */
export type ResolvedTextProvider = {
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
// Re-exports for backward compatibility
export { BUILT_IN_PRESETS, type GenParamPreset } from '@aikami/constants';
export type { Connection, ConnectionId, ConnectionTestResult } from '$types';

/** Top-level configuration state. */
export type ConfigState = {
  /** Text generation settings (provider, API keys, URL). */
  text: TextConfig;
  /** Preferred text generation model. */
  preferredModel: string;
  /** Model configurations (provider-agnostic). */
  models: ModelConfig[];
  /** Memory subsystem settings. */
  memory: MemoryConfig;
  /** Voice / TTS settings. */
  voice: VoiceConfig;
  /** Image generation settings. */
  image: ImageConfig;
  /** Emotion resolution settings. */
  emotion: EmotionConfig;
  /** AI generation parameter overrides. */
  generationParams: GenerationParams;
  /** Selected instruct template format. */
  instructTemplate: InstructTemplate;
  /** Advanced provider-specific overrides. */
  advancedOverrides: AdvancedOverrides;
  /** Auxiliary model assignments for specialised tasks. */
  auxiliaryModels: AuxiliaryModels;
  /** Saved provider connections (C-230). */
  connections: Connection[];
  /** ID of the default connection, or null if none set. */
  defaultConnectionId: ConnectionId | null;
  /** Per-capability default connection IDs (text, image, voice). */
  defaultByCapability: Partial<Record<string, ConnectionId | null>>;
  /** Generation parameter presets (built-in + user-defined). */
  presets: GenParamPreset[];
  /** Lorebooks (world info collections) persisted in localStorage. */
  lorebooks: Lorebook[];
  /** IDs of lorebooks assigned to the active chat session. */
  activeLorebookIds: string[];
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

  /** Updates the text provider selection. */
  setTextProvider(provider: TextProvider): void;
  /** Updates the API key for the given text provider. */
  setTextApiKey(provider: string, key: string): void;
  /** Updates the custom URL for the text provider. */
  setTextUrl(url: string): void;
  /** Sets the preferred model identifier. */
  setPreferredModel(model: string): void;
  /** Replaces the full models array. */
  setModels(models: ModelConfig[]): void;
  /** Updates a single model config by index. */
  updateModel(index: number, config: Partial<ModelConfig>): void;
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

const DEFAULT_API_KEYS: ApiKeys = {};

const DEFAULT_TEXT_CONFIG: TextConfig = {
  apiKeys: {},
  provider: 'openrouter',
};

const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [];

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

  private _envDefaultsInjected = false;

  // ── Persistence ───────────────────────────────────────────────────────

  async load(pin?: string): Promise<void> {
    logger.debug('ConfigService.load');

    // 1. Load API keys + text provider + connections from encrypted vault
    const raw = await decrypt({ pin });
    if (raw) {
      try {
        const vault = JSON.parse(raw) as Record<string, unknown>;
        const apiKeys: ApiKeys =
          vault.apiKeys && typeof vault.apiKeys === 'object'
            ? { ...DEFAULT_API_KEYS, ...(vault.apiKeys as ApiKeys) }
            : { ...DEFAULT_API_KEYS };
        const rawProvider = typeof vault.textProvider === 'string' ? vault.textProvider : '';
        const validIds: readonly string[] = TEXT_PROVIDERS.map((p) => p.id);
        const provider: TextProvider =
          rawProvider && validIds.includes(rawProvider)
            ? (rawProvider as TextProvider)
            : this.state.text.provider;
        const url: string | undefined =
          typeof vault.textUrl === 'string' ? vault.textUrl : this.state.text.url;
        this.state.text = {
          ...DEFAULT_TEXT_CONFIG,
          apiKeys,
          provider,
          url,
        };

        // Load connections from vault (C-230)
        if (Array.isArray(vault.connections)) {
          this.state.connections = vault.connections as Connection[];
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

    // 3. Inject env defaults when no user config is present
    this._injectEnvDefaults();

    this.isLoaded = true;
  }

  async save(): Promise<void> {
    logger.debug('ConfigService.save');

    // Encrypt sensitive data: text config + connections (API keys)
    const userPresets = this.state.presets.filter((p) => !p.isBuiltIn);
    const vaultPayload = JSON.stringify({
      apiKeys: this.state.text.apiKeys,
      textProvider: this.state.text.provider,
      textUrl: this.state.text.url,
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
    logger.debug('ConfigService.reset');
    this.state = this._makeDefaultState();
    await clearVault();
    localStorage.removeItem(PLAIN_CONFIG_KEY);
  }

  // ── Mutators ──────────────────────────────────────────────────────────

  setTextProvider(provider: TextProvider): void {
    this.state.text.provider = provider;
  }

  setTextApiKey(provider: string, key: string): void {
    this.state.text.apiKeys = { ...this.state.text.apiKeys, [provider]: key };
  }

  setTextUrl(url: string): void {
    this.state.text.url = url;
  }

  setPreferredModel(model: string): void {
    this.state.preferredModel = model;
  }

  setModels(models: ModelConfig[]): void {
    this.state.models = models;
  }

  updateModel(index: number, config: Partial<ModelConfig>): void {
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
    // Lazy env injection — ensures defaults are available even if load()
    // hasn't been called yet (e.g. first render before Config dashboard opens).
    if (!this._envDefaultsInjected) {
      this._envDefaultsInjected = true;
      this._injectEnvDefaults();
    }

    const { text, connections: allConnections = [], defaultConnectionId } = this.state;

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
          apiKey: conn.apiKey || text.apiKeys[conn.provider] || '',
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
        apiKey: conn.apiKey || text.apiKeys[conn.provider] || '',
      };
    }

    // ── Priority 3: Legacy provider config (no connections created) ──
    // Validate that the stored provider is actually a text provider.
    // Corrupt vaults may contain voice/image provider IDs (e.g., 'kokoro')
    // that were accidentally written to the text provider field.
    const validIds: readonly string[] = TEXT_PROVIDERS.map((p) => p.id);
    const provider = validIds.includes(text.provider as string)
      ? (text.provider as TextProvider)
      : 'openrouter';
    const { preferredModel, models } = this.state;

    let endpoint = text.url ?? '';
    let model = preferredModel;

    if (!model && models.length > 0) {
      const match = models.find((m) => m.provider === provider);
      if (match) {
        model = match.model;
        endpoint = endpoint || match.endpoint || '';
      } else {
        model = models[0].model;
        endpoint = endpoint || models[0].endpoint || '';
      }
    }

    if (model && !endpoint && models.length > 0) {
      const match = models.find((m) => m.model === model);
      if (match) {
        endpoint = match.endpoint || '';
      }
    }

    if (!endpoint) {
      if (provider === 'ollama') {
        endpoint = 'http://localhost:11434/v1';
      } else if (provider === 'ooba') {
        endpoint = 'http://localhost:5000/v1';
      }
    }

    if (!model) {
      if (provider === 'ollama') {
        model = 'llama3.2';
      } else if (provider === 'openai') {
        model = 'gpt-4o-mini';
      } else if (provider === 'anthropic') {
        model = 'claude-3-haiku-20240307';
      } else if (provider === 'deepseek') {
        model = 'deepseek-chat';
      } else {
        throw new Error(
          'No text generation provider configured. ' +
            'Create a Connection in Settings or set PUBLIC_OPENROUTER_MODEL in your .env file.',
        );
      }
    }

    return {
      model,
      provider,
      endpoint,
      apiKey: text.apiKeys[provider],
    };
  }

  // ── Private: connection seeding from env ──────────────────────────

  /**
   * Seeds connections from environment variables when no connections
   * have been created yet. This provides a zero-config onboarding path
   * while keeping Connections as the primary configuration surface.
   *
   * Supports both PUBLIC_* (Vite) and bare (Tauri/desktop) env var formats.
   * Each provider with an API key or model env var gets a connection with
   * source: 'env' so the UI can show a (✓ env: KEY_NAME) badge.
   */
  private _seedConnectionsFromEnv(): void {
    if (this.state.connections && this.state.connections.length > 0) {
      return;
    }

    if (!this.state.connections) {
      this.state.connections = [];
    }

    const now = new Date().toISOString();
    const seeded: Connection[] = [];

    // Provider→env var mapping. Each entry defines how to detect a provider
    // from env vars and what default model + display name to use.
    const ProviderEnvMap = [
      {
        provider: 'ollama',
        label: 'Ollama (local)',
        apiKeyEnv: undefined, // Ollama doesn't need an API key
        modelEnv: ['PUBLIC_OLLAMA_MODEL', 'OLLAMA_MODEL'],
        urlEnv: ['PUBLIC_OLLAMA_BASE_URL', 'OLLAMA_BASE_URL'],
        defaultModel: '',
        defaultUrl: 'http://localhost:11434/v1',
        isLocal: true,
      },
      {
        provider: 'openrouter',
        label: 'OpenRouter',
        apiKeyEnv: ['PUBLIC_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
        modelEnv: ['PUBLIC_OPENROUTER_MODEL', 'OPENROUTER_MODEL'],
        urlEnv: undefined,
        defaultModel: 'openrouter/auto',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'openai',
        label: 'OpenAI',
        apiKeyEnv: ['PUBLIC_OPENAI_API_KEY', 'OPENAI_API_KEY'],
        modelEnv: ['PUBLIC_OPENAI_MODEL', 'OPENAI_MODEL'],
        urlEnv: undefined,
        defaultModel: 'gpt-4o-mini',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'anthropic',
        label: 'Anthropic',
        apiKeyEnv: ['PUBLIC_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
        modelEnv: ['PUBLIC_ANTHROPIC_MODEL', 'ANTHROPIC_MODEL'],
        urlEnv: undefined,
        defaultModel: 'claude-3-haiku-20240307',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'deepseek',
        label: 'DeepSeek',
        apiKeyEnv: ['PUBLIC_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
        modelEnv: ['PUBLIC_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL'],
        urlEnv: undefined,
        defaultModel: 'deepseek-chat',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'google',
        label: 'Google (Gemini)',
        apiKeyEnv: ['PUBLIC_GEMINI_API_KEY', 'GEMINI_API_KEY'],
        modelEnv: ['PUBLIC_GEMINI_MODEL', 'GEMINI_MODEL'],
        urlEnv: undefined,
        defaultModel: 'gemini-2.0-flash',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'mistral',
        label: 'Mistral AI',
        apiKeyEnv: ['PUBLIC_MISTRAL_API_KEY', 'MISTRAL_API_KEY'],
        modelEnv: ['PUBLIC_MISTRAL_MODEL', 'MISTRAL_MODEL'],
        urlEnv: undefined,
        defaultModel: 'mistral-small-latest',
        defaultUrl: undefined,
        isLocal: false,
      },
      {
        provider: 'cohere',
        label: 'Cohere',
        apiKeyEnv: ['PUBLIC_COHERE_API_KEY', 'COHERE_API_KEY'],
        modelEnv: ['PUBLIC_COHERE_MODEL', 'COHERE_MODEL'],
        urlEnv: undefined,
        defaultModel: 'command-r',
        defaultUrl: undefined,
        isLocal: false,
      },
    ] as const;

    for (const entry of ProviderEnvMap) {
      const apiKey = entry.apiKeyEnv ? this._readEnvFirst(entry.apiKeyEnv) : undefined;
      const model =
        (entry.modelEnv ? this._readEnvFirst(entry.modelEnv) : undefined) ??
        (entry.provider === 'ollama' ? undefined : entry.defaultModel);
      const url = entry.urlEnv ? this._readEnvFirst(entry.urlEnv) : undefined;

      // Skip providers without an env key or model unless they're local
      if (!entry.isLocal && !apiKey && !model) {
        continue;
      }

      // For local providers (Ollama), skip if no model configured
      if (entry.isLocal && !model) {
        continue;
      }

      seeded.push({
        id: crypto.randomUUID(),
        name: entry.label,
        provider: entry.provider,
        capability: 'text',
        apiKey: apiKey ?? '',
        baseUrl: url ?? entry.defaultUrl ?? '',
        model: model ?? entry.defaultModel,
        generationParams: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        isDefault: seeded.length === 0,
        source: 'env',
        createdAt: now,
        updatedAt: now,
      });
    }

    if (seeded.length > 0) {
      this.state.connections = seeded;
      this.state.defaultConnectionId = seeded[0].id;
    }
  }

  // ── Private: env helpers ─────────────────────────────────────────────

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
      text: { apiKeys: {}, provider: 'openrouter' },
      voice: { ...DEFAULT_VOICE_CONFIG },
    };
  }

  /**
   * Injects defaults from environment variables. The preferred model is
   * only injected when no user configuration exists in localStorage, but
   * the API key is always injected from env if available and not already
   * set — this ensures the key survives stale vaults and model-only saves.
   */
  private _injectEnvDefaults(): void {
    // Seed connections from env vars when none exist (zero-config onboarding)
    this._seedConnectionsFromEnv();

    // Inject API keys from env for all providers (always available as fallback).
    // Both PUBLIC_* (Vite) and bare (Tauri/desktop) env var names are checked.
    const ProviderKeyEnvMap: ReadonlyArray<{
      provider: string;
      envNames: readonly string[];
    }> = [
      { provider: 'openrouter', envNames: ['PUBLIC_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'] },
      { provider: 'openai', envNames: ['PUBLIC_OPENAI_API_KEY', 'OPENAI_API_KEY'] },
      { provider: 'anthropic', envNames: ['PUBLIC_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] },
      { provider: 'deepseek', envNames: ['PUBLIC_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'] },
      { provider: 'google', envNames: ['PUBLIC_GEMINI_API_KEY', 'GEMINI_API_KEY'] },
      { provider: 'mistral', envNames: ['PUBLIC_MISTRAL_API_KEY', 'MISTRAL_API_KEY'] },
      { provider: 'cohere', envNames: ['PUBLIC_COHERE_API_KEY', 'COHERE_API_KEY'] },
    ];

    for (const entry of ProviderKeyEnvMap) {
      const envKey = this._readEnvFirst(entry.envNames);
      if (envKey && !this.state.text.apiKeys[entry.provider]) {
        this.state.text = {
          ...this.state.text,
          apiKeys: { ...this.state.text.apiKeys, [entry.provider]: envKey },
        };
      }
    }
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

  /** Safely reads a Vite PUBLIC_* or bare env var. Returns undefined in tests. */
  private _readEnv(name: string): string | undefined {
    try {
      const env = import.meta.env as Record<string, string | undefined>;
      // Try the exact name first (e.g. PUBLIC_OPENROUTER_API_KEY)
      const value = env[name];
      return value && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Tries multiple env var names in order, returning the first non-empty
   * value. Used to fall back from PUBLIC_* (Vite) to bare names (Tauri).
   */
  private _readEnvFirst(names: readonly string[]): string | undefined {
    for (const name of names) {
      const value = this._readEnv(name);
      if (value) {
        return value;
      }
    }
    return undefined;
  }
}

export { ConfigService };

export const configService: ConfigServiceInterface = ConfigService.create({
  className: 'ConfigService',
});
