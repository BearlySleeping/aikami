// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.svelte.ts
//
// Shared ViewModel for the focused setup subflow. Replaces the old
// capability_view + wizard with three entry paths (recommended, existing,
// text-only) over a single flow. Calls C-481's shared services directly,
// and reuses the same connection editor as AI Settings / capability
// detail pages (AiSettingsViewModel + ai_connection_modals.svelte) for
// every manual configuration action.
// Contract: C-483 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

import { IMAGE_PROVIDERS, TEXT_PROVIDERS, VOICE_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CapabilitySnapshot, ConnectionEntry } from '@aikami/types';
import { isAiTextProviderRequiredError } from '@aikami/utils';
import {
  campaignService,
  capabilityService,
  configService,
  equipmentService,
  gameModeService,
  inventoryService,
  playerStateService,
  routerService,
  runtimeConfigService,
  worldStateService,
} from '$services';
import type { ConnectionCapability } from '$types';
import {
  type AiSettingsViewModelInterface,
  getAiSettingsViewModel,
} from '../settings/ai/ai_settings_view_model.svelte';

// ── Types ──────────────────────────────────────────────────────────────

/** Entry path for the setup flow. */
export type SetupEntryPath = 'recommended' | 'existing' | 'text-only';

/** Where the flow was entered from — decides what "done" navigates to. */
export type SetupOrigin = 'new-adventure' | 'settings' | 'direct';

/** Step within the shared setup flow. */
export type SetupFlowStep =
  | 'idle'
  | 'entry'
  | 'detecting'
  | 'results'
  | 'plan'
  | 'manual'
  | 'applying'
  | 'ready'
  | 'error';

/** A discovered provider during scanning. */
export type DiscoveredProvider = {
  readonly provider: string;
  readonly capability: ConnectionCapability;
  readonly label: string;
  readonly isLocal: boolean;
  readonly isCompatible: boolean;
  readonly modelName: string | undefined;
  readonly baseUrl: string | undefined;
};

/** A capability toggle for the feature selection step. */
export type CapabilityToggle = {
  readonly id: ConnectionCapability;
  readonly label: string;
  readonly required: boolean;
  enabled: boolean;
  readonly description: string;
};

/** Summary of a plan step. */
export type PlanSummary = {
  readonly capabilities: readonly CapabilityToggle[];
  readonly providers: readonly DiscoveredProvider[];
  readonly requiresOnline: boolean;
  readonly resourceWarnings: readonly string[];
};

export type SetupSubflowViewModelInterface = BaseViewModelInterface & {
  /** Current flow step. */
  readonly step: SetupFlowStep;
  /** Selected entry path. */
  readonly entryPath: SetupEntryPath | null;
  /** Capability toggles for the feature selection. */
  readonly capabilityToggles: readonly CapabilityToggle[];
  /** Discovered providers after scanning. */
  readonly discoveredProviders: readonly DiscoveredProvider[];
  /** Plan summary for review. */
  readonly planSummary: PlanSummary | null;
  /** Error message to display. */
  readonly errorMessage: string;
  /** Whether detection is in progress. */
  readonly isDetecting: boolean;
  /** Whether applying is in progress. */
  readonly isApplying: boolean;
  /** Whether text is ready (required for start). */
  readonly isTextReady: boolean;
  /** Snapshot from capability detection. */
  readonly snapshot: CapabilitySnapshot | null;
  /** Whether discovery produced at least one provider. */
  readonly hasDiscoveredProviders: boolean;
  /** Resource warnings prepared for plan presentation. */
  readonly resourceWarnings: readonly string[];
  /** Whether the plan has resource warnings. */
  readonly hasResourceWarnings: boolean;
  /** Error message with a safe presentation fallback. */
  readonly displayErrorMessage: string;
  /** Whether the current plan can be applied as-is (a usable text choice exists). */
  readonly canApplyPlan: boolean;
  /** The shared connection editor / voice setup ViewModel — mounted by the View during the 'manual' step. */
  readonly editorViewModel: AiSettingsViewModelInterface;
  /** Capability currently being configured manually, when step === 'manual'. */
  readonly manualCapability: ConnectionCapability | null;

  /** Selects an entry path. */
  selectEntryPath(path: SetupEntryPath): void;
  /** Toggles a capability on/off. */
  toggleCapability(capability: ConnectionCapability): void;
  /** Continues from the results (feature-selection) step — discovery for Recommended, manual entry for Connect Existing. */
  continueFromResults(): Promise<void>;
  /** Starts provider discovery for the enabled capabilities only. */
  startDiscovery(): Promise<void>;
  /** Opens the shared connection editor for manual configuration of one capability. */
  openManualSetup(capability: ConnectionCapability): void;
  /** Called when the user is done with the manual editor — re-checks configured state and advances. */
  finishManualSetup(): void;
  /** Applies the selected plan. */
  applyPlan(): Promise<void>;
  /** Goes back one step. */
  goBack(): void;
  /** Resets the flow. */
  reset(): void;
  /** Leaves setup — resumes New Adventure, returns to Settings, or goes home, depending on how the flow was entered. */
  leave(): Promise<void>;
  /** Retries after an error. */
  retry(): void;
};

export type SetupSubflowViewModelOptions = BaseViewModelOptions & {
  /** Where the flow was entered from — decides what leave()/completion does. Defaults to 'direct'. */
  origin?: SetupOrigin;
};

// ── Constants ──────────────────────────────────────────────────────────

const CAPABILITY_DEFINITIONS: readonly CapabilityToggle[] = [
  {
    id: 'text',
    label: 'Text (Story & Dialogue)',
    required: true,
    enabled: true,
    description: 'Required for all gameplay. Powers NPC dialogue, narration, and player actions.',
  },
  {
    id: 'image',
    label: 'Artwork (Scenes & Characters)',
    required: false,
    enabled: false,
    description: 'Generate character portraits, scene illustrations, and environment art.',
  },
  {
    id: 'voice',
    label: 'Read Aloud (Voice Narration)',
    required: false,
    enabled: false,
    description: 'Have the story read aloud with AI-generated speech.',
  },
];

const LOCAL_PROVIDER_IDS = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'kokoro',
  'voicevox',
  'fish-speech',
]);

const _labelForProvider = (capability: ConnectionCapability, providerId: string): string => {
  if (capability === 'image') {
    return IMAGE_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
  }
  if (capability === 'voice') {
    return VOICE_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
  }
  return TEXT_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId;
};

// ── ViewModel ──────────────────────────────────────────────────────────

class SetupSubflowViewModel
  extends BaseViewModel<SetupSubflowViewModelOptions>
  implements SetupSubflowViewModelInterface
{
  private _discoveryOperationId = 0;
  private _applyOperationId = 0;
  private readonly _origin: SetupOrigin;

  readonly editorViewModel: AiSettingsViewModelInterface;

  step = $state<SetupFlowStep>('entry');
  entryPath = $state<SetupEntryPath | null>(null);
  errorMessage = $state('');
  isDetecting = $state(false);
  isApplying = $state(false);
  snapshot = $state<CapabilitySnapshot | null>(null);
  manualCapability = $state<ConnectionCapability | null>(null);

  // Selected capability toggles (mirror the definitions, user can enable optional ones).
  private _capabilityToggles = $state<CapabilityToggle[]>(
    CAPABILITY_DEFINITIONS.map((d) => ({ ...d })),
  );
  private _discoveredProviders = $state<DiscoveredProvider[]>([]);
  private _planSummary = $state<PlanSummary | null>(null);

  constructor(options: SetupSubflowViewModelOptions) {
    super(options);
    this._origin = options.origin ?? 'direct';
    this.editorViewModel = getAiSettingsViewModel({ className: 'SetupSubflowEditor' });
  }

  // ── Getters ────────────────────────────────────────────────────────────

  get capabilityToggles(): readonly CapabilityToggle[] {
    return this._capabilityToggles;
  }

  get discoveredProviders(): readonly DiscoveredProvider[] {
    return this._discoveredProviders;
  }

  get planSummary(): PlanSummary | null {
    return this._planSummary;
  }

  get isTextReady(): boolean {
    if (this._hasUsableConnection('text')) {
      return true;
    }
    if (!this.snapshot) {
      return false;
    }
    return this.snapshot.textStatus === 'detected' || this.snapshot.textStatus === 'configured';
  }

  get canApplyPlan(): boolean {
    if (!this._capabilityToggles.find((t) => t.id === 'text')?.enabled) {
      return true;
    }
    return this.isTextReady;
  }

  get hasDiscoveredProviders(): boolean {
    return this._discoveredProviders.length > 0;
  }

  get resourceWarnings(): readonly string[] {
    return this._planSummary?.resourceWarnings ?? [];
  }

  get hasResourceWarnings(): boolean {
    return this.resourceWarnings.length > 0;
  }

  get displayErrorMessage(): string {
    return this.errorMessage || 'An error occurred';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Detect without auto-scanning — user must explicitly trigger.
    return super.initialize();
  }

  override async dispose(): Promise<void> {
    this._invalidateDiscovery();
    this._applyOperationId += 1;
    await this.editorViewModel.dispose();
    await super.dispose();
  }

  // ── Entry path selection ───────────────────────────────────────────────

  selectEntryPath(path: SetupEntryPath): void {
    this.entryPath = path;
    this.errorMessage = '';

    if (path === 'text-only') {
      // Text-only skips optional selection — go straight to configuring text.
      this._capabilityToggles = this._capabilityToggles.map((t) => ({
        ...t,
        enabled: t.id === 'text',
      }));
      if (this._hasUsableConnection('text')) {
        this.step = 'ready';
        return;
      }
      // A viable text choice is required before text-only can complete —
      // open the real editor rather than applying nothing and pretending
      // setup succeeded.
      void this.openManualSetup('text');
    } else {
      // Recommended or existing — show feature selection.
      this.step = 'results';
    }
  }

  toggleCapability(capability: ConnectionCapability): void {
    const toggle = this._capabilityToggles.find((t) => t.id === capability);
    if (toggle && !toggle.required) {
      toggle.enabled = !toggle.enabled;
    }
  }

  async continueFromResults(): Promise<void> {
    if (this.entryPath === 'existing') {
      // Connect Something I Already Use: skip auto-discovery entirely and
      // go straight to manual entry/reuse for the first enabled capability
      // that needs it — a real distinction from Recommended, not a second
      // path that behaves identically.
      const first = this._capabilityToggles.find(
        (t) => t.enabled && !this._hasUsableConnection(t.id),
      );
      if (first) {
        await this.openManualSetup(first.id);
      } else {
        this.step = 'ready';
      }
      return;
    }
    await this.startDiscovery();
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  async startDiscovery(): Promise<void> {
    if (this.isDetecting) {
      return;
    }

    const enabledIds = this._capabilityToggles.filter((t) => t.enabled).map((t) => t.id);

    const operationId = ++this._discoveryOperationId;
    this.isDetecting = true;
    this.errorMessage = '';
    this.step = 'detecting';

    try {
      // Only the capabilities the user actually enabled are probed — an
      // un-selected optional capability is never scanned.
      const snapshot = await capabilityService.detect({ capabilities: enabledIds });
      if (operationId !== this._discoveryOperationId) {
        return;
      }
      this.snapshot = snapshot;
      this._discoveredProviders = this._buildDiscoveredProviders(snapshot, enabledIds);
      this._buildPlan(snapshot);
      this.step = 'plan';
      this.debug('startDiscovery:complete', { providers: this._discoveredProviders.length });
    } catch (error) {
      if (operationId !== this._discoveryOperationId) {
        return;
      }
      this.warn('startDiscovery:failed', error);
      this.errorMessage = 'Discovery failed. You can enter provider details manually.';
      this.step = 'error';
    } finally {
      if (operationId === this._discoveryOperationId) {
        this.isDetecting = false;
      }
    }
  }

  /** Builds the discovered-provider list using the real detected provider per capability — never a hardcoded engine name. */
  private _buildDiscoveredProviders(
    snapshot: CapabilitySnapshot,
    enabledIds: readonly ConnectionCapability[],
  ): DiscoveredProvider[] {
    const providers: DiscoveredProvider[] = [];

    if (
      enabledIds.includes('text') &&
      snapshot.textStatus === 'detected' &&
      snapshot.textProviderId
    ) {
      providers.push({
        provider: snapshot.textProviderId,
        capability: 'text',
        label: _labelForProvider('text', snapshot.textProviderId),
        isLocal: LOCAL_PROVIDER_IDS.has(snapshot.textProviderId),
        isCompatible: true,
        modelName: snapshot.textModelName,
        baseUrl: runtimeConfigService.getTextUrl() ?? undefined,
      });
    }
    if (
      enabledIds.includes('image') &&
      snapshot.imageStatus === 'detected' &&
      snapshot.imageProviderId
    ) {
      providers.push({
        provider: snapshot.imageProviderId,
        capability: 'image',
        label: _labelForProvider('image', snapshot.imageProviderId),
        isLocal: LOCAL_PROVIDER_IDS.has(snapshot.imageProviderId),
        isCompatible: true,
        modelName: undefined,
        baseUrl: runtimeConfigService.getImageUrl() ?? undefined,
      });
    }
    if (
      enabledIds.includes('voice') &&
      snapshot.voiceStatus === 'detected' &&
      snapshot.voiceProviderId
    ) {
      providers.push({
        provider: snapshot.voiceProviderId,
        capability: 'voice',
        label: _labelForProvider('voice', snapshot.voiceProviderId),
        isLocal: LOCAL_PROVIDER_IDS.has(snapshot.voiceProviderId),
        isCompatible: true,
        modelName: undefined,
        baseUrl: undefined,
      });
    }

    return providers;
  }

  // ── Manual configuration (shared editor) ────────────────────────────────

  openManualSetup(capability: ConnectionCapability): void {
    this.manualCapability = capability;
    this.step = 'manual';
    this.editorViewModel.openCapabilitySetup(capability);
  }

  finishManualSetup(): void {
    // The editor closed (Save or Cancel) — re-derive state from configService
    // rather than trusting the editor's transient draft, then decide where
    // to go next.
    const capability = this.manualCapability;
    this.manualCapability = null;

    if (capability === 'text' || (capability === null && this.entryPath === 'text-only')) {
      if (this._hasUsableConnection('text')) {
        this.step = 'ready';
        return;
      }
      // Still not configured (user cancelled) — let them choose again
      // rather than silently pretending setup succeeded.
      this.step = this.entryPath === 'text-only' ? 'entry' : 'results';
      return;
    }

    // Optional capability (image/voice) configured or skipped — continue
    // toward the next unconfigured enabled capability, or finish.
    const next = this._capabilityToggles.find((t) => t.enabled && !this._hasUsableConnection(t.id));
    if (next) {
      void this.openManualSetup(next.id);
      return;
    }
    this.step = this.isTextReady ? 'ready' : 'results';
  }

  // ── Apply plan (Recommended path) ───────────────────────────────────────

  async applyPlan(): Promise<void> {
    if (this.isApplying) {
      return;
    }

    if (!this.canApplyPlan) {
      // A required text choice is missing — send the user to configure it
      // rather than letting Apply predictably throw.
      await this.openManualSetup('text');
      return;
    }

    const operationId = ++this._applyOperationId;
    this.isApplying = true;
    this.errorMessage = '';
    this.step = 'applying';

    try {
      const enabledCaps = this._capabilityToggles.filter((t) => t.enabled).map((t) => t.id);

      if (enabledCaps.includes('text')) {
        await this._ensureTextProvider();
      }
      if (operationId !== this._applyOperationId) {
        return;
      }
      if (enabledCaps.includes('image')) {
        await this._ensureDetectedProvider('image');
      }
      if (operationId !== this._applyOperationId) {
        return;
      }
      if (enabledCaps.includes('voice')) {
        await this._ensureDetectedProvider('voice');
      }
      if (operationId !== this._applyOperationId) {
        return;
      }

      this.step = 'ready';
      this.debug('applyPlan:complete', { capabilities: enabledCaps });
    } catch (error) {
      if (operationId !== this._applyOperationId) {
        return;
      }
      this.warn('applyPlan:failed', error);
      this.errorMessage = 'Failed to apply configuration. Please try again.';
      this.step = 'error';
    } finally {
      if (operationId === this._applyOperationId) {
        this.isApplying = false;
      }
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  goBack(): void {
    this.errorMessage = '';
    if (this.step === 'manual') {
      this.manualCapability = null;
      if (this.entryPath === 'text-only') {
        this.step = 'entry';
      } else {
        this.step = this.snapshot ? 'plan' : 'results';
      }
      return;
    }
    if (this.step === 'plan') {
      this.step = 'results';
      return;
    }

    this._invalidateDiscovery();
    this.step = 'entry';
    this.entryPath = null;
  }

  reset(): void {
    this._invalidateDiscovery();
    this._applyOperationId += 1;
    this.step = 'entry';
    this.entryPath = null;
    this.errorMessage = '';
    this.isDetecting = false;
    this.isApplying = false;
    this.snapshot = null;
    this.manualCapability = null;
    this._capabilityToggles = CAPABILITY_DEFINITIONS.map((d) => ({ ...d }));
    this._discoveredProviders = [];
    this._planSummary = null;
  }

  async leave(): Promise<void> {
    if (this._origin === 'settings') {
      await routerService.goToRoute('settings', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
      return;
    }

    if (this._origin !== 'new-adventure') {
      // Any other entry (world-gen's "generation-failed" recovery,
      // bookmarked/dev navigation, ...) is outside this flow's authority
      // to resume — starting a campaign here would be a guess. Send the
      // player home rather than fabricate an action for a context this
      // flow was never told about.
      await routerService.goToRoute('index', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
      return;
    }

    // Entered from New Adventure's text-provider gate: resume the campaign
    // creation the setup screen interrupted. No campaign was created before
    // the redirect here (the gate throws before campaignService writes
    // anything), so this creates exactly one.
    try {
      inventoryService.reset();
      worldStateService.reset();
      playerStateService.reset();
      equipmentService.reset();
      gameModeService.reset();

      await campaignService.startNewCampaign({ contentPackId: 'emberwatch' });

      await routerService.goToRoute('personaCreate', {
        queryParameters: { onboarding: '1' },
        pathParameters: undefined,
      });
    } catch (error) {
      if (isAiTextProviderRequiredError(error)) {
        // Setup reported ready but the gate disagrees — send the user back
        // to configure text rather than stranding them on a dead end.
        await this.openManualSetup('text');
        return;
      }
      this.error('leave:failed', error);
      this.errorMessage = 'Failed to start your adventure. Try again.';
      this.step = 'error';
    }
  }

  retry(): void {
    this.errorMessage = '';
    if (this.snapshot) {
      this.step = 'plan';
    } else {
      this.step = 'results';
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async _ensureTextProvider(): Promise<void> {
    if (this._hasUsableConnection('text')) {
      return;
    }

    const snapshot = this.snapshot;
    if (snapshot?.textStatus !== 'detected' || !snapshot.textProviderId) {
      throw new Error('A usable text provider is required before setup can complete.');
    }

    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const textBaseUrl = runtimeConfigService.getTextUrl();
    configService.addConnection({
      name: `${snapshot.textProviderId} (local)`,
      provider: snapshot.textProviderId,
      capability: 'text',
      apiKey: '',
      baseUrl: textBaseUrl ?? '',
      model: snapshot.textModelName ?? '',
      generationParams: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 1024,
        contextSize: 4096,
      },
      isDefault: connections.length === 0,
      source: 'detected',
    });
    await configService.save();
  }

  private _invalidateDiscovery(): void {
    this._discoveryOperationId += 1;
    this.isDetecting = false;
  }

  /** Seeds a connection for an optional (image/voice) capability that discovery actually detected — never invents one that wasn't found. */
  private async _ensureDetectedProvider(capability: 'image' | 'voice'): Promise<void> {
    if (this._hasUsableConnection(capability)) {
      return;
    }

    const status = capability === 'image' ? this.snapshot?.imageStatus : this.snapshot?.voiceStatus;
    const providerId =
      capability === 'image' ? this.snapshot?.imageProviderId : this.snapshot?.voiceProviderId;
    if (status !== 'detected' || !providerId) {
      return;
    }

    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const baseUrl = capability === 'image' ? (runtimeConfigService.getImageUrl() ?? '') : '';
    const generationParams = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      repetitionPenalty: 1,
      presencePenalty: 0,
      maxTokens: 1024,
      contextSize: 4096,
    };

    if (capability === 'image') {
      configService.addConnection({
        name: `${_labelForProvider('image', providerId)}`,
        provider: providerId,
        capability: 'image',
        apiKey: '',
        baseUrl,
        model: '',
        imageOptions: { checkpoint: '', width: 512, height: 512, steps: 20, cfg: 7 },
        generationParams,
        isDefault: connections.length === 0,
        source: 'detected',
      });
    } else {
      configService.addConnection({
        name: `${_labelForProvider('voice', providerId)}`,
        provider: providerId,
        capability: 'voice',
        apiKey: '',
        baseUrl,
        model: '',
        voiceOptions: { voiceId: 'default', speed: 1, pitch: 0 },
        generationParams,
        isDefault: connections.length === 0,
        source: 'detected',
      });
    }

    await configService.save();
  }

  private _hasUsableConnection(capability: ConnectionCapability): boolean {
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    return connections.some((c) => (c.capability ?? 'text') === capability && this._isUsable(c));
  }

  private _isUsable(connection: ConnectionEntry): boolean {
    if (LOCAL_PROVIDER_IDS.has(connection.provider)) {
      // A local connection is only usable once discovery/the editor
      // actually captured a concrete endpoint or model — a bare, blank
      // record is not evidence that anything was configured.
      return Boolean(connection.baseUrl?.trim() || connection.model?.trim());
    }
    return (connection.apiKey?.trim().length ?? 0) > 0;
  }

  private _buildPlan(snapshot: CapabilitySnapshot): void {
    const resourceWarnings: string[] = [];

    if (snapshot.textStatus === 'not_found' && !this._hasUsableConnection('text')) {
      resourceWarnings.push(
        'A text AI provider is required. You can use a cloud service or install Ollama.',
      );
    }

    const hasOnlineOnly =
      this._discoveredProviders.length === 0 &&
      snapshot.textStatus !== 'detected' &&
      snapshot.textStatus !== 'configured';
    if (hasOnlineOnly) {
      resourceWarnings.push('Some features require an internet connection for cloud AI services.');
    }

    this._planSummary = {
      capabilities: this._capabilityToggles,
      providers: this._discoveredProviders,
      requiresOnline: hasOnlineOnly,
      resourceWarnings,
    };
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getSetupSubflowViewModel = (
  options: SetupSubflowViewModelOptions,
): SetupSubflowViewModelInterface => SetupSubflowViewModel.create(options);
