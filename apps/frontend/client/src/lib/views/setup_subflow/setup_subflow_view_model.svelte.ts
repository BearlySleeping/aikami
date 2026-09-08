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
import { isTauri } from '$lib/views/utils/is_tauri';
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

/**
 * Step within the shared setup flow.
 *
 * `plan` is the hub: it reviews what is configured, what discovery found,
 * and which optional capabilities are still available, and it is always
 * reachable so a saved-but-wrong connection can be corrected.
 */
export type SetupFlowStep =
  | 'idle'
  | 'entry'
  | 'detecting'
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
  /** Stable {#each} key. */
  readonly key: string;
  /** Local-vs-cloud glyph, resolved here so the View holds no conditional. */
  readonly icon: string;
  /** Capability plus model, already formatted for display. */
  readonly detailText: string;
};

/** A capability toggle for the feature selection step. */
export type CapabilityToggle = {
  readonly id: ConnectionCapability;
  readonly label: string;
  readonly required: boolean;
  enabled: boolean;
  readonly description: string;
};

/**
 * One capability as presented on the plan screen — what it is, whether it
 * is already backed by a usable connection, and what discovery found for
 * it. Drives both the review list and the per-capability edit action.
 */
export type CapabilityRow = {
  readonly id: ConnectionCapability;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly enabled: boolean;
  /** A usable connection already exists for this capability. */
  readonly configured: boolean;
  /** Name of the connection backing it, when configured. */
  readonly connectionName: string | undefined;
  /** Label of a provider discovery found but that has not been saved yet. */
  readonly discoveredLabel: string | undefined;
  /** The single secondary line to render — connection name, discovery, or description. */
  readonly statusText: string;
  /** "Change" or "Set up". */
  readonly actionLabel: string;
  /** Status glyph for the required row. */
  readonly icon: string;
  /** Button classes for this row's action. */
  readonly actionButtonClass: string;
  /** Whether the row's checkbox reads as on. */
  readonly checked: boolean;
  /** Whether the row's checkbox is locked (no backing connection or detection). */
  readonly disabled: boolean;
};

/**
 * One saved connection as listed on the manual step. Saving closes the editor,
 * so without this the step showed no evidence the connection existed and the
 * only button reopened a blank Add form.
 */
export type ManualConnectionRow = {
  readonly id: string;
  readonly name: string;
  /** Provider, and model when one is set — formatted for display. */
  readonly detailText: string;
  /** Whether this connection is complete enough to use. */
  readonly usable: boolean;
  /** Whether this connection is the default for its capability. */
  readonly isDefault: boolean;
  /** Status glyph. */
  readonly icon: string;
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
  /** Per-capability review rows for the plan screen. */
  readonly capabilityRows: readonly CapabilityRow[];
  /** The required (text) row, for the plan screen's Required section. */
  readonly requiredRow: CapabilityRow | undefined;
  /** The optional rows, for the plan screen's Optional section. */
  readonly optionalRows: readonly CapabilityRow[];
  /** Title for the current step. */
  readonly headingTitle: string;
  /** Subtitle for the current step; empty when the step needs none. */
  readonly headingSubtitle: string;
  /** Whether the current step has a subtitle to render. */
  readonly hasHeadingSubtitle: boolean;
  /** Closing message on the ready screen, worded for the path taken. */
  readonly readyMessage: string;
  /** Why Continue is disabled, when it is. */
  readonly blockedHint: string;
  /** Whether the plan screen should show the "nothing found" empty state. */
  readonly showNoProvidersMessage: boolean;
  /** Whether Continue on the plan screen is unavailable. */
  readonly isContinueDisabled: boolean;
  /** Whether {@link blockedHint} has something to say. */
  readonly hasBlockedHint: boolean;

  // Step predicates — the View branches on booleans, never on step equality.
  readonly isEntryStep: boolean;
  readonly isDetectingStep: boolean;
  readonly isPlanStep: boolean;
  readonly isManualStep: boolean;
  readonly isApplyingStep: boolean;
  readonly isReadyStep: boolean;
  readonly isErrorStep: boolean;

  /** Connections already saved for the capability being configured. */
  readonly manualConnections: readonly ManualConnectionRow[];
  /** Whether any connection exists for the capability being configured. */
  readonly hasManualConnections: boolean;
  /** Guidance for the manual step, worded for whether anything is saved yet. */
  readonly manualIntroText: string;
  /** Label for the manual step's add button. */
  readonly manualAddButtonLabel: string;
  /** Classes for the manual step's add button; secondary once Continue is the main action. */
  readonly manualAddButtonClass: string;

  /** Reopens the connection editor for the capability being configured, keeping it scoped. */
  reopenManualEditor(): void;
  /** Opens the editor on an existing connection so it can be corrected. */
  editConnection(connectionId: string): void;
  /** Marks a saved connection as the default for its capability. */
  useConnection(connectionId: string): void;
  /** Entry path: scan for what is already available. */
  selectRecommended(): void;
  /** Entry path: enter provider details by hand. */
  selectExisting(): void;
  /** Entry path: configure text and nothing else. */
  selectTextOnly(): void;
  /** Whether the app is running in the Tauri desktop shell — decides which install advice is truthful. */
  readonly isDesktop: boolean;
  /** Platform-appropriate message for the "nothing found" state on the plan screen. */
  readonly noProvidersMessage: string;
  /** Whether a discovery scan has actually run — the "nothing found" state is only honest after one. */
  readonly hasScanned: boolean;
  /** Whether provider discovery is available at all (desktop only). */
  readonly canScan: boolean;
  /** Whether the entry-path choice is shown; web goes straight to review. */
  readonly showsEntryChoice: boolean;
  /** Whether the review screen offers a Back button. */
  readonly canGoBackFromPlan: boolean;

  /** Selects an entry path. */
  selectEntryPath(path: SetupEntryPath): void;
  /** Toggles a capability on/off. */
  toggleCapability(capability: ConnectionCapability): void;
  /** Re-runs discovery from the plan screen. */
  rescan(): Promise<void>;
  /** Starts provider discovery for the enabled capabilities only. */
  startDiscovery(): Promise<void>;
  /** Opens the shared connection editor for manual configuration of one capability. */
  openManualSetup(capability: ConnectionCapability): void;
  /** Shows the manual step (saved connections list) without opening the editor. */
  showManualStep(capability: ConnectionCapability): void;
  /** Plan-step action: show saved connections when configured, otherwise open the editor. */
  reviewCapability(capability: ConnectionCapability): void;
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

/**
 * Per-step header copy. A single fixed title made every screen look like the
 * same screen, which is what made the three entry paths feel identical.
 */
const STEP_HEADINGS: Record<SetupFlowStep, { title: string; subtitle: string }> = {
  idle: { title: 'Set up your AI', subtitle: '' },
  entry: {
    title: 'Set up your AI',
    subtitle: 'Aikami needs a text AI to tell the story. Pick how you want to connect one.',
  },
  detecting: { title: 'Looking around', subtitle: 'Checking what AI is available to you.' },
  plan: {
    title: 'Your setup',
    subtitle: 'Review what will be used, and change anything you like.',
  },
  // The manual step titles itself from what is already saved; the subtitle is
  // empty because the step renders its own guidance and would otherwise say
  // the same thing twice.
  manual: { title: 'Add a connection', subtitle: '' },
  applying: { title: 'Saving your setup', subtitle: '' },
  ready: { title: 'All set', subtitle: '' },
  error: { title: 'Something went wrong', subtitle: '' },
};

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

/** Capability plus optional model, formatted once so the View renders a plain string. */
const _providerDetailText = (
  capability: ConnectionCapability,
  modelName: string | undefined,
): string => (modelName ? `${capability} · ${modelName}` : capability);

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
  /** The in-flight discovery run, so a second request joins it instead of racing it. */
  private _pendingDiscovery: Promise<void> | null = null;
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

  get isDesktop(): boolean {
    return isTauri();
  }

  get hasScanned(): boolean {
    return this.snapshot !== null;
  }

  /**
   * Discovery only makes sense in the desktop shell, which can see local
   * runtimes and install one. A browser tab has nothing to scan, so the web
   * build never offers it and never runs it.
   */
  get canScan(): boolean {
    return this.isDesktop;
  }

  /**
   * Web skips the entry choice entirely: with scanning gone, "find AI for me"
   * has nothing to find, and the remaining two paths both mean "enter your
   * provider". The review screen is the first and only screen.
   */
  get showsEntryChoice(): boolean {
    return this.isDesktop;
  }

  /** Back from review returns to the entry choice — which web never shows. */
  get canGoBackFromPlan(): boolean {
    return this.isDesktop;
  }

  get noProvidersMessage(): string {
    return this.isDesktop
      ? 'Nothing found on this computer. Add a provider below — a cloud service, or a server you already run.'
      : 'Nothing reachable from this browser. Add a provider below — a cloud service, or a local server you already run.';
  }

  get capabilityRows(): readonly CapabilityRow[] {
    return this._capabilityToggles.map((toggle) => {
      const connection = this._connectionFor(toggle.id);
      const discovered = this._discoveredProviders.find((p) => p.capability === toggle.id);
      const configured = Boolean(connection);
      const discoveredLabel = configured ? undefined : discovered?.label;

      let statusText: string;
      if (connection) {
        statusText = `Using ${connection.name}`;
      } else if (discoveredLabel) {
        statusText = `Found: ${discoveredLabel}`;
      } else if (toggle.required) {
        statusText = 'Not set up yet';
      } else {
        statusText = toggle.description;
      }

      return {
        id: toggle.id,
        label: toggle.label,
        description: toggle.description,
        required: toggle.required,
        enabled: toggle.enabled,
        configured,
        connectionName: connection?.name,
        discoveredLabel,
        statusText,
        actionLabel: configured ? 'Change' : 'Set up',
        icon: configured ? '✅' : '⚠️',
        actionButtonClass: configured ? 'btn btn-sm btn-ghost' : 'btn btn-sm btn-primary',
        // An optional capability only reads as on while something backs it, so
        // removing its connection drops the checkbox to off (and disabled)
        // even if the stale toggle was left enabled internally.
        checked: toggle.required ? toggle.enabled : toggle.enabled && this._hasBacking(toggle.id),
        disabled: !toggle.required && !this._hasBacking(toggle.id),
      };
    });
  }

  get requiredRow(): CapabilityRow | undefined {
    return this.capabilityRows.find((row) => row.required);
  }

  get optionalRows(): readonly CapabilityRow[] {
    return this.capabilityRows.filter((row) => !row.required);
  }

  get headingTitle(): string {
    if (this.step === 'manual' && this.hasManualConnections) {
      return 'Your connections';
    }
    return STEP_HEADINGS[this.step]?.title ?? STEP_HEADINGS.entry.title;
  }

  get headingSubtitle(): string {
    return STEP_HEADINGS[this.step]?.subtitle ?? '';
  }

  get hasHeadingSubtitle(): boolean {
    return this.headingSubtitle.length > 0;
  }

  get readyMessage(): string {
    return this.entryPath === 'text-only'
      ? 'Text is set up. You can add artwork and read-aloud any time from Settings.'
      : 'Your AI setup is complete. You can change any of it later in Settings.';
  }

  get blockedHint(): string {
    if (this.canApplyPlan) {
      return '';
    }
    return `Set up ${this.requiredRow?.label ?? 'text'} to continue.`;
  }

  get showNoProvidersMessage(): boolean {
    return this.hasScanned && !this.hasDiscoveredProviders;
  }

  get isContinueDisabled(): boolean {
    return this.isApplying || !this.canApplyPlan;
  }

  get hasBlockedHint(): boolean {
    return this.blockedHint.length > 0;
  }

  get isEntryStep(): boolean {
    return this.step === 'entry';
  }

  get isDetectingStep(): boolean {
    return this.step === 'detecting';
  }

  get isPlanStep(): boolean {
    return this.step === 'plan';
  }

  get isManualStep(): boolean {
    return this.step === 'manual';
  }

  get isApplyingStep(): boolean {
    return this.step === 'applying';
  }

  get isReadyStep(): boolean {
    return this.step === 'ready';
  }

  get isErrorStep(): boolean {
    return this.step === 'error';
  }

  selectRecommended(): void {
    this.selectEntryPath('recommended');
  }

  selectExisting(): void {
    this.selectEntryPath('existing');
  }

  selectTextOnly(): void {
    this.selectEntryPath('text-only');
  }

  get manualConnections(): readonly ManualConnectionRow[] {
    const capability = this.manualCapability ?? 'text';
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const defaultId = configService.state.defaultByCapability?.[capability];
    return connections
      .filter((c) => (c.capability ?? 'text') === capability)
      .map((c) => {
        const label = _labelForProvider(capability, c.provider);
        const usable = this._isUsable(c);
        return {
          id: c.id,
          name: c.name || label,
          detailText: c.model ? `${label} · ${c.model}` : label,
          usable,
          isDefault: defaultId !== undefined && c.id === defaultId,
          icon: usable ? '✅' : '⚠️',
        };
      });
  }

  get hasManualConnections(): boolean {
    return this.manualConnections.length > 0;
  }

  get manualIntroText(): string {
    return this.hasManualConnections
      ? 'Edit a connection to change its details, or add another. Continue when you are done.'
      : "Enter your provider's details in the editor. Continue once you're done.";
  }

  get manualAddButtonLabel(): string {
    return this.hasManualConnections ? 'Add another connection' : 'Open Connection Editor';
  }

  get manualAddButtonClass(): string {
    // Once something is saved, Continue is the primary action and adding
    // another connection is the secondary one.
    return this.hasManualConnections ? 'btn btn-outline' : 'btn btn-primary';
  }

  /**
   * Opens the editor on an existing connection. The legacy projection keeps
   * the AiConnection id, so the id listed here is the one the editor wants.
   */
  editConnection(connectionId: string): void {
    this.debug('editConnection', { connectionId });
    this.editorViewModel.openEditConnection(connectionId);
  }

  useConnection(connectionId: string): void {
    this.debug('useConnection', { connectionId });
    configService.setDefaultConnection(connectionId);
    void configService.save();
  }

  /**
   * Reopens the editor for the capability currently being configured,
   * keeping it scoped so voice lands on the Kokoro-first connection editor.
   */
  reopenManualEditor(): void {
    const capability = this.manualCapability ?? 'text';
    this.manualCapability = capability;
    this.editorViewModel.openCapabilitySetup(capability);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Read the stored configuration before anything decides what is already
    // set up. Without this the route started from an empty in-memory state,
    // so a refresh "forgot" every saved connection — and worse, the next
    // save() serialized that empty state over the vault, destroying the
    // connections it had not read.
    await configService.load();
    // Auto-enable optional capabilities (image/voice) already backed by a
    // stored connection, so a reload keeps them on and a removed connection
    // drops them back to off + disabled.
    this._autoEnableOptional();
    // The editor ViewModel is deliberately not initialized here: its
    // initialize() loads image checkpoints and voice archetypes for the full
    // AI Settings page, and this flow only mounts the connection modals,
    // which need neither. Loading the configuration above is what the editor
    // actually shares with this screen.

    // Detect without auto-scanning — the user must explicitly trigger it,
    // and only the desktop build offers it at all.
    if (!this.showsEntryChoice) {
      // Web: no entry choice to make, so open on the review screen with the
      // required capability listed and ready to configure.
      this.entryPath = 'existing';
      this.step = 'plan';
    }
    return super.initialize();
  }

  override async dispose(): Promise<void> {
    this._invalidateDiscovery();
    this._applyOperationId += 1;
    await this.editorViewModel.dispose();
    await super.dispose();
  }

  // ── Entry path selection ───────────────────────────────────────────────

  /**
   * The three entry buttons now diverge immediately, so the choice the user
   * makes is the choice they see happen. Recommended scans; the other two
   * open the connection editor. None of them lead to a shared checkbox list
   * that made the buttons look interchangeable — optional capabilities are
   * offered on the plan screen, after there is something to add them to.
   */
  selectEntryPath(path: SetupEntryPath): void {
    this.entryPath = path;
    this.errorMessage = '';

    // Every path starts from the required capability only. Image and voice
    // are opt-in from the plan screen.
    this._capabilityToggles = this._capabilityToggles.map((t) => ({
      ...t,
      enabled: t.required,
    }));

    if (path === 'recommended' && this.canScan) {
      // "Recommended" means we go looking — no questions first.
      void this.startDiscovery();
      return;
    }

    if (this._hasUsableConnection('text')) {
      // Text is already usable, so there is nothing to enter. Text-only
      // asked for nothing more and is done; "connect my own" lands on the
      // review screen, where the existing choice is visible and editable.
      this.step = path === 'text-only' ? 'ready' : 'plan';
      return;
    }

    // "Connect something I already use" and "Text only" both mean the user
    // will supply the details — open the real editor rather than applying
    // nothing and pretending setup succeeded.
    this.openManualSetup('text');
  }

  toggleCapability(capability: ConnectionCapability): void {
    const toggle = this._capabilityToggles.find((t) => t.id === capability);
    if (!toggle || toggle.required) {
      return;
    }
    // An optional capability can only be turned on when something backs it —
    // a usable connection, or a provider the last scan detected. With nothing
    // behind it the checkbox is disabled and this guard keeps state in step.
    if (!toggle.enabled && !this._hasBacking(capability)) {
      this.debug('toggleCapability:blocked-no-backing', { capability });
      return;
    }
    toggle.enabled = !toggle.enabled;
  }

  async rescan(): Promise<void> {
    await this.startDiscovery();
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  async startDiscovery(): Promise<void> {
    if (!this.canScan) {
      this.debug('startDiscovery:unavailable-on-web');
      return;
    }
    if (this._pendingDiscovery) {
      // A scan is already running — join it rather than starting a second
      // one, so "Scan again" during a scan is a no-op the caller can await.
      return this._pendingDiscovery;
    }
    const run = this._runDiscovery();
    this._pendingDiscovery = run;
    try {
      await run;
    } finally {
      if (this._pendingDiscovery === run) {
        this._pendingDiscovery = null;
      }
    }
  }

  private async _runDiscovery(): Promise<void> {
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
        key: `${snapshot.textProviderId}-text`,
        icon: LOCAL_PROVIDER_IDS.has(snapshot.textProviderId) ? '🖥️' : '☁️',
        detailText: _providerDetailText('text', snapshot.textModelName),
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
        key: `${snapshot.imageProviderId}-image`,
        icon: LOCAL_PROVIDER_IDS.has(snapshot.imageProviderId) ? '🖥️' : '☁️',
        detailText: _providerDetailText('image', undefined),
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
        key: `${snapshot.voiceProviderId}-voice`,
        icon: LOCAL_PROVIDER_IDS.has(snapshot.voiceProviderId) ? '🖥️' : '☁️',
        detailText: _providerDetailText('voice', undefined),
      });
    }

    return providers;
  }

  // ── Manual configuration (shared editor) ────────────────────────────────

  showManualStep(capability: ConnectionCapability): void {
    this.manualCapability = capability;
    this.step = 'manual';
  }

  openManualSetup(capability: ConnectionCapability): void {
    this.showManualStep(capability);
    this.editorViewModel.openCapabilitySetup(capability);
  }

  reviewCapability(capability: ConnectionCapability): void {
    if (this._hasUsableConnection(capability)) {
      this.showManualStep(capability);
    } else {
      this.openManualSetup(capability);
    }
  }

  finishManualSetup(): void {
    // The editor closed (Save or Cancel) — re-derive state from configService
    // rather than trusting the editor's transient draft, then decide where
    // to go next.
    const capability = this.manualCapability;
    this.manualCapability = null;
    // Saving a connection for an optional capability (image/voice) auto-enables
    // its toggle; the plan screen reflects it immediately.
    this._autoEnableOptional();

    if (capability === 'text' || (capability === null && this.entryPath === 'text-only')) {
      if (this._hasUsableConnection('text')) {
        // Text-only asked for nothing else, so it is done. Every other path
        // returns to the review screen, where the new connection is listed
        // and can still be corrected.
        this.step = this.entryPath === 'text-only' ? 'ready' : 'plan';
        return;
      }
      // Still not configured — the user cancelled, or the editor refused a
      // credential that failed verification. Go to the review screen, which
      // shows text as "Not set up yet" and keeps Continue disabled with a
      // reason. Returning to the entry choice here made the flow a loop:
      // pick a path, fail to configure, land back on the same three buttons
      // with nothing explaining why.
      this.step = 'plan';
      return;
    }

    // An optional capability was configured or skipped — back to review,
    // which lists what is now set up and what is still available.
    this.step = 'plan';
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

      // Seeding a connection for an optional capability auto-enables it.
      this._autoEnableOptional();
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
    if (this.step === 'ready') {
      // From the completion screen, Back means the review — not the entry
      // choice, which would discard the context the user just built.
      this.step = 'plan';
      return;
    }
    if (this.step === 'manual') {
      this.manualCapability = null;
      // Back out to the review screen, which is always meaningful and is the
      // only screen on web.
      this.step = 'plan';
      return;
    }

    this._invalidateDiscovery();
    if (!this.showsEntryChoice) {
      this.step = 'plan';
      return;
    }
    this.step = 'entry';
    this.entryPath = null;
  }

  reset(): void {
    this._invalidateDiscovery();
    this._applyOperationId += 1;
    this.step = this.showsEntryChoice ? 'entry' : 'plan';
    this.entryPath = this.showsEntryChoice ? null : 'existing';
    this.errorMessage = '';
    this.isDetecting = false;
    this.isApplying = false;
    this.snapshot = null;
    this.manualCapability = null;
    this._capabilityToggles = CAPABILITY_DEFINITIONS.map((d) => ({ ...d }));
    this._discoveredProviders = [];
    this._planSummary = null;
    // Re-apply auto-enable for optional capabilities still backed by a stored
    // connection after the reset.
    this._autoEnableOptional();
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
    this.step = this.snapshot || !this.showsEntryChoice ? 'plan' : 'entry';
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
    const baseUrl =
      capability === 'image'
        ? (runtimeConfigService.getImageUrl() ?? '')
        : (runtimeConfigService.getVoiceTtsUrl() ?? '');

    // Kokoro is bundled and _isUsable() treats its persisted connection as
    // usable without an endpoint. Other local providers still need one.
    if (LOCAL_PROVIDER_IDS.has(providerId) && providerId !== 'kokoro' && !baseUrl.trim()) {
      this.warn('_ensureDetectedProvider:no-endpoint', { capability, providerId });
      return;
    }
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

  /** Whether the capability was detected as available by the last scan. */
  private _isDetected(capability: ConnectionCapability): boolean {
    if (capability === 'image') {
      return this.snapshot?.imageStatus === 'detected';
    }
    if (capability === 'voice') {
      return this.snapshot?.voiceStatus === 'detected';
    }
    return this.snapshot?.textStatus === 'detected';
  }

  /**
   * Whether an optional capability has anything to back it — a usable
   * connection, or a provider the last scan detected. With nothing behind it
   * the toggle is disabled in the view and {@link toggleCapability} refuses to
   * enable it.
   */
  private _hasBacking(capability: ConnectionCapability): boolean {
    return this._hasUsableConnection(capability) || this._isDetected(capability);
  }

  /**
   * Auto-enables optional capabilities (image/voice) already backed by a
   * usable connection. Called after stored config loads (so a reload keeps
   * them on), after a manual connection is saved, and after Apply seeds one.
   * Never disables — detection-driven opt-ins are the user's to keep.
   */
  private _autoEnableOptional(): void {
    this._capabilityToggles = this._capabilityToggles.map((toggle) =>
      toggle.required || !this._hasUsableConnection(toggle.id)
        ? toggle
        : { ...toggle, enabled: true },
    );
  }

  private _hasUsableConnection(capability: ConnectionCapability): boolean {
    return this._connectionFor(capability) !== undefined;
  }

  private _connectionFor(capability: ConnectionCapability): ConnectionEntry | undefined {
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const usable = connections.filter(
      (c) => (c.capability ?? 'text') === capability && this._isUsable(c),
    );
    const defaultId = configService.state.defaultByCapability?.[capability];
    return usable.find((c) => c.id === defaultId) ?? usable[0];
  }

  private _isUsable(connection: ConnectionEntry): boolean {
    if (LOCAL_PROVIDER_IDS.has(connection.provider)) {
      // Kokoro is a bundled binary — once a connection exists it is usable
      // without a server URL or model id. Other local providers only count
      // once the editor/discovery captured a concrete endpoint or model.
      if (connection.provider === 'kokoro') {
        return true;
      }
      return Boolean(connection.baseUrl?.trim() || connection.model?.trim());
    }
    return (connection.apiKey?.trim().length ?? 0) > 0;
  }

  private _buildPlan(snapshot: CapabilitySnapshot): void {
    const resourceWarnings: string[] = [];

    if (snapshot.textStatus === 'not_found' && !this._hasUsableConnection('text')) {
      // Only the desktop build can install a local runtime, so only it may
      // suggest one. Telling a browser tab to install Ollama is advice it
      // cannot act on.
      resourceWarnings.push(
        this.isDesktop
          ? 'A text AI is required to play. Connect a cloud service below, or install Ollama and scan again.'
          : 'A text AI is required to play. Connect a cloud service below, or point this at a local server you already run.',
      );
    }

    // Deliberately no "requires an internet connection" notice: it fires
    // exactly when the user is already choosing a cloud provider, where it
    // states the obvious and reads as a warning about their own choice.
    const hasOnlineOnly =
      this._discoveredProviders.length === 0 &&
      snapshot.textStatus !== 'detected' &&
      snapshot.textStatus !== 'configured';

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
