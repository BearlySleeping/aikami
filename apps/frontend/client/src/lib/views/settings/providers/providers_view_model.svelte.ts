// apps/frontend/client/src/lib/views/settings/providers/providers_view_model.svelte.ts
//
// ViewModel for the provider configuration dashboard. Bridges ConfigService (local
// persistence) and LocalServiceDetector (port polling) to the view layer.
// Manages tab navigation, debounced saves, service detection, model fetching,
// and generation parameter configuration.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  type AdvancedOverrides,
  type AuxiliaryModels,
  type ConfigState,
  configService,
  DEFAULT_VOICE_ARCHETYPES,
  EMBEDDING_MODELS,
  EMOTION_METHODS,
  type EmotionConfig,
  type GenerationParams,
  IMAGE_PROVIDERS,
  type ImageConfig,
  INSTRUCT_TEMPLATES,
  type InstructTemplate,
  KOKORO_VOICES,
  MEMORY_TYPES,
  type MemoryConfig,
  TEXT_PROVIDERS,
  type TextProvider,
  VOICE_ENGINES,
  VOICE_PROVIDERS,
  type VoiceArchetype,
  type VoiceConfig,
  type VoiceOption,
} from '$lib/services/config/config_service.svelte';
import {
  LocalServiceDetector,
  type LocalServiceDetectorInterface,
  type LocalServiceStatus,
} from '$lib/services/config/local_service_detector.svelte';
import {
  fetchOpenRouterModels,
  type OpenRouterModel,
} from '$lib/services/config/openrouter_models';
import {
  buildVerifyHeaders,
  buildVerifyUrl,
  PROVIDER_ENDPOINTS,
  type ProviderEndpoint,
} from '$lib/services/config/provider_endpoints';
import { type CheckpointInfo, imageGenerationService } from '$services';

export type { CheckpointInfo, EmotionConfig, ProviderEndpoint };
export {
  EMBEDDING_MODELS,
  EMOTION_METHODS,
  IMAGE_PROVIDERS,
  MEMORY_TYPES,
  PROVIDER_ENDPOINTS,
  TEXT_PROVIDERS,
  VOICE_PROVIDERS,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration tab identifiers. */
export const CONFIG_TABS = ['text', 'voice', 'image', 'advanced', 'connections'] as const;

export type ConfigTab = (typeof CONFIG_TABS)[number];

/** Human-readable tab label. */
export type ConfigTabMeta = {
  key: ConfigTab;
  label: string;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type ProvidersViewModelInterface = BaseViewModelInterface & {
  /** All available tabs with metadata. */
  readonly tabs: readonly ConfigTabMeta[];
  /** Currently active tab. */
  readonly activeTab: ConfigTab;
  /** Full configuration state (proxied from ConfigService). */
  readonly config: ConfigState;
  /** Generation parameters (proxied). */
  readonly generationParams: GenerationParams;
  /** Current instruct template (proxied). */
  readonly instructTemplate: InstructTemplate;
  /** Advanced provider overrides (proxied). */
  readonly advancedOverrides: AdvancedOverrides;
  /** Whether config has been loaded from localStorage. */
  readonly isLoaded: boolean;
  /** Local service connection statuses. */
  readonly serviceStatus: LocalServiceStatus;
  /** Whether a service detection scan is in progress. */
  readonly isDetecting: boolean;
  /** Whether a save operation is in progress. */
  readonly isSaving: boolean;
  /** Last save timestamp (ISO string), or empty if never saved. */
  readonly lastSaved: string;
  /** Verification status per provider ('idle' | 'checking' | 'valid' | 'invalid'). */
  readonly verificationStatus: Record<string, 'idle' | 'checking' | 'valid' | 'invalid'>;
  /** Available ComfyUI checkpoints (loaded from the image service). */
  readonly checkpoints: readonly CheckpointInfo[];
  /** Currently selected ComfyUI checkpoint. */
  readonly selectedCheckpoint: string;
  /** Whether ComfyUI is detected and ready. */
  readonly isImageGenReady: boolean;
  /** Whether checkpoints are being loaded. */
  readonly isDetectingCheckpoints: boolean;
  /** Available TTS engines for the dropdown. */
  readonly voiceEngines: ReadonlyArray<{ id: string; label: string }>;
  /** Voice options for the currently selected engine. */
  readonly availableVoices: readonly VoiceOption[];
  /** Whether a test voice request is in progress. */
  readonly isTestingVoice: boolean;
  /** User-editable voice archetype → Kokoro ID mappings. */
  readonly voiceArchetypes: readonly VoiceArchetype[];
  /** Default voice archetypes (for reset reference). */
  readonly defaultVoiceArchetypes: readonly VoiceArchetype[];
  /** Available OpenRouter models (fetched from API). */
  readonly availableOpenRouterModels: readonly OpenRouterModel[];
  /** Whether an OpenRouter model fetch is in progress. */
  readonly isFetchingModels: boolean;
  /** Filter query for the model search dropdown. */
  readonly modelSearchQuery: string;
  /** Auxiliary model assignments (proxied). */
  readonly auxiliaryModels: AuxiliaryModels;
  /** Available instruct templates for the dropdown. */
  readonly instructTemplates: readonly string[];
  /** Available image providers for the dropdown. */
  readonly imageProviders: ReadonlyArray<{ id: string; label: string; description: string }>;
  /** Available voice providers for the dropdown. */
  readonly voiceProviders: ReadonlyArray<{ id: string; label: string; description: string }>;
  /** Available memory types for the dropdown. */
  readonly memoryTypes: readonly string[];
  /** Available embedding models for the dropdown. */
  readonly embeddingModels: ReadonlyArray<{ id: string; label: string }>;
  /** Available emotion methods for the dropdown. */
  readonly emotionMethods: readonly string[];
  /** Emotion config (proxied). */
  readonly emotion: EmotionConfig;

  /** Switches the active tab. */
  setActiveTab(tab: ConfigTab): void;
  /** Persists all configuration to localStorage (and optionally Firestore). */
  save(): Promise<void>;
  /** Reverts all changes by reloading from localStorage. */
  revert(): Promise<void>;
  /** Resets all configuration to factory defaults. */
  reset(): Promise<void>;
  /** Scans for locally running services. */
  detectServices(): Promise<void>;
  /** Detects a single service. */
  detectService(key: keyof LocalServiceStatus): Promise<void>;
  /** Schedules a debounced save after a config field change. */
  scheduleSave(): void;
  /** Updates a single config field (memory/voice/image/emotion sections). */
  setField(
    section: 'memory' | 'voice' | 'image' | 'emotion',
    field: string,
    value: string | number | boolean,
  ): void;
  /** Set the text provider from dropdown. */
  setTextProvider(provider: string): void;
  /** Set the API key for a given text provider. */
  setTextApiKey(provider: string, key: string): void;
  /** Set the custom URL for the text provider. */
  setTextUrl(url: string): void;
  /** Updates the preferred model. */
  setPreferredModel(model: string): void;
  /** Updates a single model config field by index. */
  setModelField(index: number, field: string, value: string): void;
  /** Verifies a provider API key by fetching its models endpoint. */
  verifyApiKey(provider: string): Promise<void>;
  /** Loads available ComfyUI checkpoints. */
  detectCheckpoints(): Promise<void>;
  /** Selects a ComfyUI checkpoint by ID. */
  setCheckpoint(id: string): void;
  /** Sends a test TTS request to hear the selected voice. */
  testVoice(): Promise<void>;
  /** Updates the Kokoro voice ID for a given archetype. */
  setArchetypeVoice(archetypeId: string, voiceId: string): void;
  /** Updates the label for a given archetype. */
  setArchetypeLabel(archetypeId: string, label: string): void;
  /** Adds a new voice archetype mapping. */
  addArchetype(): void;
  /** Removes a voice archetype mapping by ID. */
  removeArchetype(archetypeId: string): void;
  /** Fetches available models from OpenRouter. */
  fetchModels(): Promise<void>;
  /** Sets the model search/filter query. */
  setModelSearchQuery(query: string): void;
  /** Updates an auxiliary model assignment. */
  setAuxiliaryModel(task: keyof AuxiliaryModels, modelId: string | undefined): void;
  /** Updates a single generation parameter. */
  setGenerationParam(field: keyof GenerationParams, value: number): void;
  /** Sets the instruct template format. */
  setInstructTemplate(template: InstructTemplate): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ProvidersViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// Tab metadata
// ---------------------------------------------------------------------------

const TAB_META: readonly ConfigTabMeta[] = [
  { key: 'text', label: 'Text' },
  { key: 'voice', label: 'Voice' },
  { key: 'image', label: 'Image' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'connections', label: 'Connections' },
] as const;

/** Debounce delay in milliseconds before auto-saving after a field change. */
const SAVE_DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ProvidersViewModel
  extends BaseViewModel<ProvidersViewModelOptions>
  implements ProvidersViewModelInterface
{
  activeTab: ConfigTab = $state('text');
  isDetecting = $state(false);
  isSaving = $state(false);
  lastSaved = $state('');
  isDetectingCheckpoints = $state(false);
  isTestingVoice = $state(false);
  isFetchingModels = $state(false);
  modelSearchQuery = $state('');
  availableOpenRouterModels: OpenRouterModel[] = $state([]);
  verificationStatus: Record<string, 'idle' | 'checking' | 'valid' | 'invalid'> = $state({});

  private readonly _detector: LocalServiceDetectorInterface;
  private _saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ProvidersViewModelOptions) {
    super(options);
    this._detector = new LocalServiceDetector();
  }

  // ── Proxied state (native getters) ────────────────────────────────────

  get tabs(): readonly ConfigTabMeta[] {
    return TAB_META;
  }

  get config(): ConfigState {
    return configService.state;
  }

  get generationParams(): GenerationParams {
    return configService.state.generationParams;
  }

  get instructTemplate(): InstructTemplate {
    return configService.state.instructTemplate;
  }

  get advancedOverrides(): AdvancedOverrides {
    return configService.state.advancedOverrides;
  }

  get isLoaded(): boolean {
    return configService.isLoaded;
  }

  get serviceStatus(): LocalServiceStatus {
    return this._detector.status;
  }

  get checkpoints(): readonly CheckpointInfo[] {
    return imageGenerationService.checkpoints;
  }

  get selectedCheckpoint(): string {
    return imageGenerationService.selectedCheckpoint;
  }

  get isImageGenReady(): boolean {
    return imageGenerationService.isReady;
  }

  get voiceEngines(): ReadonlyArray<{ id: string; label: string }> {
    return VOICE_ENGINES;
  }

  get voiceArchetypes(): readonly VoiceArchetype[] {
    return this.config.voice.voiceArchetypes ?? [];
  }

  get defaultVoiceArchetypes(): readonly VoiceArchetype[] {
    return DEFAULT_VOICE_ARCHETYPES;
  }

  get availableVoices(): readonly VoiceOption[] {
    const engine = this.config.voice.engine;
    if (engine === 'kokoro') {
      return KOKORO_VOICES;
    }
    // For other engines, return an empty list — voices must be configured
    // via the provider's dashboard or fetched dynamically.
    return [];
  }

  get auxiliaryModels(): AuxiliaryModels {
    return configService.state.auxiliaryModels;
  }

  get instructTemplates(): readonly string[] {
    return INSTRUCT_TEMPLATES;
  }

  get imageProviders(): ReadonlyArray<{ id: string; label: string; description: string }> {
    return IMAGE_PROVIDERS;
  }

  get voiceProviders(): ReadonlyArray<{ id: string; label: string; description: string }> {
    return VOICE_PROVIDERS;
  }

  get memoryTypes(): readonly string[] {
    return MEMORY_TYPES;
  }

  get embeddingModels(): ReadonlyArray<{ id: string; label: string }> {
    return EMBEDDING_MODELS;
  }

  get emotionMethods(): readonly string[] {
    return EMOTION_METHODS;
  }

  get emotion(): EmotionConfig {
    return configService.state.emotion;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.debug('initialize');
    await configService.load();

    // Restore persisted checkpoint selection
    const savedCheckpoint = configService.state.image.checkpoint;
    if (savedCheckpoint) {
      imageGenerationService.selectedCheckpoint = savedCheckpoint;
    }

    this._verifyExistingOpenRouterKey();
    this._detectServicesInBackground();
    await super.initialize();
  }

  // ── Public API ────────────────────────────────────────────────────────

  setActiveTab(tab: ConfigTab): void {
    this.activeTab = tab;
  }

  async save(): Promise<void> {
    this.debug('save');
    this.isSaving = true;

    try {
      await configService.save();
      this.lastSaved = new Date().toISOString();
    } finally {
      this.isSaving = false;
    }
  }

  async revert(): Promise<void> {
    this.debug('revert');
    await configService.load();
    this.lastSaved = '';
  }

  async reset(): Promise<void> {
    this.debug('reset');
    await configService.reset();
    this.lastSaved = '';
  }

  async detectServices(): Promise<void> {
    this.debug('detectServices');
    this.isDetecting = true;

    try {
      await this._detector.detectAll();
    } finally {
      this.isDetecting = false;
    }
  }

  async detectService(key: keyof LocalServiceStatus): Promise<void> {
    this.debug('detectService', { key });
    await this._detector.detectService(key);
  }

  // ── Debounced save (called by view on field change) ───────────────────

  /** Schedules a debounced save after a config field change. */
  scheduleSave(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      void this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  // ── Generic field setter (called by view on input change) ────────────

  /**
   * Updates a config field from an input event.
   * Handles numbers (range, number inputs) and strings (text inputs).
   *
   * @param section - Top-level config section
   * @param field - Field name within the section
   * @param value - Raw value from the input event
   */
  setField(
    section: 'memory' | 'voice' | 'image' | 'emotion',
    field: string,
    value: string | number | boolean,
  ): void {
    if (section === 'memory') {
      configService.setMemoryConfig({ [field]: value } as Partial<MemoryConfig>);
    } else if (section === 'voice') {
      configService.setVoiceConfig({ [field]: value } as Partial<VoiceConfig>);
    } else if (section === 'image') {
      configService.setImageConfig({ [field]: value } as Partial<ImageConfig>);
    } else if (section === 'emotion') {
      configService.setEmotionConfig({ [field]: value } as Partial<EmotionConfig>);
    }
    this.scheduleSave();
  }

  setTextProvider(provider: string): void {
    configService.setTextProvider(provider as TextProvider);
    this.scheduleSave();
  }

  setTextApiKey(provider: string, key: string): void {
    configService.setTextApiKey(provider, key);
    this.scheduleSave();
  }

  setTextUrl(url: string): void {
    configService.setTextUrl(url);
    this.scheduleSave();
  }

  setPreferredModel(model: string): void {
    configService.setPreferredModel(model);
    this.scheduleSave();
  }

  setModelField(index: number, field: string, value: string): void {
    configService.updateModel(index, { [field]: value } as Record<string, string>);
    this.scheduleSave();
  }

  async verifyApiKey(provider: string): Promise<void> {
    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      return;
    }

    const apiKey: string | undefined = configService.state.text.apiKeys[provider];
    if (!apiKey) {
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
      return;
    }

    this.verificationStatus = { ...this.verificationStatus, [provider]: 'checking' };

    try {
      const url = buildVerifyUrl(endpoint, apiKey);
      const headers = buildVerifyHeaders(endpoint, apiKey);

      const response = await fetch(url, { method: endpoint.method, headers });

      if (response.ok) {
        this.verificationStatus = { ...this.verificationStatus, [provider]: 'valid' };
      } else {
        this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
      }
    } catch {
      this.verificationStatus = { ...this.verificationStatus, [provider]: 'invalid' };
    }
  }

  // ── Checkpoint detection ──────────────────────────────────────────────

  async detectCheckpoints(): Promise<void> {
    this.debug('detectCheckpoints');
    this.isDetectingCheckpoints = true;

    try {
      await imageGenerationService.loadCheckpoints();
    } finally {
      this.isDetectingCheckpoints = false;
    }
  }

  setCheckpoint(id: string): void {
    imageGenerationService.selectedCheckpoint = id;
    // Persist to ConfigService so it survives refresh
    configService.setImageConfig({ checkpoint: id });
    this.scheduleSave();
  }

  // ── Test voice ───────────────────────────────────────────────────────

  async testVoice(): Promise<void> {
    this.debug('testVoice');
    this.isTestingVoice = true;

    try {
      const { engine, voiceId, speed } = this.config.voice;
      const testText = 'Hello! This is a test of the selected voice.';

      if (engine === 'kokoro') {
        const response = await fetch('/api/voice/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: testText,
            model: 'tts-1',
            response_format: 'mp3',
            speed,
            voice: voiceId,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new Error(`TTS request failed (${response.status}): ${errorText}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        await audio.play();
        // Clean up the object URL after playback
        audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true });
      } else {
        // For other engines (elevenlabs, openai), playback is handled
        // by the TTS service via the configured API key.
        this.warn('testVoice: engine not yet supported for testing', { engine });
      }
    } catch (error) {
      this.error('testVoice: failed', error);
    } finally {
      this.isTestingVoice = false;
    }
  }

  // ── Voice archetype management ───────────────────────────────────────

  setArchetypeVoice(archetypeId: string, voiceId: string): void {
    const archetypes = this.config.voice.voiceArchetypes ?? [];
    const updated = archetypes.map((a) => (a.id === archetypeId ? { ...a, voiceId } : a));
    configService.setVoiceConfig({ voiceArchetypes: updated });
    this.scheduleSave();
  }

  setArchetypeLabel(archetypeId: string, label: string): void {
    const archetypes = this.config.voice.voiceArchetypes ?? [];
    const updated = archetypes.map((a) => (a.id === archetypeId ? { ...a, label } : a));
    configService.setVoiceConfig({ voiceArchetypes: updated });
    this.scheduleSave();
  }

  addArchetype(): void {
    const archetypes = this.config.voice.voiceArchetypes ?? [];
    const id = `custom-${Date.now()}`;
    const updated = [...archetypes, { id, label: 'Custom Voice', voiceId: 'af_heart' }];
    configService.setVoiceConfig({ voiceArchetypes: updated });
    this.scheduleSave();
  }

  removeArchetype(archetypeId: string): void {
    const archetypes = this.config.voice.voiceArchetypes ?? [];
    const updated = archetypes.filter((a) => a.id !== archetypeId);
    configService.setVoiceConfig({ voiceArchetypes: updated });
    this.scheduleSave();
  }

  // ── OpenRouter model fetching ────────────────────────────────────────

  async fetchModels(): Promise<void> {
    this.debug('fetchModels');
    const apiKey = configService.state.text.apiKeys.openrouter;
    if (!apiKey) {
      this.warn('fetchModels: no OpenRouter API key configured');
      return;
    }

    this.isFetchingModels = true;

    try {
      const models = await fetchOpenRouterModels(apiKey);
      this.availableOpenRouterModels = models;
    } finally {
      this.isFetchingModels = false;
    }
  }

  setModelSearchQuery(query: string): void {
    this.modelSearchQuery = query;
  }

  // ── Auxiliary models ─────────────────────────────────────────────────

  setAuxiliaryModel(task: keyof AuxiliaryModels, modelId: string | undefined): void {
    configService.setAuxiliaryModels({ [task]: modelId || undefined });
    this.scheduleSave();
  }

  // ── Generation parameters ────────────────────────────────────────────

  setGenerationParam(field: keyof GenerationParams, value: number): void {
    configService.setGenerationParams({ [field]: value });
    this.scheduleSave();
  }

  // ── Instruct template ────────────────────────────────────────────────

  setInstructTemplate(template: InstructTemplate): void {
    configService.setInstructTemplate(template);
    this.scheduleSave();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Auto-verifies the OpenRouter API key if one is configured, so the
   * verification status survives page reloads without requiring the user
   * to manually click "Verify" on the API Keys tab.
   */
  private _verifyExistingOpenRouterKey(): void {
    const apiKey = configService.state.text.apiKeys.openrouter;
    if (apiKey && apiKey.length > 0) {
      this.debug('_verifyExistingOpenRouterKey: found key, auto-verifying');
      void this.verifyApiKey('openrouter');
    }
  }

  private _detectServicesInBackground(): void {
    void this.detectServices();
  }
}

export const getProvidersViewModel = (
  options: ProvidersViewModelOptions,
): ProvidersViewModelInterface => new ProvidersViewModel(options);
