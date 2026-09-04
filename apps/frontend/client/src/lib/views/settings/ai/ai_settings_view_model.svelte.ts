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
  type GenParamPreset,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  campaignService,
  configService,
  type FetchedModel,
  fetchModelsFromProvider,
  imageGenerationService,
  PROVIDER_MODEL_FETCH,
  styleProfileService,
  ttsService,
  voiceModelService,
} from '$services';
import type { AiProvider, AiConnection, AiRole, VoiceArchetype, TextParams, ImageParams, VoiceParams } from '@aikami/types';
import type { ConnectionCapability, ConnectionId, ConnectionTestResult, VoiceModelState } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-capability connection status for the status board. */
export type CapabilityStatus = 'connected' | 'offline' | 'not_configured' | 'loading';

/** Status board entry for one capability. */
export type CapabilityStatusEntry = {
  capability: ConnectionCapability;
  connectionId: ConnectionId | undefined;
  status: CapabilityStatus;
  color: string;
  dot: string;
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

/** State of the voice archetype preview (AC-6). */
export type VoicePreviewState =
  | { status: 'idle' }
  | { status: 'playing' }
  | { status: 'error'; error: string };

/** State of the image connection preview (AC-7). */
export type ImagePreviewState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; url: string }
  | { status: 'error'; error: string };

/** A size preset applied to an image connection's params. */
export type ImageSizePreset = {
  id: string;
  label: string;
  role: AiRole;
  width: number;
  height: number;
};

/** A quality level mapped onto steps/cfg. */
export type ImageQualityLevel = {
  id: string;
  label: string;
  steps: number;
  cfg: number;
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

/** Presentation state and actions exposed by the AI settings ViewModel. */
export type AiSettingsViewModelInterface = BaseViewModelInterface & {
  /** Whether page-only roles, voice, and image sections should render. */
  readonly showAdvancedSections: boolean;

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
  readonly fetchModelsError: string | undefined;
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
  testConnection(connectionId: ConnectionId | undefined): Promise<void>;
  testDraftConnection(): Promise<void>;
  fetchModels(): Promise<void>;
  toggleApiKeyVisibility(): void;
  resolveKeyConflict(update: boolean): void;
  dismissKeyConflict(): void;

  // ── Role actions ──
  toggleRolesDrawer(): void;
  assignRole(role: AiRole, connectionId: ConnectionId): void;
  clearRole(role: AiRole): void;

  // ── Voice section (AC-6) ──
  readonly voiceConnections: readonly AiConnection[];
  readonly activeVoiceConnectionId: ConnectionId | undefined;
  setActiveVoiceConnection(connectionId: ConnectionId): void;
  readonly voiceArchetypes: readonly VoiceArchetype[];
  setVoiceArchetype(archetypeId: string, voiceId: string): void;
  voiceIdInputLabelFor(archetypeLabel: string): string;
  readonly voiceSpeed: number;
  readonly voicePitch: number;
  setVoiceSpeed(speed: number): void;
  setVoicePitch(pitch: number): void;
  commitConfigChanges(): void;
  readonly voicePreviewState: VoicePreviewState;
  previewVoiceArchetype(archetypeId: string): Promise<void>;
  readonly showVoiceLocalDownload: boolean;
  readonly voiceModelState: VoiceModelState;
  readonly voiceModelProgress: number;
  readonly voiceModelSizeLabel: string;
  downloadVoiceModel(): Promise<void>;
  cancelVoiceModelDownload(): void;

  // ── Image section (AC-7) ──
  readonly imageConnections: readonly AiConnection[];
  readonly activeImageConnectionId: ConnectionId | undefined;
  setActiveImageConnection(connectionId: ConnectionId): void;
  readonly imageSizePresets: readonly ImageSizePreset[];
  setImageSizePreset(connectionId: ConnectionId, presetId: string): void;
  readonly imageQualityLevels: readonly ImageQualityLevel[];
  setImageQuality(connectionId: ConnectionId, levelId: string): void;
  isImageAdvancedOpenFor(connectionId: ConnectionId): boolean;
  toggleImageAdvanced(connectionId: ConnectionId): void;
  imageParamsFor(connectionId: ConnectionId): ImageParams;
  setImageParamField(connectionId: ConnectionId, field: 'steps' | 'cfg', value: number): void;
  readonly imageCheckpoints: readonly string[];
  setImageCheckpoint(connectionId: ConnectionId, checkpoint: string): void;
  readonly imageStyleProfiles: ReadonlyArray<{ id: string; label: string }>;
  readonly activeStyleProfileId: string;
  setImageStyleProfile(profileId: string): void;
  imagePreviewStateFor(connectionId: ConnectionId): ImagePreviewState;
  imagePreviewUrlFor(connectionId: ConnectionId): string;
  imagePreviewErrorFor(connectionId: ConnectionId): string;
  previewImage(connectionId: ConnectionId): Promise<void>;

  // ── Generation-parameter disclosure (AC-8) ──
  readonly isGenParamsOpen: boolean;
  toggleGenParamsDisclosure(): void;
  readonly genParamsDisplay: TextParams | undefined;
  setGenParamField(field: keyof TextParams, value: number): void;
  readonly genParamPresets: readonly GenParamPreset[];
  applyGenPreset(presetId: string): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AiSettingsViewModelOptions = BaseViewModelOptions & {
  showAdvancedSections?: boolean;
};

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

const IMAGE_SIZE_PRESETS: readonly ImageSizePreset[] = [
  { id: 'portrait', label: 'Portrait (768×1024)', role: 'portrait', width: 768, height: 1024 },
  { id: 'scene', label: 'Scene (1024×768)', role: 'scene', width: 1024, height: 768 },
];

const IMAGE_QUALITY_LEVELS: readonly ImageQualityLevel[] = [
  { id: 'draft', label: 'Draft', steps: 15, cfg: 5 },
  { id: 'standard', label: 'Standard', steps: 25, cfg: 7 },
  { id: 'high', label: 'High', steps: 35, cfg: 9 },
];

const DEFAULT_IMAGE_PARAMS: ImageParams = {
  checkpoint: '',
  width: 512,
  height: 512,
  steps: 20,
  cfg: 7,
};

/** Used for the voice preview when no campaign is active (AC-6, Edge Cases). */
export const VOICE_PREVIEW_FALLBACK_LINE =
  'The tavern door creaks open as a gust of wind sweeps through the room.';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _registryForCapability = (capability: ConnectionCapability) => {
  if (capability === 'image') {
    return IMAGE_PROVIDERS;
  }
  if (capability === 'voice') {
    return VOICE_PROVIDERS;
  }
  return TEXT_PROVIDERS;
};

const _deriveCapabilityStatus = (options: {
  connection: AiConnection | undefined;
  testResults: Record<string, ConnectionTestResult>;
  testingIds: Set<string>;
}) => {
  if (!options.connection) {
    return 'not_configured';
  }
  if (options.testingIds.has(options.connection.id)) {
    return 'loading';
  }
  const result = options.testResults[options.connection.id];
  if (result && !result.ok) {
    return 'offline';
  }
  return 'connected';
};

const _capabilityColor = (status: CapabilityStatus) => {
  if (status === 'connected') {
    return 'text-success';
  }
  if (status === 'offline') {
    return 'text-error';
  }
  return 'text-base-content/40';
};

const _capabilityDot = (status: CapabilityStatus) =>
  status === 'connected' || status === 'offline' ? '\u25CF' : '\u25CB';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Production implementation shared with the dev-only fixture subclass. */
export class AiSettingsViewModel
  extends BaseViewModel<AiSettingsViewModelOptions>
  implements AiSettingsViewModelInterface
{
  private _availableModels: FetchedModel[] = $state([]);
  private _voiceArchetypes: VoiceArchetype[] = $state([]);
  private _activeVoiceConnectionId: ConnectionId | undefined = $state(undefined);
  private _activeImageConnectionId: ConnectionId | undefined = $state(undefined);
  private _genParamsDraft: Partial<TextParams> = $state({});
  private _imagePreviewStates: Record<ConnectionId, ImagePreviewState> = $state({});
  private _imageAdvancedOpenStates: Record<ConnectionId, boolean> = $state({});

  // ── State ──
  isEditorOpen = $state(false);
  isAddProviderOpen = $state(false);
  isRolesDrawerOpen = $state(false);
  isFetchingModels = $state(false);
  fetchModelsError = $state<string | undefined>(undefined);
  testResults: Record<string, ConnectionTestResult> = $state({});
  testingIds: Set<string> = $state(new Set());
  keyConflictPrompt: KeyConflictPrompt | undefined = $state(undefined);
  voicePreviewState: VoicePreviewState = $state({ status: 'idle' });
  isGenParamsOpen = $state(false);
  readonly showAdvancedSections: boolean;

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

  constructor(options: AiSettingsViewModelOptions) {
    super(options);
    this.showAdvancedSections = options.showAdvancedSections ?? true;
  }

  // ── Derived: status board ──

  get statusEntries(): readonly CapabilityStatusEntry[] {
    const capabilities: ConnectionCapability[] = ['text', 'voice', 'image'];
    return capabilities.map((cap) => {
      const connections = this._connectionsForCapability(cap);
      const providers = this._providersForCapability(cap);
      const firstConn = connections[0];
      const status = _deriveCapabilityStatus({
        connection: firstConn,
        testResults: this.testResults,
        testingIds: this.testingIds,
      });
      const testResult = firstConn ? this.testResults[firstConn.id] : undefined;
      const provider = firstConn ? providers.find((p) => p.id === firstConn.providerId) : undefined;
      const registry = _registryForCapability(cap);
      const registryEntry = registry.find((r) => r.id === provider?.registryId);
      return {
        capability: cap,
        connectionId: firstConn?.id,
        status,
        color: _capabilityColor(status),
        dot: _capabilityDot(status),
        label: cap.charAt(0).toUpperCase() + cap.slice(1),
        modelName: firstConn?.model,
        latencyMs: testResult?.ok ? testResult.latencyMs : undefined,
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
    return connections
      .map((connection) => {
        const roles = (Object.keys(assignments) as AiRole[]).filter(
          (role) => assignments[role] === connection.id,
        );
        return { connection, roles };
      })
      .filter((entry) => entry.roles.length > 0);
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

  // ── Voice section (AC-6) ──

  get voiceConnections(): readonly AiConnection[] {
    return this._connectionsForCapability('voice');
  }

  get activeVoiceConnectionId(): ConnectionId | undefined {
    return this._activeVoiceConnectionId ?? this.voiceConnections[0]?.id;
  }

  setActiveVoiceConnection(connectionId: ConnectionId): void {
    this._activeVoiceConnectionId = connectionId;
  }

  get voiceArchetypes(): readonly VoiceArchetype[] {
    return this._voiceArchetypes;
  }

  setVoiceArchetype(archetypeId: string, voiceId: string): void {
    const hasArchetype = this._voiceArchetypes.some((archetype) => archetype.id === archetypeId);
    this._voiceArchetypes = hasArchetype
      ? this._voiceArchetypes.map((archetype) =>
          archetype.id === archetypeId ? { ...archetype, voiceId } : archetype,
        )
      : [...this._voiceArchetypes, { id: archetypeId, label: archetypeId, voiceId }];
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
    }
  }

  voiceIdInputLabelFor(archetypeLabel: string): string {
    return `Voice ID for ${archetypeLabel}`;
  }

  get voiceSpeed(): number {
    return (this._activeVoiceConnection()?.params as VoiceParams | undefined)?.speed ?? 1;
  }

  get voicePitch(): number {
    return (this._activeVoiceConnection()?.params as VoiceParams | undefined)?.pitch ?? 0;
  }

  setVoiceSpeed(speed: number): void {
    this._updateActiveVoiceParams({ speed });
  }

  setVoicePitch(pitch: number): void {
    this._updateActiveVoiceParams({ pitch });
  }

  commitConfigChanges(): void {
    void configService.save();
  }

  async previewVoiceArchetype(archetypeId: string): Promise<void> {
    this.debug('previewVoiceArchetype', { archetypeId });
    const archetype = this._voiceArchetypes.find((a) => a.id === archetypeId);
    if (!archetype) {
      return;
    }
    this.voicePreviewState = { status: 'playing' };
    try {
      await ttsService.speak({ text: this._voicePreviewLine(), voiceId: archetype.voiceId });
      this.voicePreviewState = { status: 'idle' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.voicePreviewState = { status: 'error', error: message };
      this.error('previewVoiceArchetype:failed', error);
    }
  }

  get showVoiceLocalDownload(): boolean {
    return !this._hasCloudVoiceConnection();
  }

  get voiceModelState(): VoiceModelState {
    return voiceModelService.state;
  }

  get voiceModelProgress(): number {
    const state = voiceModelService.state;
    if (state.status === 'downloading') {
      return Math.round((state.receivedBytes / Math.max(1, state.totalBytes)) * 100);
    }
    if (state.status === 'verifying') {
      return 100;
    }
    return 0;
  }

  get voiceModelSizeLabel(): string {
    const bytes = voiceModelService.totalBytes;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async downloadVoiceModel(): Promise<void> {
    this.debug('downloadVoiceModel');
    try {
      await voiceModelService.download();
    } catch (error) {
      this.warn('downloadVoiceModel:failed', error);
    }
  }

  cancelVoiceModelDownload(): void {
    voiceModelService.cancel();
  }

  // ── Image section (AC-7) ──

  get imageConnections(): readonly AiConnection[] {
    return this._connectionsForCapability('image');
  }

  get activeImageConnectionId(): ConnectionId | undefined {
    return this._activeImageConnectionId ?? this.imageConnections[0]?.id;
  }

  setActiveImageConnection(connectionId: ConnectionId): void {
    this._activeImageConnectionId = connectionId;
  }

  get imageSizePresets(): readonly ImageSizePreset[] {
    return IMAGE_SIZE_PRESETS;
  }

  setImageSizePreset(connectionId: ConnectionId, presetId: string): void {
    const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this._updateImageParams(connectionId, { width: preset.width, height: preset.height });
    this.commitConfigChanges();
  }

  get imageQualityLevels(): readonly ImageQualityLevel[] {
    return IMAGE_QUALITY_LEVELS;
  }

  setImageQuality(connectionId: ConnectionId, levelId: string): void {
    const level = IMAGE_QUALITY_LEVELS.find((l) => l.id === levelId);
    if (!level) {
      return;
    }
    this._updateImageParams(connectionId, { steps: level.steps, cfg: level.cfg });
    this.commitConfigChanges();
  }

  isImageAdvancedOpenFor(connectionId: ConnectionId): boolean {
    return this._imageAdvancedOpenStates[connectionId] ?? false;
  }

  toggleImageAdvanced(connectionId: ConnectionId): void {
    this._imageAdvancedOpenStates = {
      ...this._imageAdvancedOpenStates,
      [connectionId]: !this.isImageAdvancedOpenFor(connectionId),
    };
  }

  imageParamsFor(connectionId: ConnectionId): ImageParams {
    const conn = configService.getAiConnection(connectionId);
    if (!conn || conn.capability !== 'image' || !('checkpoint' in conn.params)) {
      return DEFAULT_IMAGE_PARAMS;
    }
    return conn.params;
  }

  setImageParamField(connectionId: ConnectionId, field: 'steps' | 'cfg', value: number): void {
    this._updateImageParams(connectionId, { [field]: value });
  }

  get imageCheckpoints(): readonly string[] {
    return imageGenerationService.checkpoints.map((c) => c.id);
  }

  setImageCheckpoint(connectionId: ConnectionId, checkpoint: string): void {
    this._updateImageParams(connectionId, { checkpoint });
    this.commitConfigChanges();
  }

  get imageStyleProfiles(): ReadonlyArray<{ id: string; label: string }> {
    return styleProfileService.profiles.map((p) => ({ id: p.id, label: p.name }));
  }

  get activeStyleProfileId(): string {
    return styleProfileService.activeProfileId;
  }

  setImageStyleProfile(profileId: string): void {
    styleProfileService.setActiveProfile(profileId);
  }

  imagePreviewStateFor(connectionId: ConnectionId): ImagePreviewState {
    return this._imagePreviewStates[connectionId] ?? { status: 'idle' };
  }

  imagePreviewUrlFor(connectionId: ConnectionId): string {
    const state = this.imagePreviewStateFor(connectionId);
    return state.status === 'ready' ? state.url : '';
  }

  imagePreviewErrorFor(connectionId: ConnectionId): string {
    const state = this.imagePreviewStateFor(connectionId);
    return state.status === 'error' ? state.error : '';
  }

  async previewImage(connectionId: ConnectionId): Promise<void> {
    this.debug('previewImage', { connectionId });
    const conn = configService.getAiConnection(connectionId);
    if (!conn || conn.capability !== 'image') {
      return;
    }
    const params = this.imageParamsFor(connectionId);
    this._imagePreviewStates = {
      ...this._imagePreviewStates,
      [connectionId]: { status: 'generating' },
    };
    try {
      const result = await imageGenerationService.generateImage({
        prompt: styleProfileService.activeProfile?.positiveTags || 'A fantasy character portrait',
        checkpoint: params.checkpoint,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfgScale: params.cfg,
      });
      this._imagePreviewStates = {
        ...this._imagePreviewStates,
        [connectionId]: { status: 'ready', url: result.url },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._imagePreviewStates = {
        ...this._imagePreviewStates,
        [connectionId]: { status: 'error', error: message },
      };
      this.error('previewImage:failed', error);
    }
  }

  // ── Generation-parameter disclosure (AC-8) ──

  toggleGenParamsDisclosure(): void {
    this.isGenParamsOpen = !this.isGenParamsOpen;
  }

  get genParamsDisplay(): TextParams | undefined {
    const conn = this.draft.editingConnectionId
      ? configService.getAiConnection(this.draft.editingConnectionId)
      : undefined;
    if (!conn || conn.capability !== 'text') {
      return undefined;
    }
    return { ...(conn.params as TextParams), ...this._genParamsDraft };
  }

  setGenParamField(field: keyof TextParams, value: number): void {
    this._genParamsDraft = { ...this._genParamsDraft, [field]: value };
  }

  get genParamPresets(): readonly GenParamPreset[] {
    return configService.getPresets();
  }

  applyGenPreset(presetId: string): void {
    const preset = this.genParamPresets.find((p) => p.id === presetId);
    if (!preset) {
      return;
    }
    this._genParamsDraft = { ...preset.params };
  }

  // ── Lifecycle ──

  override async initialize(): Promise<void> {
    this.debug('initialize');
    await configService.load();
    await imageGenerationService.loadCheckpoints();
    this._loadVoiceArchetypes();
    await super.initialize();
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
    this._genParamsDraft = {};
    this.isGenParamsOpen = false;
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
    this._availableModels = [];

    // Check if a provider with this registryId already exists
    const existingProvider = this._findProviderByRegistry(registryId);
    const prefillKey = existingProvider?.credential ?? '';

    // Detect key conflict: if user had a different key and now switches
    const oldApiKey = this.draft.apiKey;
    const hasConflict = Boolean(existingProvider && oldApiKey && oldApiKey !== prefillKey);
    const conflictProvider = hasConflict ? existingProvider : undefined;

    this.draft = {
      ...this.draft,
      registryId,
      providerId: existingProvider?.id,
      apiKey: prefillKey,
      // Keep label in sync
      label: this._registryLabel(registryId) ?? registryId,
    };

    if (conflictProvider) {
      this.keyConflictPrompt = {
        newKey: oldApiKey,
        providerLabel: this._registryLabel(registryId) ?? registryId,
        sharedConnectionCount: this._connectionsForProvider(conflictProvider.id).length,
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
      const patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>> = { label, model };
      // AC-8: params are included in the patch ONLY when the Advanced
      // disclosure was actually edited — opening it alone must never write
      // a default value into a connection that never had one.
      if (conn.capability === 'text' && Object.keys(this._genParamsDraft).length > 0) {
        patch.params = { ...(conn.params as TextParams), ...this._genParamsDraft } as TextParams;
      }
      configService.updateAiConnection(this.draft.editingConnectionId, patch);
      // Update provider credential if changed
      const provider = this.draft.providerId
        ? configService.getProvider(this.draft.providerId)
        : undefined;
      if (provider && this.draft.apiKey && this.draft.apiKey !== provider.credential) {
        configService.updateProvider(provider.id, {
          credential: this.draft.apiKey,
        });
      }
    } else {
      // Resolve or create provider
      const conflictPrompt = this.keyConflictPrompt;
      let providerId: string | undefined;
      if (conflictPrompt?.resolveSeparate) {
        providerId = configService.addProvider({
          registryId: reg,
          label: this._registryLabel(reg) ?? reg,
          credential: conflictPrompt.newKey,
          baseUrl: this.draft.baseUrl || undefined,
          source: 'stored',
        });
      } else {
        const existingProvider = this.draft.providerId
          ? configService.getProvider(this.draft.providerId)
          : this._findProviderByRegistry(reg);
        if (existingProvider) {
          providerId = existingProvider.id;
          if (this.draft.apiKey && this.draft.apiKey !== existingProvider.credential) {
            configService.updateProvider(existingProvider.id, { credential: this.draft.apiKey });
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
        const defaultParams = this._defaultParams(cap);
        const params =
          cap === 'text' && Object.keys(this._genParamsDraft).length > 0
            ? ({ ...(defaultParams as TextParams), ...this._genParamsDraft } as TextParams)
            : defaultParams;
        const connectionId = configService.addAiConnection({
          providerId,
          capability: cap,
          label,
          model,
          params: params as TextParams | ImageParams | VoiceParams,
        });
        if (!configService.state.defaultByCapability?.[cap]) {
          configService.setDefaultConnection(connectionId);
        }
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

  async testConnection(connectionId: ConnectionId | undefined): Promise<void> {
    this.debug('testConnection', { connectionId });
    if (!connectionId) {
      return;
    }
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
    this.fetchModelsError = undefined;
    try {
      this._availableModels = await fetchModelsFromProvider({
        config,
        apiKey,
        timeoutMs: TEST_TIMEOUT_MS,
      });
    } catch (error) {
      this.fetchModelsError = error instanceof Error ? error.message : String(error);
      this.error('fetchModels:failed', error);
    } finally {
      this.isFetchingModels = false;
    }
  }

  toggleApiKeyVisibility(): void {
    this.draft = { ...this.draft, showApiKey: !this.draft.showApiKey };
  }

  // ── Key conflict resolution ──

  resolveKeyConflict(update: boolean): void {
    if (!this.keyConflictPrompt) {
      return;
    }
    if (update) {
      const provider = this._findProviderByRegistry(this.draft.registryId);
      if (provider) {
        configService.updateProvider(provider.id, { credential: this.keyConflictPrompt.newKey });
        this.draft = { ...this.draft, apiKey: this.keyConflictPrompt.newKey };
        void configService.save();
      }
    } else {
      this.keyConflictPrompt = {
        ...this.keyConflictPrompt,
        resolveSeparate: true,
      };
      this.saveDraft();
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
    this._genParamsDraft = {};
    this.isGenParamsOpen = false;
  }

  private _activeVoiceConnection(): AiConnection | undefined {
    const id = this.activeVoiceConnectionId;
    return id ? configService.getAiConnection(id) : undefined;
  }

  private _updateActiveVoiceParams(patch: Partial<VoiceParams>): void {
    const conn = this._activeVoiceConnection();
    if (!conn) {
      return;
    }
    configService.updateAiConnection(conn.id, {
      params: { ...(conn.params as VoiceParams), ...patch } as VoiceParams,
    });
  }

  private _hasCloudVoiceConnection(): boolean {
    return this.voiceConnections.some((c) => {
      const provider = configService.getProvider(c.providerId);
      return provider ? !LOCAL_PROVIDER_IDS.has(provider.registryId) : false;
    });
  }

  private _voicePreviewLine(): string {
    const campaign = campaignService.activeCampaign;
    return campaign ? `Welcome back to ${campaign.name}.` : VOICE_PREVIEW_FALLBACK_LINE;
  }

  private _updateImageParams(connectionId: ConnectionId, patch: Partial<ImageParams>): void {
    const conn = configService.getAiConnection(connectionId);
    if (!conn || conn.capability !== 'image') {
      return;
    }
    configService.updateAiConnection(connectionId, {
      params: { ...this.imageParamsFor(connectionId), ...patch },
    });
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
      return DEFAULT_IMAGE_PARAMS;
    }
    return {
      temperature: 0.7, topP: 1, topK: 40,
      repetitionPenalty: 1, presencePenalty: 0,
      maxTokens: 2048, contextSize: 4096,
    } as TextParams;
  }
}

/** Creates an instrumented AI settings ViewModel for production consumers. */
export const getAiSettingsViewModel = (
  options: AiSettingsViewModelOptions,
): AiSettingsViewModelInterface => AiSettingsViewModel.create(options);
