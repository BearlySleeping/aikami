// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
//
// ViewModel for the root Start Menu. Bridges AuthService (Firebase auth),
// RouterService (SPA navigation), CampaignService (campaign-first flow),
// and Tauri window API (desktop quit).
// Supports optional Google Sign-In — the game is fully functional without it.
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas
// Contract: C-334 Crash Detection Recovery (AC-5)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { Campaign, CapabilityProfile, PackIndexEntry } from '@aikami/types';
import { isAiTextProviderRequiredError } from '@aikami/utils';
import {
  type AssetPrefetchPhase,
  assetPrefetchService,
} from '$lib/services/assets/asset_prefetch_service.svelte';
import { isTauri } from '$lib/views/utils/is_tauri';
import {
  campaignService,
  equipmentService,
  gameModeService,
  gameOverlayService,
  gameSaveService,
  inventoryService,
  onboardingHintService,
  packRegistryService,
  playerStateService,
  routerService,
  worldStateService,
} from '$services';
import { CREDIT_GROUPS, type CreditGroup } from './credits_data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StartViewModelOptions = BaseViewModelOptions;

/** Display-ready summary of a campaign for the start menu. */
export type CampaignSummary = {
  /** Campaign ID. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** ISO timestamp of last save, or undefined if never saved. */
  readonly lastSavedAt: string | undefined;
  /** Display-ready label for the last save time. */
  readonly lastSavedLabel: string;
  /** Content pack display label. */
  readonly contentPackLabel: string;
  /** Whether the campaign is resumable (state is playing, paused, or saving). */
  readonly isResumable: boolean;
  /** AI capability indicators. */
  readonly capabilities: CapabilityProfile;
};

export type StartViewModelInterface = BaseViewModelInterface & {
  /** Whether running inside Tauri (desktop). */
  readonly isTauri: boolean;

  /** An initialization error message, or null when initialized successfully. */
  readonly initError: string | null;

  /** Whether the credits modal is visible. */
  readonly showCredits: boolean;

  /** C-317 AC-1: The latest resumable campaign, or undefined if none exist. */
  readonly latestResumableCampaign: CampaignSummary | undefined;

  /** C-317 AC-3: All campaigns as display-ready summaries (newest first). */
  readonly campaignSummaries: readonly CampaignSummary[];

  /** C-317 AC-3: Whether the Load Campaign modal is visible. */
  readonly showLoadCampaign: boolean;

  /** C-317 AC-4: Whether the New Adventure confirmation dialog is visible. */
  readonly showNewAdventureConfirm: boolean;

  /** C-334 AC-5: Whether a crash recovery prompt should be shown. */
  readonly showRecoveryPrompt: boolean;

  /** C-334 AC-5: The campaign ID from the stale session marker. */
  readonly recoveryCampaignId: string | undefined;

  /** C-334 AC-5: Whether a recovery action is in progress. */
  readonly isRecovering: boolean;

  /** C-317 AC-2: Start a new adventure — always creates a fresh campaign draft. */
  startNewAdventure(): Promise<void>;

  /** C-317 AC-1: Continue the latest resumable campaign. */
  continueLatestCampaign(): Promise<void>;

  /** C-317 AC-3: Open the Load Campaign modal. */
  openLoadCampaign(): void;

  /** C-317 AC-3: Close the Load Campaign modal. */
  closeLoadCampaign(): void;

  /** C-317 AC-3: Load a specific campaign by ID. */
  loadCampaignById(campaignId: string): Promise<void>;

  /** C-317 AC-4: Confirm starting a new adventure when a resumable campaign exists. */
  confirmNewAdventure(): Promise<void>;

  /** C-317 AC-4: Cancel the New Adventure confirmation. */
  cancelNewAdventure(): void;

  /** Navigates to the options/settings screen. */
  goToOptions(): Promise<void>;

  /** Retries initialization after an error (reloads the page). */
  retry(): void;

  /** Opens the credits modal. */
  showCreditsModal(): void;

  /** Closes the credits modal. */
  hideCreditsModal(): void;

  /** Credit groups for the credits modal. */
  readonly creditGroups: readonly CreditGroup[];

  /** Quits the desktop app (Tauri only). */
  quitApp(): Promise<void>;

  /** C-334 AC-5: Accepts recovery — loads the last save for the crashed campaign. */
  acceptRecovery(): Promise<void>;

  /** C-334 AC-5: Declines recovery — clears the session marker silently. */
  declineRecovery(): Promise<void>;

  /** C-405 AC-4: Navigates to the world-generation preview (Advanced entry). */
  startWorldGeneration(): Promise<void>;

  /** C-422 AC-3: Navigates to the game with a fresh onboarding arc (replay tutorial). */
  replayTutorial(): Promise<void>;

  // ── Pack Browser (C-345) ──

  /** Whether the pack browser modal is currently visible. */
  readonly showPackBrowser: boolean;

  /** All installed content packs from the registry. */
  readonly availablePacks: readonly PackIndexEntry[];

  /** The currently selected pack ID in the pack browser. */
  readonly selectedPackId: string | undefined;

  /** Opens the pack browser modal and loads available packs. */
  openPackBrowser(): Promise<void>;

  /** Closes the pack browser modal without starting a campaign. */
  closePackBrowser(): void;

  /** Selects a pack in the browser. */
  selectPack(packId: string): void;

  /** Confirms pack selection and starts a new campaign with the selected pack. */
  confirmPackSelection(): Promise<void>;

  // ── Background asset download (C-448) ──

  /** Current phase of the shared asset-download pipeline. */
  readonly downloadPhase: AssetPrefetchPhase;

  /** Download progress as a 0-1 fraction, or undefined when not in progress. */
  readonly downloadProgressFraction: number | undefined;

  /** Human-readable label for the current download phase, or undefined when idle/ready. */
  readonly downloadLabel: string | undefined;

  /**
   * Whether to offer the explicit "download everything for offline" action.
   * True once the required-to-play core is ready and the player hasn't
   * already started a full-catalog download.
   */
  readonly canDownloadAllAssets: boolean;

  /** Starts downloading every remaining catalog asset for offline play. */
  downloadAllAssets(): void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a content pack ID to a human-readable label. */
const CONTENT_PACK_LABELS: Record<string, string> = {
  emberwatch: 'Emberwatch: The Fading Ward',
} as const;

const getContentPackLabel = (contentPackId: string): string =>
  CONTENT_PACK_LABELS[contentPackId] ?? contentPackId;

/** States that count as resumable. */
const RESUMABLE_STATES = new Set<Campaign['state']>(['playing', 'paused', 'saving']);

/** Whether a campaign is in a resumable state. */
const isResumable = (campaign: Campaign): boolean => RESUMABLE_STATES.has(campaign.state);

/** Formats an ISO timestamp to a short relative or absolute date string. */
const formatLastSavedLabel = (iso: string | undefined): string => {
  if (!iso) {
    return 'Not yet saved';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Not yet saved';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};

/** Builds a CampaignSummary from a Campaign. */
const toCampaignSummary = (campaign: Campaign): CampaignSummary => ({
  id: campaign.id,
  name: campaign.name,
  lastSavedAt: campaign.lastSavedAt,
  lastSavedLabel: formatLastSavedLabel(campaign.lastSavedAt),
  contentPackLabel: getContentPackLabel(campaign.contentPackId),
  isResumable: isResumable(campaign),
  capabilities: campaign.capabilityProfile,
});

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class StartViewModel
  extends BaseViewModel<StartViewModelOptions>
  implements StartViewModelInterface
{
  /** Initialization error message — null when initialization succeeded. */
  private _initError = $state<string | null>(null);

  /** Whether the credits modal is currently visible. */
  showCredits = $state(false);

  /** C-317 AC-1: The latest resumable campaign summary, or undefined. */
  latestResumableCampaign = $state<CampaignSummary | undefined>(undefined);

  /** C-317 AC-3: All campaign summaries (newest first). */
  campaignSummaries: CampaignSummary[] = $state([]);

  /** C-317 AC-3: Whether the Load Campaign modal is visible. */
  showLoadCampaign = $state(false);

  /** C-317 AC-4: Whether the New Adventure confirmation dialog is visible. */
  showNewAdventureConfirm = $state(false);

  /** C-334 AC-5: Whether a crash recovery prompt should be shown. */
  showRecoveryPrompt = $state(false);

  /** C-334 AC-5: The campaign ID recovered from the stale session marker. */
  recoveryCampaignId = $state<string | undefined>(undefined);

  /** C-334 AC-5: Whether a recovery operation is in progress. */
  isRecovering = $state(false);

  // ── Pack Browser (C-345) ──

  /** Whether the pack browser modal is visible. */
  showPackBrowser = $state(false);

  /** Installed content packs from the registry. */
  availablePacks: PackIndexEntry[] = $state([]);

  /** The currently selected pack ID. */
  selectedPackId = $state<string | undefined>(undefined);

  /** @inheritdoc */
  get isTauri(): boolean {
    return isTauri();
  }

  /** @inheritdoc */
  get downloadPhase(): AssetPrefetchPhase {
    return assetPrefetchService.phase;
  }

  /** @inheritdoc */
  get downloadProgressFraction(): number | undefined {
    const progress =
      assetPrefetchService.phase === 'prefetching-core'
        ? assetPrefetchService.coreProgress
        : assetPrefetchService.warmProgress;
    if (!progress || progress.total === 0) {
      return undefined;
    }
    return progress.done / progress.total;
  }

  /** @inheritdoc */
  get downloadLabel(): string | undefined {
    switch (assetPrefetchService.phase) {
      case 'preparing':
        return 'Preparing assets…';
      case 'prefetching-core':
        return 'Downloading starter content…';
      case 'warming':
        return 'Downloading all assets for offline play…';
      case 'degraded':
        return assetPrefetchService.error ?? 'Asset download paused — check your connection.';
      default:
        return undefined;
    }
  }

  /** @inheritdoc */
  get canDownloadAllAssets(): boolean {
    return assetPrefetchService.phase === 'ready' && !assetPrefetchService.warmStarted;
  }

  /** @inheritdoc */
  downloadAllAssets(): void {
    assetPrefetchService.warmRemaining();
  }

  /** @inheritdoc */
  get initError(): string | null {
    return this._initError;
  }

  /** @inheritdoc */
  async startNewAdventure(): Promise<void> {
    // AC-4: If a resumable campaign exists, show confirmation dialog first
    if (this.latestResumableCampaign) {
      this.showNewAdventureConfirm = true;
      return;
    }

    await this._doStartNewAdventure();
  }

  /** @inheritdoc */
  async confirmNewAdventure(): Promise<void> {
    this.showNewAdventureConfirm = false;
    await gameOverlayService.saveGame();
    await this._doStartNewAdventure();
  }

  /** @inheritdoc */
  cancelNewAdventure(): void {
    this.showNewAdventureConfirm = false;
  }

  /**
   * Internal: creates a fresh campaign and routes to persona creation.
   * The text provider check remains as a soft advisory, not a hard block.
   */
  private async _doStartNewAdventure(): Promise<void> {
    await this._startCampaignWithPack({ packId: 'emberwatch', logKey: 'startNewAdventure' });
  }

  /** Resets game state, creates a campaign for a pack, and routes to persona creation. */
  private async _startCampaignWithPack(options: {
    packId: string;
    logKey: 'startNewAdventure' | '_proceedWithPack';
  }): Promise<void> {
    try {
      this.debug(options.logKey, { contentPackId: options.packId });

      // Reset game state for a fresh start
      inventoryService.reset();
      worldStateService.reset();
      playerStateService.reset();
      equipmentService.reset();
      gameModeService.reset();

      await campaignService.startNewCampaign({ contentPackId: options.packId });

      await routerService.goToRoute('personaCreate', {
        queryParameters: { onboarding: '1' },
        pathParameters: undefined,
      });
    } catch (error) {
      if (isAiTextProviderRequiredError(error)) {
        this.warn(`${options.logKey}:no-text-provider`, { error: String(error) });
        // Soft advisory — route to capability screen instead of blocking
        await routerService.goToRoute('capability', {
          queryParameters: { reason: 'text-provider-required' },
          pathParameters: undefined,
        });
        return;
      }

      this.error(`${options.logKey}:failed`, error);
      this.errorMessage = 'Failed to start campaign. Try again.';
    }
  }

  /** @inheritdoc */
  async continueLatestCampaign(): Promise<void> {
    const campaign = this.latestResumableCampaign;
    if (!campaign) {
      this.warn('continueLatestCampaign:no-resumable-campaign');
      return;
    }

    try {
      await campaignService.loadCampaign({ campaignId: campaign.id });

      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('continueLatestCampaign:failed', error);
      this.errorMessage = 'Failed to load campaign. Try starting a new adventure.';
    }
  }

  /** @inheritdoc */
  openLoadCampaign(): void {
    this.showLoadCampaign = true;
  }

  /** @inheritdoc */
  closeLoadCampaign(): void {
    this.showLoadCampaign = false;
  }

  /** @inheritdoc */
  async loadCampaignById(campaignId: string): Promise<void> {
    this.debug('loadCampaignById', { campaignId });

    try {
      await campaignService.loadCampaign({ campaignId });
      this.showLoadCampaign = false;

      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('loadCampaignById:failed', { campaignId, error: String(error) });
      this.errorMessage = 'Failed to load campaign.';
    }
  }

  /** @inheritdoc */
  async startWorldGeneration(): Promise<void> {
    await routerService.goToRoute('worldgen', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async replayTutorial(): Promise<void> {
    // Reset onboarding progress and navigate to game with a fresh arc
    onboardingHintService.resetOnboarding();

    await routerService.goToRoute('game', {
      queryParameters: { tutorial: '1' },
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    this.debug('initialize');

    // C-448: start (or observe) the required-to-play (offline-core) download
    assetPrefetchService.ensureStarted();

    // Load campaigns from IndexedDB
    try {
      await campaignService.refreshCampaigns();
      this._initError = null;
    } catch (error) {
      this._initError = String(error);
      this.warn('initialize:campaign-refresh-failed', error);
      await super.initialize();
      this._showLoadingView = false;
      return;
    }

    // Build campaign summaries
    this._refreshCampaignState();

    // C-334 AC-5: Check for stale session marker (crash recovery)
    try {
      const campaignId = await gameOverlayService.checkSessionMarker();
      if (campaignId) {
        this.recoveryCampaignId = campaignId;
        this.showRecoveryPrompt = true;
        this.debug('initialize:recovery-prompt', { campaignId });
      }
    } catch (error) {
      this.debug('initialize:recovery-check-failed', { error: String(error) });
    }

    await super.initialize();
    this._showLoadingView = false;
  }

  /** Refreshes the campaign summary state from the campaign service. */
  private _refreshCampaignState(): void {
    const campaigns = [...campaignService.campaigns].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    this.campaignSummaries = campaigns.map(toCampaignSummary);

    // Find the latest resumable campaign (newest first from service)
    const resumable = campaigns.find(isResumable);
    this.latestResumableCampaign = resumable ? toCampaignSummary(resumable) : undefined;

    this.debug('_refreshCampaignState', {
      total: campaigns.length,
      resumable: this.latestResumableCampaign?.id,
    });
  }

  /** @inheritdoc */
  async goToOptions(): Promise<void> {
    await routerService.goToRoute('settings', {
      queryParameters: { from: 'start' },
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  showCreditsModal(): void {
    this.showCredits = true;
  }

  /** @inheritdoc */
  hideCreditsModal(): void {
    this.showCredits = false;
  }

  /** @inheritdoc */
  retry(): void {
    window.location.reload();
  }

  /** @inheritdoc */
  get creditGroups(): readonly CreditGroup[] {
    return CREDIT_GROUPS;
  }

  /** @inheritdoc */
  async quitApp(): Promise<void> {
    if (!this.isTauri) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (error) {
      this.debug('quitApp:error', { error: String(error) });
    }
  }

  /** @inheritdoc */
  async acceptRecovery(): Promise<void> {
    if (this.isRecovering || !this.recoveryCampaignId) {
      return;
    }

    this.isRecovering = true;

    try {
      // Find the most recent save for the crashed campaign
      await gameSaveService.fetchAvailableSaves(this.recoveryCampaignId);
      const saves = gameSaveService.availableSaves;

      if (saves.length === 0) {
        // No saves — just clear the marker and show start screen
        await gameOverlayService.clearSessionMarker();
        this.showRecoveryPrompt = false;
        this.debug('acceptRecovery:no-saves-for-campaign');
        return;
      }

      const latestSave = saves[0];
      this.debug('acceptRecovery', { slotId: latestSave.id, mapName: latestSave.mapName });

      // Clear the session marker before navigating
      await gameOverlayService.clearSessionMarker();

      // Dismiss the recovery prompt before navigating
      this.showRecoveryPrompt = false;

      // Navigate to /game with the campaign from the save
      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('acceptRecovery:failed', { error: String(error) });
      this.errorMessage = 'Failed to recover session. Try starting a new adventure.';
    } finally {
      this.isRecovering = false;
    }
  }

  /** @inheritdoc */
  async declineRecovery(): Promise<void> {
    // C-334 AC-5: Clear the session marker silently
    await gameOverlayService.clearSessionMarker();
    this.showRecoveryPrompt = false;
    this.recoveryCampaignId = undefined;
    this.debug('declineRecovery');
  }

  // ── Pack Browser Methods (C-345) ──

  /** @inheritdoc */
  async openPackBrowser(): Promise<void> {
    try {
      // Load the pack registry
      await packRegistryService.refresh();

      this.availablePacks = [...packRegistryService.availablePacks];

      if (this.availablePacks.length <= 1) {
        // Single pack or empty — skip browser, proceed directly
        const packId = this.availablePacks.length === 1 ? this.availablePacks[0].id : 'emberwatch';
        await this._proceedWithPack(packId);
        return;
      }

      // Multiple packs — show browser
      this.selectedPackId = this.availablePacks[0].id;
      this.showPackBrowser = true;
    } catch (error) {
      this.error('openPackBrowser:failed', error);
      this.errorMessage = 'Failed to load content packs. Try starting a new adventure.';
    }
  }

  /** @inheritdoc */
  closePackBrowser(): void {
    this.showPackBrowser = false;
    this.selectedPackId = undefined;
  }

  /** @inheritdoc */
  selectPack(packId: string): void {
    this.selectedPackId = packId;
  }

  /** @inheritdoc */
  async confirmPackSelection(): Promise<void> {
    if (!this.selectedPackId) {
      return;
    }

    const packId = this.selectedPackId;
    this.showPackBrowser = false;
    this.selectedPackId = undefined;

    await this._proceedWithPack(packId);
  }

  /**
   * Proceeds with campaign creation using the given pack ID.
   * Routes to persona creation (onboarding) for character creation.
   */
  private async _proceedWithPack(packId: string): Promise<void> {
    await this._startCampaignWithPack({ packId, logKey: '_proceedWithPack' });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getStartViewModel = (options: StartViewModelOptions): StartViewModelInterface =>
  StartViewModel.create({ ...options, startWithLoadingView: true } as StartViewModelOptions);
