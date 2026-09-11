// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.svelte.ts
//
// ViewModel for the AI Settings section. Replaces the old Connections section
// (C-465) with a status board, provider tree, roles drawer, voice/image
// panels, and generation-parameter disclosure.

import { type GenParamPreset, providerNeedsKey } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type {
  AiConnection,
  AiProvider,
  AiRole,
  ImageParams,
  TextParams,
  VoiceArchetype,
  VoiceParams,
} from '@aikami/types';
import { fuzzyMatch } from '$lib/utils/fuzzy_match';
import type {
  CampaignServiceInterface,
  ConfigServiceInterface,
  FetchedModel,
  fetchModelsFromProvider,
  fetchWithCredentialPolicy,
  hasVerificationStrategy,
  ImageGenerationServiceInterface,
  PROVIDER_MODEL_FETCH,
  resolveChatTestRequest,
  StyleProfileServiceInterface,
  TtsServiceInterface,
  VoiceModelServiceInterface,
  verifyConnection,
} from '$services';
import type {
  ConnectionCapability,
  ConnectionId,
  ConnectionTestResult,
  TtsStatus,
  VoiceModelState,
} from '$types';
import {
  type AiConnectionStatus,
  buildCapabilityStatusEntries,
  type CapabilityStatus,
  type CapabilityStatusEntry,
  connectionStatusDescriptor,
} from './ai_connection_status.svelte';
import {
  type CapabilitySetupPrefill,
  defaultParamsForCapability,
  draftSignature,
  type EditorDraft,
  type KeyConflictPrompt,
  modelTestUnavailableError,
  uniqueConnectionLabel,
} from './ai_draft_editor';
import { EditorOperation } from './ai_editor_operations';
import {
  generateImagePreview,
  IMAGE_QUALITY_LEVELS,
  IMAGE_SIZE_PRESETS,
  type ImagePreviewState,
  type ImageQualityLevel,
  type ImageSizePreset,
  imageParamsFor,
  imagePreviewErrorFor,
  imagePreviewUrlFor,
} from './ai_image_section';
import { runDraftModelTest } from './ai_model_testing';
import {
  registryEntryFor,
  registryForCapability,
  registryLabel,
  registryNeedsUrl,
} from './ai_provider_registry';
import { buildProviderTree, type ProviderTreeEntry } from './ai_provider_tree';
import {
  ALL_ROLES,
  buildConnectionsWithRoles,
  type ConnectionWithRoles,
  rolesForCapability,
  unassignedConnections,
} from './ai_roles';
import {
  loadVoiceArchetypes,
  probeKokoroConnection,
  type VoicePreviewState,
  voiceIdInputLabelFor,
  voiceModelProgress,
  voiceModelSizeLabel,
  voicePreviewLine,
} from './ai_voice_section';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { CapabilitySetupPrefill, EditorDraft, KeyConflictPrompt } from './ai_draft_editor';
export type { ImagePreviewState, ImageQualityLevel, ImageSizePreset } from './ai_image_section';
// Pure projections and section types now live with their own modules;
// re-exported here for existing importers of this ViewModel.
export type { ProviderTreeConnection, ProviderTreeEntry } from './ai_provider_tree';
export type { ConnectionWithRoles } from './ai_roles';
export type { VoicePreviewState } from './ai_voice_section';
export { VOICE_PREVIEW_FALLBACK_LINE } from './ai_voice_section';
/**
 * Per-capability connection status for the status board. Both are defined in
 * ./ai_connection_status.svelte (the shared store/projection) and re-exported
 * here for existing importers.
 */
export type { CapabilityStatus, CapabilityStatusEntry };

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
  /** Placeholder label for a new connection — the provider's display name. */
  readonly labelHint: string;
  readonly isEditorOpen: boolean;
  /** Sanitized error from the last failed saveDraft(), or undefined. */
  readonly saveError: string | undefined;
  /** Result of the last draft verification, or undefined when the draft has not been probed. */
  readonly draftTestResult: ConnectionTestResult | undefined;
  /** Whether a draft verification is in flight. */
  readonly isTestingDraft: boolean;
  /** Result of the last model chat-test against the draft (text only). */
  readonly draftModelTestResult: ConnectionTestResult | undefined;
  /** Whether a model chat-test is in flight. */
  readonly isTestingDraftModel: boolean;
  /** Whether a model chat-test can be attempted for the current draft (text only). */
  readonly canTestModel: boolean;
  /**
   * Whether the last save attempt was refused because the draft failed
   * verification. The editor stays open offering "Save anyway".
   */
  readonly isSaveBlocked: boolean;
  /** Whether this draft's provider has a verification strategy at all. */
  readonly canVerifyDraft: boolean;
  /** Text currently displayed in the model search/input field. */
  readonly modelQuery: string;
  readonly modelOptions: readonly FetchedModel[];
  /** Whether any models have been fetched (regardless of the current search filter). */
  readonly hasFetchedModels: boolean;
  /** Whether the model search results dropdown is open. */
  readonly isModelDropdownOpen: boolean;
  readonly isFetchingModels: boolean;
  readonly fetchModelsError: string | undefined;
  readonly canFetchModels: boolean;
  readonly needsApiKey: boolean;
  readonly needsUrl: boolean;
  readonly isLocalProvider: boolean;
  /** Whether the selected provider is a bundled local binary (Kokoro) rather than a server endpoint. */
  readonly isLocalBinaryProvider: boolean;
  readonly providerOptions: ReadonlyArray<{ id: string; label: string; description: string }>;

  // ── Key conflict prompt ──
  readonly keyConflictPrompt: KeyConflictPrompt | undefined;

  // ── Roles drawer ──
  readonly isRolesDrawerOpen: boolean;
  readonly connectionsWithRoles: readonly ConnectionWithRoles[];
  readonly availableRoles: readonly AiRole[];
  readonly unassignedConnections: readonly AiConnection[];
  /** Connections of one capability, for the scoped capability detail pages. */
  connectionsForCapability(capability: ConnectionCapability): readonly AiConnection[];
  /** Roles that a given capability can be assigned to. */
  rolesForCapability(capability: ConnectionCapability): readonly AiRole[];
  /** The connection currently serving a role, or undefined when unassigned. */
  connectionIdForRole(role: AiRole): ConnectionId | undefined;

  // ── Testing ──
  readonly testResults: Record<string, ConnectionTestResult>;
  readonly testingIds: ReadonlySet<string>;
  /** Resolves the current verification status for one connection. */
  connectionStatusFor(connectionId: ConnectionId): {
    label: string;
    colorClass: string;
    dot: string;
  };

  // ── Actions ──
  /** Opens the setup flow appropriate for a capability. */
  openCapabilitySetup(capability: ConnectionCapability, prefill?: CapabilitySetupPrefill): void;
  openAddProvider(capability?: ConnectionCapability, prefill?: CapabilitySetupPrefill): void;
  closeAddProvider(): void;
  openEditConnection(connectionId: ConnectionId): void;
  cancelEdit(): void;
  setDraftField(field: string, value: unknown): void;
  setDraftProvider(registryId: string): void;
  /** Updates the model search query and opens the results dropdown. */
  setModelQuery(value: string): void;
  /** Picks a model from the dropdown and closes it. */
  selectModel(modelId: string): void;
  /** Closes the model search results dropdown (e.g. on Enter or Escape). */
  closeModelDropdown(): void;
  /**
   * Verifies the draft, then persists it as a connection/provider. A failed
   * probe refuses the write and sets {@link isSaveBlocked} — the editor stays
   * open so the user can fix the credential or force the save.
   */
  saveDraft(): Promise<void>;
  /** Persists the draft without re-verifying — the escape hatch for offline or unsupported endpoints. */
  saveDraftAnyway(): Promise<void>;
  deleteConnection(connectionId: ConnectionId): void;
  testConnection(connectionId: ConnectionId | undefined): Promise<void>;
  testDraftConnection(): Promise<void>;
  /** Sends a short "hi" chat completion to the selected model without saving. */
  testDraftModel(): Promise<void>;
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
  /**
   * Speaks a sample line with the currently selected voice — the Test
   * Voice action for the local Kokoro setup modal, which has no archetype
   * list of its own.
   */
  testVoice(): Promise<void>;
  /** Stops an in-progress voice preview (playback and/or in-flight synthesis). */
  stopVoicePreview(): void;
  readonly voiceModelState: VoiceModelState;
  readonly voiceModelProgress: number;
  readonly voiceModelSizeLabel: string;
  downloadVoiceModel(): Promise<void>;
  cancelVoiceModelDownload(): void;
  /**
   * Runtime status of the TTS engine (distinct from {@link voiceModelState},
   * which only reports whether bytes are cached on disk). `ready` is the
   * only status where Test Voice can actually produce audio.
   */
  readonly voiceRuntimeStatus: TtsStatus;
  /** Sanitized runtime error, when {@link voiceRuntimeStatus} is 'error'. */
  readonly voiceRuntimeError: string | null;
  /** Re-initializes the TTS runtime after a failed init, without re-downloading the model. */
  retryVoiceRuntime(): Promise<void>;

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
// Capabilities
// ---------------------------------------------------------------------------

/** The configuration surface the AI settings editor reads and mutates. */
export type AiSettingsConfigCapabilities = Pick<
  ConfigServiceInterface,
  | 'state'
  | 'load'
  | 'save'
  | 'getProviders'
  | 'getAiConnections'
  | 'getAiConnection'
  | 'getProvider'
  | 'getRoleAssignments'
  | 'getPresets'
  | 'addProvider'
  | 'updateProvider'
  | 'addAiConnection'
  | 'updateAiConnection'
  | 'deleteAiConnection'
  | 'setDefaultConnection'
  | 'setRoleAssignment'
  | 'clearRoleAssignment'
>;

/** The active-campaign lookup the voice preview line reads. */
export type AiSettingsCampaignCapabilities = Pick<CampaignServiceInterface, 'activeCampaign'>;

/** The image-engine surface the image section drives. */
export type AiSettingsImageCapabilities = Pick<
  ImageGenerationServiceInterface,
  'checkpoints' | 'loadCheckpoints' | 'generateImage'
>;

/** The style-profile surface the image section reads and mutates. */
export type AiSettingsStyleProfileCapabilities = Pick<
  StyleProfileServiceInterface,
  'profiles' | 'activeProfileId' | 'activeProfile' | 'setActiveProfile'
>;

/** The TTS runtime surface the voice section drives. */
export type AiSettingsTtsCapabilities = Pick<
  TtsServiceInterface,
  | 'status'
  | 'errorMessage'
  | 'isPlaying'
  | 'isSynthesizing'
  | 'speak'
  | 'stop'
  | 'reset'
  | 'initialize'
>;

/** The voice-model download surface the voice section drives. */
export type AiSettingsVoiceModelCapabilities = Pick<
  VoiceModelServiceInterface,
  'state' | 'totalBytes' | 'download' | 'cancel' | 'checkStatus'
>;

/** The provider registry/model probe helpers the editor drives. */
export type AiSettingsAiCapabilities = {
  providerModelFetch: typeof PROVIDER_MODEL_FETCH;
  fetchModelsFromProvider: typeof fetchModelsFromProvider;
  fetchWithCredentialPolicy: typeof fetchWithCredentialPolicy;
  hasVerificationStrategy: typeof hasVerificationStrategy;
  resolveChatTestRequest: typeof resolveChatTestRequest;
  verifyConnection: typeof verifyConnection;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AiSettingsViewModelOptions = BaseViewModelOptions & {
  showAdvancedSections?: boolean;
  /**
   * Scopes initialize()'s side effects to one capability (e.g. a capability
   * detail page for Story & Dialogue). Undefined means the full AI Settings
   * page, which needs every section's data. Mounting a text- or
   * voice-only detail page must not trigger image checkpoint loading.
   */
  capability?: ConnectionCapability;
  config: AiSettingsConfigCapabilities;
  campaign: AiSettingsCampaignCapabilities;
  image: AiSettingsImageCapabilities;
  styleProfiles: AiSettingsStyleProfileCapabilities;
  tts: AiSettingsTtsCapabilities;
  voiceModel: AiSettingsVoiceModelCapabilities;
  ai: AiSettingsAiCapabilities;
  /** Session-scoped connection-test store shared across this settings session. */
  status: AiConnectionStatus;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 15_000;
// Status derivation/color/dot live in ./ai_connection_status.svelte and are
// shared with the lightweight header badge.

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Production implementation shared with the dev-only fixture subclass. */
export class AiSettingsViewModel
  extends BaseViewModel<AiSettingsViewModelOptions>
  implements AiSettingsViewModelInterface
{
  private _availableModels: FetchedModel[] = $state([]);
  private _modelQuery = $state('');
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
  isModelDropdownOpen = $state(false);
  fetchModelsError = $state<string | undefined>(undefined);
  get testResults(): Record<string, ConnectionTestResult> {
    return this._status.testResults;
  }
  get testingIds(): ReadonlySet<string> {
    return this._status.testingIds;
  }
  keyConflictPrompt: KeyConflictPrompt | undefined = $state(undefined);
  /** Sanitized error from the last failed preview/test, or undefined. {@link voicePreviewState} derives from this plus the live ttsService state — never set directly. */
  private _voicePreviewError: string | undefined = $state(undefined);
  /** Identifies the preview whose outcome may still update state; stopping bumps it. */
  private _voicePreviewGeneration = 0;
  isGenParamsOpen = $state(false);
  saveError: string | undefined = $state(undefined);
  draftTestResult: ConnectionTestResult | undefined = $state(undefined);
  isTestingDraft = $state(false);
  draftModelTestResult: ConnectionTestResult | undefined = $state(undefined);
  isTestingDraftModel = $state(false);
  isSaveBlocked = $state(false);
  private readonly _draftVerification = new EditorOperation();
  /** The draft signature {@link draftTestResult} was measured against. */
  private _testedDraftSignature: string | undefined = $state(undefined);
  /** Owns model discovery for the current provider. */
  private readonly _modelDiscovery = new EditorOperation();
  /** Owns the model chat-test for the current draft/model. */
  private readonly _draftModelTest = new EditorOperation();
  private _editorRevision = 0;
  private _isSaving = false;
  readonly showAdvancedSections: boolean;
  private readonly _scopedCapability: ConnectionCapability | undefined;
  private readonly _config: AiSettingsConfigCapabilities;
  private readonly _campaign: AiSettingsCampaignCapabilities;
  private readonly _image: AiSettingsImageCapabilities;
  private readonly _styleProfiles: AiSettingsStyleProfileCapabilities;
  private readonly _tts: AiSettingsTtsCapabilities;
  private readonly _voiceModel: AiSettingsVoiceModelCapabilities;
  private readonly _ai: AiSettingsAiCapabilities;
  private readonly _status: AiConnectionStatus;

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
    this._scopedCapability = options.capability;
    this._config = options.config;
    this._campaign = options.campaign;
    this._image = options.image;
    this._styleProfiles = options.styleProfiles;
    this._tts = options.tts;
    this._voiceModel = options.voiceModel;
    this._ai = options.ai;
    this._status = options.status;
  }

  // ── Derived: status board ──

  get statusEntries(): readonly CapabilityStatusEntry[] {
    return buildCapabilityStatusEntries({
      connections: this._config.getAiConnections(),
      providers: this._config.getProviders(),
      defaultByCapability: this._config.state.defaultByCapability,
      testResults: this.testResults,
      testingIds: this.testingIds,
    });
  }

  // ── Derived: provider tree ──

  get providerTree(): readonly ProviderTreeEntry[] {
    return buildProviderTree({
      providers: this._config.getProviders(),
      connections: this._config.getAiConnections(),
      testResults: this.testResults,
      testingIds: this.testingIds,
    });
  }

  // ── Derived: roles ──

  get connectionsWithRoles(): readonly ConnectionWithRoles[] {
    return buildConnectionsWithRoles(
      this._config.getAiConnections(),
      this._config.getRoleAssignments(),
    );
  }

  get availableRoles(): readonly AiRole[] {
    return ALL_ROLES;
  }

  get unassignedConnections(): readonly AiConnection[] {
    return unassignedConnections(
      this._config.getAiConnections(),
      this._config.getRoleAssignments(),
    );
  }

  connectionsForCapability(capability: ConnectionCapability): readonly AiConnection[] {
    return this._connectionsForCapability(capability);
  }

  rolesForCapability(capability: ConnectionCapability): readonly AiRole[] {
    return rolesForCapability(capability);
  }

  connectionIdForRole(role: AiRole): ConnectionId | undefined {
    return this._config.getRoleAssignments()[role];
  }

  // ── Derived: editor state ──

  get providerOptions(): ReadonlyArray<{ id: string; label: string; description: string }> {
    return registryForCapability(this.draft.capability).map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
    }));
  }

  get labelHint(): string {
    return registryLabel(this.draft.registryId) ?? this.draft.registryId;
  }

  get modelOptions(): readonly FetchedModel[] {
    if (!this.isModelDropdownOpen) {
      return [];
    }
    const query = this._modelQuery.trim();
    if (!query) {
      return this._availableModels;
    }
    return this._availableModels.filter(
      (m) => fuzzyMatch(query, m.id) || fuzzyMatch(query, m.name),
    );
  }

  get hasFetchedModels(): boolean {
    return this._availableModels.length > 0;
  }

  get modelQuery(): string {
    return this._modelQuery;
  }

  get canFetchModels(): boolean {
    return this.draft.registryId in this._ai.providerModelFetch;
  }

  get needsApiKey(): boolean {
    const regEntry = registryEntryFor(this.draft.capability, this.draft.registryId);
    if (!regEntry) {
      return true;
    }
    return !regEntry.isLocal && regEntry.needsKey;
  }

  get needsUrl(): boolean {
    return registryNeedsUrl(this.draft.capability, this.draft.registryId);
  }

  get isLocalProvider(): boolean {
    return registryEntryFor(this.draft.capability, this.draft.registryId)?.isLocal ?? false;
  }

  get isLocalBinaryProvider(): boolean {
    return this.draft.capability === 'voice' && this.draft.registryId === 'kokoro';
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
    const narratorConn = this._config.getAiConnections().find((c) => {
      const roles = this._config.getRoleAssignments();
      return roles['narrator-voice'] === c.id;
    });
    if (narratorConn) {
      this._config.updateAiConnection(narratorConn.id, {
        params: {
          ...(narratorConn.params as VoiceParams),
          archetypes: this._voiceArchetypes,
        } as VoiceParams,
      });
    }
  }

  voiceIdInputLabelFor(archetypeLabel: string): string {
    return voiceIdInputLabelFor(archetypeLabel);
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
    void this._config.save();
  }

  /**
   * Derives preview/test state from the live ttsService signals instead of
   * a value set-and-forget at call time — {@link TtsServiceInterface.speak}
   * resolves once synthesis is scheduled, not once playback actually ends,
   * so "playing" must track {@link TtsServiceInterface.isPlaying} directly
   * or the UI reports success while audio is still (or never) playing.
   */
  get voicePreviewState(): VoicePreviewState {
    if (this._voicePreviewError) {
      return { status: 'error', error: this._voicePreviewError };
    }
    if (this._tts.isSynthesizing) {
      return { status: 'synthesizing' };
    }
    if (this._tts.isPlaying) {
      return { status: 'playing' };
    }
    return { status: 'idle' };
  }

  async previewVoiceArchetype(archetypeId: string): Promise<void> {
    this.debug('previewVoiceArchetype', { archetypeId });
    const archetype = this._voiceArchetypes.find((a) => a.id === archetypeId);
    if (!archetype) {
      return;
    }
    await this._speakPreviewLine({ voiceId: archetype.voiceId });
  }

  async testVoice(): Promise<void> {
    this.debug('testVoice');
    await this._speakPreviewLine({});
  }

  private async _speakPreviewLine(options: { voiceId?: string }): Promise<void> {
    const generation = ++this._voicePreviewGeneration;
    this._voicePreviewError = undefined;
    try {
      await this._tts.speak({ text: this._voicePreviewLine(), voiceId: options.voiceId });
    } catch (error) {
      // stop() rejects the in-flight speak(). That rejection is the user
      // cancelling, not a synthesis failure, so only a preview that is still
      // the current one may report an error.
      if (generation !== this._voicePreviewGeneration) {
        this.debug('voicePreview:cancelled');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._voicePreviewError = message;
      this.error('voicePreview:failed', error);
    }
  }

  get voiceModelState(): VoiceModelState {
    return this._voiceModel.state;
  }

  get voiceModelProgress(): number {
    return voiceModelProgress(this._voiceModel.state);
  }

  get voiceModelSizeLabel(): string {
    return voiceModelSizeLabel(this._voiceModel.totalBytes);
  }

  get voiceRuntimeStatus(): TtsStatus {
    return this._tts.status;
  }

  get voiceRuntimeError(): string | null {
    return this._tts.errorMessage;
  }

  async retryVoiceRuntime(): Promise<void> {
    this.debug('retryVoiceRuntime');
    this._tts.reset();
    await this._tts.initialize();
  }

  async downloadVoiceModel(): Promise<void> {
    this.debug('downloadVoiceModel');
    try {
      const result = await this._voiceModel.download();
      if (result.status !== 'ready') {
        return;
      }
      // Downloaded bytes alone are not "speech ready" — bring the runtime
      // up so Test Voice actually works right after download, instead of
      // reporting success on cached bytes the worker hasn't loaded yet.
      await this.retryVoiceRuntime();
    } catch (error) {
      this.warn('downloadVoiceModel:failed', error);
    }
  }

  stopVoicePreview(): void {
    // Invalidate before stopping: this._tts.stop() rejects the pending
    // speak(), and that rejection must not land as an error state.
    this._voicePreviewGeneration += 1;
    this._tts.stop();
    this._voicePreviewError = undefined;
  }

  cancelVoiceModelDownload(): void {
    this._voiceModel.cancel();
  }

  /**
   * Brings the TTS runtime up when the Kokoro model is already downloaded and
   * the editor opens on it — downloading alone leaves cached bytes the worker
   * has not loaded yet. Re-checks the cache first so a refresh doesn't show
   * a cached model as not-downloaded.
   */
  private async _ensureVoiceRuntimeIfReady(): Promise<void> {
    if (!this.isLocalBinaryProvider) {
      return;
    }
    try {
      await this._voiceModel.checkStatus();
    } catch (error) {
      this.warn('_ensureVoiceRuntimeIfReady:check-failed', error);
      return;
    }
    if (this.voiceModelState.status === 'ready' && this._tts.status === 'uninitialized') {
      void this._tts.initialize().catch((error: unknown) => {
        this.warn('_ensureVoiceRuntimeIfReady:failed', error);
      });
    }
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
    return imageParamsFor(this._config.getAiConnection(connectionId));
  }

  setImageParamField(connectionId: ConnectionId, field: 'steps' | 'cfg', value: number): void {
    this._updateImageParams(connectionId, { [field]: value });
  }

  get imageCheckpoints(): readonly string[] {
    return this._image.checkpoints.map((c) => c.id);
  }

  setImageCheckpoint(connectionId: ConnectionId, checkpoint: string): void {
    this._updateImageParams(connectionId, { checkpoint });
    this.commitConfigChanges();
  }

  get imageStyleProfiles(): ReadonlyArray<{ id: string; label: string }> {
    return this._styleProfiles.profiles.map((p) => ({ id: p.id, label: p.name }));
  }

  get activeStyleProfileId(): string {
    return this._styleProfiles.activeProfileId;
  }

  setImageStyleProfile(profileId: string): void {
    this._styleProfiles.setActiveProfile(profileId);
  }

  imagePreviewStateFor(connectionId: ConnectionId): ImagePreviewState {
    return this._imagePreviewStates[connectionId] ?? { status: 'idle' };
  }

  imagePreviewUrlFor(connectionId: ConnectionId): string {
    return imagePreviewUrlFor(this.imagePreviewStateFor(connectionId));
  }

  imagePreviewErrorFor(connectionId: ConnectionId): string {
    return imagePreviewErrorFor(this.imagePreviewStateFor(connectionId));
  }

  async previewImage(connectionId: ConnectionId): Promise<void> {
    this.debug('previewImage', { connectionId });
    const conn = this._config.getAiConnection(connectionId);
    if (conn?.capability !== 'image') {
      return;
    }
    this._imagePreviewStates = {
      ...this._imagePreviewStates,
      [connectionId]: { status: 'generating' },
    };
    const state = await generateImagePreview({
      params: this.imageParamsFor(connectionId),
      positiveTags: this._styleProfiles.activeProfile?.positiveTags ?? '',
      generateImage: this._image.generateImage,
    });
    this._imagePreviewStates = { ...this._imagePreviewStates, [connectionId]: state };
    if (state.status === 'error') {
      this.error('previewImage:failed', state.error);
    }
  }

  // ── Generation-parameter disclosure (AC-8) ──

  toggleGenParamsDisclosure(): void {
    this.isGenParamsOpen = !this.isGenParamsOpen;
  }

  get genParamsDisplay(): TextParams | undefined {
    if (this.draft.capability !== 'text') {
      return undefined;
    }
    // A new connection has no persisted row to read from, so the disclosure
    // shows the same defaults saveDraft() would write. Waiting for a save
    // before the fields become editable was a display bug, not a constraint:
    // the create path already merges _genParamsDraft over _defaultParams().
    const conn = this.draft.editingConnectionId
      ? this._config.getAiConnection(this.draft.editingConnectionId)
      : undefined;
    const base =
      conn?.capability === 'text'
        ? (conn.params as TextParams)
        : (defaultParamsForCapability('text') as TextParams);
    return { ...base, ...this._genParamsDraft };
  }

  setGenParamField(field: keyof TextParams, value: number): void {
    this._genParamsDraft = { ...this._genParamsDraft, [field]: value };
  }

  get genParamPresets(): readonly GenParamPreset[] {
    return this._config.getPresets();
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
    await this._config.load();
    // A text- or voice-only capability detail page has no use for the
    // image checkpoint list — loading it there is a pointless model
    // enumeration call on mount for a page that never renders it.
    if (!this._scopedCapability || this._scopedCapability === 'image') {
      await this._image.loadCheckpoints();
    }
    if (!this._scopedCapability || this._scopedCapability === 'voice') {
      this._loadVoiceArchetypes();
    }
    await super.initialize();
  }

  /** Invalidates VM-owned editor work so a late response cannot write to a disposed editor. */
  override async dispose(): Promise<void> {
    this._editorRevision += 1;
    this._voicePreviewGeneration += 1;
    this._invalidateModelDiscovery();
    this._invalidateDraftTest();
    this._invalidateDraftModelTest();
    await super.dispose();
  }

  // ── Editor: open / close / save ──

  openCapabilitySetup(capability: ConnectionCapability, prefill?: CapabilitySetupPrefill): void {
    this.openAddProvider(capability, prefill);
  }

  openAddProvider(capability?: ConnectionCapability, prefill?: CapabilitySetupPrefill): void {
    this.debug('openAddProvider', { capability, prefill });
    this.isAddProviderOpen = true;
    this.isEditorOpen = true;
    this._resetDraft(capability, prefill);
    void this._ensureVoiceRuntimeIfReady();
  }

  closeAddProvider(): void {
    this.isAddProviderOpen = false;
    this.cancelEdit();
  }

  openEditConnection(connectionId: ConnectionId): void {
    this.debug('openEditConnection', { connectionId });
    const conn = this._config.getAiConnection(connectionId);
    if (!conn) {
      return;
    }
    const provider = this._config.getProvider(conn.providerId);
    this.draft = {
      providerId: conn.providerId,
      registryId: provider?.registryId ?? 'openrouter',
      capability: conn.capability,
      label: conn.label,
      model: conn.model,
      apiKey: provider?.credential ?? '',
      baseUrl: provider?.baseUrl ?? '',
      showApiKey: false,
      isEditing: true,
      editingConnectionId: connectionId,
    };
    this._editorRevision += 1;
    this._invalidateModelDiscovery();
    this._modelQuery = conn.model;
    this._genParamsDraft = {};
    this.isGenParamsOpen = false;
    this._invalidateDraftTest();
    this._invalidateDraftModelTest();
    this.isEditorOpen = true;
  }

  cancelEdit(): void {
    this.isEditorOpen = false;
    this.isAddProviderOpen = false;
    this.saveError = undefined;
    this._resetDraft();
  }

  setDraftField(field: string, value: unknown): void {
    this.draft = { ...this.draft, [field]: value };
    if (field === 'apiKey' || field === 'baseUrl') {
      this._invalidateDraftTest();
    }
    if (field === 'apiKey' || field === 'baseUrl' || field === 'model') {
      this._invalidateDraftModelTest();
    }
  }

  setModelQuery(value: string): void {
    this._modelQuery = value;
    // The model field is a real input, not only a search box. A typed model
    // ID must land in the draft even when model discovery is available —
    // otherwise the user's edit is silently discarded on save.
    this.draft = { ...this.draft, model: value };
    this._invalidateDraftModelTest();
    this.isModelDropdownOpen = true;
  }

  selectModel(modelId: string): void {
    this.draft = { ...this.draft, model: modelId };
    this._modelQuery = modelId;
    this.isModelDropdownOpen = false;
    this._invalidateDraftModelTest();
  }

  closeModelDropdown(): void {
    this.isModelDropdownOpen = false;
  }

  setDraftProvider(registryId: string): void {
    this.debug('setDraftProvider', { registryId });
    this._invalidateDraftTest();
    this._invalidateDraftModelTest();
    this._invalidateModelDiscovery();
    this._availableModels = [];
    this._modelQuery = '';
    this.isModelDropdownOpen = false;
    this.fetchModelsError = undefined;

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
      model: '',
      apiKey: prefillKey,
      baseUrl: existingProvider?.baseUrl ?? '',
    };

    void this._ensureVoiceRuntimeIfReady();

    if (conflictProvider) {
      this.keyConflictPrompt = {
        newKey: oldApiKey,
        providerLabel: registryLabel(registryId) ?? registryId,
        sharedConnectionCount: this._connectionsForProvider(conflictProvider.id).length,
        resolveUpdate: false,
        resolveSeparate: false,
      };
    }
  }

  async saveDraft(): Promise<void> {
    this.debug('saveDraft');
    if (this._isSaving) {
      return;
    }
    this._isSaving = true;
    try {
      const conflictPrompt = this.keyConflictPrompt;
      const revision = this._editorRevision;
      const draft = this.draft;
      const signature = draftSignature(draft);

      // A credential that has never been probed is not evidence of a working
      // connection. Verify first so a typo'd key is caught here rather than
      // surfacing as a broken game several screens later.
      if (this.canVerifyDraft) {
        if (this._testedDraftSignature !== signature) {
          await this.testDraftConnection();
        }
        // A save awaiting the probe must revalidate its session and draft:
        // cancel, disposal, or an edited/replaced draft must not be written.
        if (revision !== this._editorRevision || this.draft !== draft || !this.isEditorOpen) {
          this.debug('saveDraft:abandoned');
          return;
        }
        if (this.draftTestResult && !this.draftTestResult.ok) {
          this.isSaveBlocked = true;
          this.debug('saveDraft:blocked', { error: this.draftTestResult.error });
          return;
        }
      }

      await this._commitDraft(conflictPrompt);
    } finally {
      this._isSaving = false;
    }
  }

  async saveDraftAnyway(): Promise<void> {
    this.debug('saveDraftAnyway');
    if (this._isSaving) {
      return;
    }
    this._isSaving = true;
    try {
      await this._commitDraft();
    } finally {
      this._isSaving = false;
    }
  }

  /** Writes the draft to the configuration. Assumes the verification gate has already run. */
  private async _commitDraft(
    conflictPrompt: KeyConflictPrompt | undefined = this.keyConflictPrompt,
  ): Promise<void> {
    this.saveError = undefined;

    const reg = this.draft.registryId;
    const cap = this.draft.capability;
    const requestedLabel = this.draft.label?.trim() || registryLabel(reg) || reg;
    const label = this.draft.isEditing
      ? requestedLabel
      : uniqueConnectionLabel(
          requestedLabel,
          this._connectionsForCapability(cap).map((connection) => connection.label?.trim()),
        );
    const model = this.draft.model;
    let savedConnectionId: ConnectionId | undefined;

    if (this.draft.isEditing && this.draft.editingConnectionId) {
      savedConnectionId = this.draft.editingConnectionId;
      // Update existing connection
      const conn = this._config.getAiConnection(this.draft.editingConnectionId);
      if (!conn) {
        return;
      }

      // Resolve the provider this connection should point at after the edit.
      // Switching the provider dropdown must actually repoint the connection
      // (reusing the matching account when one exists) — never leave the saved
      // row on the old provider while the editor shows the new one.
      const currentProvider = this._config.getProvider(conn.providerId);
      const registryChanged = this.draft.registryId !== currentProvider?.registryId;
      let targetProviderId = conn.providerId;
      let targetProvider = currentProvider;

      if (registryChanged) {
        targetProvider = this._findProviderByRegistry(this.draft.registryId);
        if (targetProvider) {
          targetProviderId = targetProvider.id;
        } else {
          targetProviderId = this._config.addProvider({
            registryId: this.draft.registryId,
            label: registryLabel(this.draft.registryId) ?? this.draft.registryId,
            credential: this.draft.apiKey || undefined,
            baseUrl: this.draft.baseUrl?.trim() || undefined,
            source: 'stored',
          });
          targetProvider = this._config.getProvider(targetProviderId);
        }
      }

      // Endpoint and credential live on the provider account, so an edit to
      // the Server URL must be written there too — and it invalidates results
      // measured against the previous account.
      if (targetProvider) {
        const providerPatch: Partial<Omit<AiProvider, 'id'>> = {};
        const nextBaseUrl = this.draft.baseUrl?.trim() || undefined;
        if (nextBaseUrl !== targetProvider.baseUrl) {
          providerPatch.baseUrl = nextBaseUrl;
        }
        if (this.draft.apiKey && this.draft.apiKey !== targetProvider.credential) {
          providerPatch.credential = this.draft.apiKey;
        }
        if (Object.keys(providerPatch).length > 0) {
          this._config.updateProvider(targetProvider.id, providerPatch);
          // P03 AC-4: the account is shared by every connection on this
          // provider, so a rotation invalidates the sibling rows' results too.
          this._clearTestResultsForProvider(targetProvider.id);
        }
      }

      const patch: Partial<Omit<AiConnection, 'id' | 'createdAt'>> = { label, model };
      if (targetProviderId !== conn.providerId) {
        patch.providerId = targetProviderId;
      }
      // AC-8: params are included in the patch ONLY when the Advanced
      // disclosure was actually edited — opening it alone must never write
      // a default value into a connection that never had one.
      if (conn.capability === 'text' && Object.keys(this._genParamsDraft).length > 0) {
        patch.params = { ...(conn.params as TextParams), ...this._genParamsDraft } as TextParams;
      }
      this._config.updateAiConnection(this.draft.editingConnectionId, patch);
      // Invalidate stale test result on edit (endpoint or credential may have changed)
      this._clearTestResult(this.draft.editingConnectionId);
    } else {
      // Resolve or create provider
      let providerId: string | undefined;
      if (conflictPrompt?.resolveSeparate) {
        providerId = this._config.addProvider({
          registryId: reg,
          label: registryLabel(reg) ?? reg,
          credential: conflictPrompt.newKey,
          baseUrl: this.draft.baseUrl || undefined,
          source: 'stored',
        });
      } else {
        const existingProvider = this.draft.providerId
          ? this._config.getProvider(this.draft.providerId)
          : this._findProviderByRegistry(reg);
        if (existingProvider) {
          providerId = existingProvider.id;
          if (this.draft.apiKey && this.draft.apiKey !== existingProvider.credential) {
            this._config.updateProvider(existingProvider.id, { credential: this.draft.apiKey });
          }
        } else {
          providerId = this._config.addProvider({
            registryId: reg,
            label: registryLabel(reg) ?? reg,
            credential: this.draft.apiKey || undefined,
            baseUrl: this.draft.baseUrl || undefined,
            source: 'stored',
          });
        }
      }

      // Create the new connection
      if (providerId) {
        const defaultParams = defaultParamsForCapability(cap);
        const params =
          cap === 'text' && Object.keys(this._genParamsDraft).length > 0
            ? ({ ...(defaultParams as TextParams), ...this._genParamsDraft } as TextParams)
            : defaultParams;
        const connectionId = this._config.addAiConnection({
          providerId,
          capability: cap,
          label,
          model,
          params: params as TextParams | ImageParams | VoiceParams,
        });
        if (!this._config.state.defaultByCapability?.[cap]) {
          this._config.setDefaultConnection(connectionId);
        }
        savedConnectionId = connectionId;
      }
    }

    // Carry the probe that cleared the save gate onto the saved row, so the
    // status board shows what we just measured instead of "not checked".
    if (savedConnectionId && this.draftTestResult?.ok) {
      this._status.setResult(savedConnectionId, this.draftTestResult);
    }

    try {
      await this._config.save();
    } catch (error) {
      // The connection is already in in-memory config state; only the
      // persist failed. Re-point the draft at the row that was just created
      // so a retry updates it — otherwise the retry takes the create branch
      // again and leaves two connections behind for one save.
      if (savedConnectionId && !this.draft.isEditing) {
        this.draft = {
          ...this.draft,
          isEditing: true,
          editingConnectionId: savedConnectionId,
          providerId: this._config.getAiConnection(savedConnectionId)?.providerId,
        };
      }
      // The draft is preserved so the user can retry — the editor stays
      // open with a sanitized error instead of silently closing over a
      // failed persist.
      this.saveError = 'Failed to save connection. Please try again.';
      this.error('saveDraft:failed', error);
      return;
    }
    this.cancelEdit();
  }

  deleteConnection(connectionId: ConnectionId): void {
    this.debug('deleteConnection', { connectionId });
    this._config.deleteAiConnection(connectionId);
    this._clearTestResult(connectionId);
    void this._config.save();
  }

  // ── Testing ──

  async testConnection(connectionId: ConnectionId | undefined): Promise<void> {
    this.debug('testConnection', { connectionId });
    if (!connectionId) {
      return;
    }
    const conn = this._config.getAiConnection(connectionId);
    if (!conn) {
      return;
    }
    const provider = this._config.getProvider(conn.providerId);
    if (!provider) {
      return;
    }

    // Shared store owns the generation counter — stale responses with a lower
    // generation are discarded, and every AI surface sees the same in-flight
    // and result state.
    const generation = this._status.begin(connectionId);

    try {
      const result =
        provider.registryId === 'kokoro'
          ? await this._probeKokoroConnection()
          : await this._ai.verifyConnection({
              provider,
              baseUrl: provider.baseUrl,
            });

      this._status.storeResult(connectionId, generation, result);
    } catch (err) {
      // Should not happen — verifyConnection catches all errors internally.
      // This is a safety net for unexpected synchronous throws.
      this._status.storeResult(connectionId, generation, {
        ok: false,
        latencyMs: 0,
        error: String(err),
      });
    } finally {
      this._status.finish(connectionId, generation);
    }
  }

  /**
   * Kokoro is a bundled local binary, not an HTTP endpoint — "test connection"
   * means the voice model is downloaded and the TTS runtime can start.
   */
  private async _probeKokoroConnection(): Promise<ConnectionTestResult> {
    return probeKokoroConnection({
      modelState: this.voiceModelState,
      getTtsStatus: () => this._tts.status,
      getRuntimeError: () => this.voiceRuntimeError,
      retryRuntime: () => this.retryVoiceRuntime(),
    });
  }

  /** Resolves the current verification status for one connection. */
  connectionStatusFor(connectionId: ConnectionId): {
    label: string;
    colorClass: string;
    dot: string;
  } {
    return connectionStatusDescriptor({
      connectionId,
      testResults: this.testResults,
      testingIds: this.testingIds,
    });
  }

  get canVerifyDraft(): boolean {
    return this._ai.hasVerificationStrategy(this.draft.registryId);
  }

  get canTestModel(): boolean {
    return this.draft.capability === 'text';
  }

  /**
   * Probes the draft's endpoint without persisting anything. The draft is
   * projected onto a throwaway AiProvider, so an unsaved connection can be
   * verified exactly like a stored one.
   */
  async testDraftConnection(): Promise<void> {
    this.debug('testDraftConnection');
    if (!this.canVerifyDraft) {
      return;
    }

    const signature = draftSignature(this.draft);
    const { generation, signal } = this._draftVerification.begin();
    this.isTestingDraft = true;

    try {
      const result = await this._ai.verifyConnection({
        provider: this._draftAsProvider(),
        baseUrl: this.draft.baseUrl?.trim() || undefined,
        signal,
      });
      if (!this._draftVerification.isCurrent(generation)) {
        return;
      }
      this.draftTestResult = result;
      this._testedDraftSignature = signature;
      if (result.ok) {
        this.isSaveBlocked = false;
      }
    } finally {
      if (this._draftVerification.isCurrent(generation)) {
        this.isTestingDraft = false;
      }
      this._draftVerification.settle(generation);
    }
  }

  /**
   * Sends a single "hi" chat completion to the draft's selected model without
   * persisting anything. Unlike {@link testDraftConnection} — which only proves
   * the endpoint/credential — this proves the model actually answers.
   */
  async testDraftModel(): Promise<void> {
    const reg = this.draft.registryId;
    const model = this.draft.model?.trim();
    if (!model) {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No model selected' };
      return;
    }

    const provider = this._draftAsProvider();
    const apiKey = provider.credential;
    if (providerNeedsKey(reg) && !apiKey) {
      this.draftModelTestResult = { ok: false, latencyMs: 0, error: 'No API key configured' };
      return;
    }

    const request = this._ai.resolveChatTestRequest({
      apiKey,
      baseUrl: this.draft.baseUrl,
      model,
      registryId: reg,
    });

    this.debug('testDraftModel', { reg, hasRequest: !!request, url: request?.url });

    if (!request) {
      this.draftModelTestResult = {
        ok: false,
        latencyMs: 0,
        error: modelTestUnavailableError(reg, this._ai.providerModelFetch),
      };
      return;
    }

    const { generation, signal } = this._draftModelTest.begin();
    this.isTestingDraftModel = true;
    this.draftModelTestResult = undefined;

    try {
      const result = await runDraftModelTest({
        request,
        apiKey,
        approvedOrigins: this._ai.providerModelFetch[reg]?.approvedOrigins,
        signal,
        timeoutMs: TEST_TIMEOUT_MS,
        fetchWithCredentialPolicy: this._ai.fetchWithCredentialPolicy,
      });
      if (this._draftModelTest.isCurrent(generation)) {
        this.draftModelTestResult = result;
      }
    } finally {
      if (this._draftModelTest.isCurrent(generation)) {
        this.isTestingDraftModel = false;
      }
      this._draftModelTest.settle(generation);
    }
  }

  /**
   * Projects the draft onto an AiProvider for verification. The stored
   * credential stands in when the user left the key field untouched while
   * editing an existing connection (the editor never prefills the secret).
   */
  private _draftAsProvider(): AiProvider {
    const existing = this.draft.providerId
      ? this._config.getProvider(this.draft.providerId)
      : this._findProviderByRegistry(this.draft.registryId);
    const credential = this.draft.apiKey?.trim() || existing?.credential;
    return {
      id: existing?.id ?? 'draft',
      registryId: this.draft.registryId,
      label: registryLabel(this.draft.registryId) ?? this.draft.registryId,
      credential,
      baseUrl: this.draft.baseUrl?.trim() || existing?.baseUrl,
      source: existing?.source ?? 'stored',
    };
  }

  /** Drops a verification result the user has typed past, and any block it caused. */
  private _invalidateDraftTest(): void {
    this._draftVerification.invalidate();
    this.isTestingDraft = false;
    this.draftTestResult = undefined;
    this._testedDraftSignature = undefined;
    this.isSaveBlocked = false;
  }

  /** Drops a model chat-test result the user has edited past. */
  private _invalidateDraftModelTest(): void {
    this._draftModelTest.invalidate();
    this.isTestingDraftModel = false;
    this.draftModelTestResult = undefined;
  }

  /** Drops a model discovery that no longer belongs to the current provider. */
  private _invalidateModelDiscovery(): void {
    this._modelDiscovery.invalidate();
    this.isFetchingModels = false;
  }

  async fetchModels(): Promise<void> {
    this.debug('fetchModels');
    const reg = this.draft.registryId;
    const config = this._ai.providerModelFetch[reg];
    if (!config) {
      return;
    }

    const existing = this._findProviderByRegistry(reg);
    const apiKey = existing?.credential ?? this.draft.apiKey;
    const { generation } = this._modelDiscovery.begin();
    this.isFetchingModels = true;
    this.fetchModelsError = undefined;
    try {
      const models = await this._ai.fetchModelsFromProvider({
        config,
        apiKey,
        baseUrl: this.draft.baseUrl,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (!this._modelDiscovery.isCurrent(generation) || this.draft.registryId !== reg) {
        return;
      }
      this._availableModels = models;
      this.isModelDropdownOpen = true;
    } catch (error) {
      if (!this._modelDiscovery.isCurrent(generation)) {
        return;
      }
      this.fetchModelsError = error instanceof Error ? error.message : String(error);
      this.error('fetchModels:failed', error);
    } finally {
      if (this._modelDiscovery.isCurrent(generation)) {
        this.isFetchingModels = false;
      }
      this._modelDiscovery.settle(generation);
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
        this._config.updateProvider(provider.id, { credential: this.keyConflictPrompt.newKey });
        // Same invalidation as the saveDraft rotation path: this account's
        // stored results were measured against the replaced key.
        this._clearTestResultsForProvider(provider.id);
        this.draft = { ...this.draft, apiKey: this.keyConflictPrompt.newKey };
        void this._config.save();
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
    this._config.setRoleAssignment(role, connectionId);
    void this._config.save();
  }

  clearRole(role: AiRole): void {
    this.debug('clearRole', { role });
    this._config.clearRoleAssignment(role);
    void this._config.save();
  }

  // ── Private helpers ──

  private _loadVoiceArchetypes(): void {
    this._voiceArchetypes = loadVoiceArchetypes({
      connections: this._config.getAiConnections(),
      roleAssignments: this._config.getRoleAssignments(),
      legacy: this._config.state.voice.voiceArchetypes,
    });
  }

  private _resetDraft(
    capability: ConnectionCapability = 'text',
    prefill?: CapabilitySetupPrefill,
  ): void {
    const registryId =
      prefill?.registryId ?? registryForCapability(capability)[0]?.id ?? 'openrouter';
    const existingProvider = this._findProviderByRegistry(registryId);
    this.draft = {
      providerId: existingProvider?.id,
      registryId,
      capability,
      label: '',
      model: prefill?.model ?? '',
      apiKey: existingProvider?.credential ?? '',
      baseUrl: prefill?.baseUrl ?? existingProvider?.baseUrl ?? '',
      showApiKey: false,
      isEditing: false,
      editingConnectionId: undefined,
    };
    this._availableModels = [];
    this._modelQuery = '';
    this.isModelDropdownOpen = false;
    this.fetchModelsError = undefined;
    this._genParamsDraft = {};
    this.isGenParamsOpen = false;
    this._editorRevision += 1;
    this._invalidateModelDiscovery();
    this._invalidateDraftTest();
    this._invalidateDraftModelTest();
  }

  private _activeVoiceConnection(): AiConnection | undefined {
    const id = this.activeVoiceConnectionId;
    return id ? this._config.getAiConnection(id) : undefined;
  }

  private _updateActiveVoiceParams(patch: Partial<VoiceParams>): void {
    const conn = this._activeVoiceConnection();
    if (!conn) {
      return;
    }
    this._config.updateAiConnection(conn.id, {
      params: { ...(conn.params as VoiceParams), ...patch } as VoiceParams,
    });
  }

  private _voicePreviewLine(): string {
    return voicePreviewLine(this._campaign.activeCampaign?.name);
  }

  private _updateImageParams(connectionId: ConnectionId, patch: Partial<ImageParams>): void {
    const conn = this._config.getAiConnection(connectionId);
    if (conn?.capability !== 'image') {
      return;
    }
    this._config.updateAiConnection(connectionId, {
      params: { ...this.imageParamsFor(connectionId), ...patch },
    });
  }

  private _findProviderByRegistry(registryId: string): AiProvider | undefined {
    return this._config.getProviders().find((p) => p.registryId === registryId);
  }

  private _connectionsForProvider(providerId: string): AiConnection[] {
    return this._config.getAiConnections().filter((c) => c.providerId === providerId);
  }

  private _connectionsForCapability(cap: ConnectionCapability): AiConnection[] {
    return this._config.getAiConnections().filter((c) => c.capability === cap);
  }

  /**
   * Drops the cached verification results for every connection on one
   * provider. Used when the shared endpoint/credential changes: the stored
   * result describes the old account and must not survive the edit.
   */
  private _clearTestResultsForProvider(providerId: string): void {
    // Delegate per connection rather than filtering `testResults` directly:
    // dropping the stored result is not enough on its own. A probe already in
    // flight against the old credential would still pass its generation check
    // and write a pre-rotation result back. _clearTestResult advances the
    // generation and clears the in-flight marker together.
    for (const connection of this._connectionsForProvider(providerId)) {
      this._clearTestResult(connection.id);
    }
  }

  private _clearTestResult(connectionId: ConnectionId): void {
    // Clears the shared result + in-flight marker and advances the generation
    // so an in-flight probe cannot write a pre-rotation result back.
    this._status.clear(connectionId);
  }
}

/** Creates an AI settings ViewModel from explicit capabilities. */
export const createAiSettingsViewModel = (
  options: AiSettingsViewModelOptions,
): AiSettingsViewModelInterface => AiSettingsViewModel.create(options);
