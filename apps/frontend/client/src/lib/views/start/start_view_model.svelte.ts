// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
//
// ViewModel for the root Start Menu — campaign-first hierarchy.
// Bridges CampaignService (campaign lifecycle), AuthService (Firebase auth),
// RouterService (SPA navigation), and Tauri window API (desktop quit).
// Supports optional Google Sign-In — the game is fully functional without it.
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas

import {
  CONTENT_PACK_LABELS,
  RESUMABLE_CAMPAIGN_STATES,
  UNKNOWN_CONTENT_PACK_LABEL,
} from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { Campaign, CapabilityProfile } from '@aikami/types';
import {
  aiSettingsService,
  authService,
  campaignService,
  equipmentService,
  gameModeService,
  inventoryService,
  playerStateService,
  routerService,
  worldStateService,
} from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Display-ready summary of a campaign for the start menu. */
export type CampaignSummary = {
  /** Campaign ID. */
  id: string;
  /** Display name. */
  name: string;
  /** ISO timestamp of last save, or undefined if never saved. */
  lastSavedAt: string | undefined;
  /** Human-readable last-saved label ("Not yet saved" when never saved). */
  lastSavedLabel: string;
  /** Content pack display label. */
  contentPackLabel: string;
  /** Whether the campaign is resumable (state is playing, paused, or saving). */
  isResumable: boolean;
  /** Whether the campaign is in the failed state (load blocked). */
  isFailed: boolean;
  /** Whether the campaign is mid-setup (creating) — resumes at /setup. */
  isCreating: boolean;
  /** AI capability indicators. */
  capabilities: CapabilityProfile;
};

export type StartViewModelOptions = BaseViewModelOptions;

export type StartViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is currently signed in. */
  readonly isLoggedIn: boolean;

  /** Whether running inside Tauri (desktop). */
  readonly isTauri: boolean;

  /** Whether a Google sign-in or sign-out is in progress. */
  readonly isSigningIn: boolean;

  /** The logged-in player's display name, or undefined. */
  readonly playerDisplayName: string | undefined;

  /** Whether the credits modal is visible. */
  readonly showCredits: boolean;

  /** Whether the missing AI text provider advisory dialog is visible. */
  readonly showMissingProvidersDialog: boolean;

  /** Whether the Load Campaign modal is visible. */
  readonly showLoadCampaignModal: boolean;

  /** Whether the destructive New Adventure confirmation dialog is visible. */
  readonly showNewAdventureConfirm: boolean;

  /** All campaigns as display-ready summaries, sorted newest first. */
  readonly campaignSummaries: readonly CampaignSummary[];

  /** The latest resumable campaign summary, or undefined. */
  readonly latestResumableCampaign: CampaignSummary | undefined;

  /** Whether at least one resumable campaign exists (Continue visibility). */
  readonly hasResumableCampaign: boolean;

  /** Whether any campaigns exist at all (Load Campaign enablement). */
  readonly hasCampaigns: boolean;

  /** Whether the campaign list failed to load (degraded state). */
  readonly campaignsLoadFailed: boolean;

  /** Ordered menu item IDs for keyboard/gamepad focus navigation. */
  readonly menuItemIds: readonly string[];

  /** Continue the latest resumable campaign. */
  continueLatestCampaign(): Promise<void>;

  /** Start a New Adventure — always creates a fresh campaign draft. */
  startNewAdventure(): Promise<void>;

  /** Confirms the destructive New Adventure action. */
  confirmNewAdventure(): Promise<void>;

  /** Cancels the destructive New Adventure confirmation. */
  cancelNewAdventure(): void;

  /** Opens the Load Campaign modal. */
  openLoadCampaign(): void;

  /** Closes the Load Campaign modal. */
  closeLoadCampaign(): void;

  /** Loads a specific campaign by ID and routes appropriately. */
  loadCampaignById(campaignId: string): Promise<void>;

  /** Proceeds with New Adventure despite missing AI providers (advisory). */
  proceedWithoutProviders(): Promise<void>;

  /** Moves keyboard/gamepad focus to the next/previous menu item. */
  moveFocus(direction: 1 | -1): void;

  /** Activates the currently focused menu item (gamepad A / Enter). */
  activateFocused(): Promise<void>;

  /** Signs in with Google (optional). Updates to "Sign Out" when logged in. */
  loginWithGoogle(): Promise<void>;

  /** Signs out the current user. */
  signOut(): Promise<void>;

  /** Navigates to the options/settings screen. */
  goToOptions(): Promise<void>;

  /** Opens the credits modal. */
  showCreditsModal(): void;

  /** Closes the credits modal. */
  hideCreditsModal(): void;

  /** Opens the missing providers dialog. */
  openMissingProvidersDialog(): void;

  /** Closes the missing providers dialog. */
  closeMissingProvidersDialog(): void;

  /** Navigates to the settings page for provider configuration. */
  goToSettingsForProviderSetup(): Promise<void>;

  /** Credit groups for the credits modal. */
  readonly creditGroups: readonly CreditGroup[];

  /** Quits the desktop app (Tauri only). */
  quitApp(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Credit data (inline — reused from game/credits for the modal)
// ---------------------------------------------------------------------------

type CreditGroup = {
  readonly heading: string;
  readonly items: CreditItem[];
};

type CreditItem = {
  readonly name: string;
  readonly url: string;
  readonly description: string;
};

const CREDIT_GROUPS: CreditGroup[] = [
  {
    heading: 'Game Engine & ECS',
    items: [
      {
        name: 'PixiJS',
        url: 'https://pixijs.com/',
        description: '2D WebGL rendering engine powering the game world and visual effects.',
      },
      {
        name: 'bitECS',
        url: 'https://bitecs.dev/',
        description:
          'Entity-Component-System architecture driving all game logic and entity management.',
      },
    ],
  },
  {
    heading: 'Frontend Framework',
    items: [
      {
        name: 'Svelte',
        url: 'https://svelte.dev/',
        description:
          'UI framework for the menu system, HUD overlays, and reactive state management.',
      },
      {
        name: 'Tailwind CSS',
        url: 'https://tailwindcss.com/',
        description: 'Utility-first CSS framework for responsive styling across the entire app.',
      },
      {
        name: 'daisyUI',
        url: 'https://daisyui.com/',
        description: 'UI component library built on Tailwind CSS providing themed components.',
      },
    ],
  },
  {
    heading: 'Desktop Application',
    items: [
      {
        name: 'Tauri',
        url: 'https://v2.tauri.app/',
        description:
          'Desktop application framework wrapping the web frontend in a native Rust shell.',
      },
    ],
  },
  {
    heading: 'Assets',
    items: [
      {
        name: 'Universal LPC Spritesheet Character Generator',
        url: 'https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator',
        description:
          'Liberated Pixel Cup character sprites and asset generation for in-game characters.',
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a Campaign to a display-ready summary for the start menu. */
const toCampaignSummary = (campaign: Campaign): CampaignSummary => ({
  id: campaign.id,
  name: campaign.name,
  lastSavedAt: campaign.lastSavedAt,
  lastSavedLabel: campaign.lastSavedAt
    ? new Date(campaign.lastSavedAt).toLocaleString()
    : 'Not yet saved',
  contentPackLabel: CONTENT_PACK_LABELS[campaign.contentPackId] ?? UNKNOWN_CONTENT_PACK_LABEL,
  isResumable: RESUMABLE_CAMPAIGN_STATES.includes(campaign.state),
  isFailed: campaign.state === 'failed',
  isCreating: campaign.state === 'creating',
  capabilities: campaign.capabilityProfile,
});

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class StartViewModel
  extends BaseViewModel<StartViewModelOptions>
  implements StartViewModelInterface
{
  /** Private — tracks sign-in/sign-out progress to prevent double-clicks. */
  private _isSigningIn = $state(false);

  /** Whether the campaign list failed to load from IndexedDB. */
  campaignsLoadFailed = $state(false);

  /** Whether the credits modal is currently visible. */
  showCredits = $state(false);

  /** Whether the missing AI text provider advisory dialog is visible. */
  showMissingProvidersDialog = $state(false);

  /** Whether the Load Campaign modal is visible. */
  showLoadCampaignModal = $state(false);

  /** Whether the destructive New Adventure confirmation dialog is visible. */
  showNewAdventureConfirm = $state(false);

  /** Index of the currently focused menu item (keyboard/gamepad). */
  focusedIndex = $state(0);

  /** @inheritdoc */
  get isLoggedIn(): boolean {
    return authService.isLoggedIn;
  }

  /** @inheritdoc */
  get isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  /** @inheritdoc */
  get isSigningIn(): boolean {
    return this._isSigningIn;
  }

  /** @inheritdoc */
  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  /** @inheritdoc */
  get campaignSummaries(): readonly CampaignSummary[] {
    return campaignService.campaigns.map(toCampaignSummary);
  }

  /** @inheritdoc */
  get latestResumableCampaign(): CampaignSummary | undefined {
    return this.campaignSummaries.find((summary) => summary.isResumable);
  }

  /** @inheritdoc */
  get hasResumableCampaign(): boolean {
    return this.latestResumableCampaign !== undefined;
  }

  /** @inheritdoc */
  get hasCampaigns(): boolean {
    return this.campaignSummaries.length > 0;
  }

  /** @inheritdoc */
  get menuItemIds(): readonly string[] {
    const ids: string[] = [];
    if (this.hasResumableCampaign) {
      ids.push('continue');
    }
    ids.push('new-adventure', 'load-campaign', 'settings', 'account', 'credits');
    if (this.isTauri) {
      ids.push('quit');
    }
    return ids;
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    try {
      await campaignService.refreshCampaigns();
      this.campaignsLoadFailed = false;
      this.debug('initialize:campaigns-loaded', {
        count: campaignService.campaigns.length,
      });
    } catch (error) {
      this.warn('initialize:campaign-load-failed', error);
      this.campaignsLoadFailed = true;
    }

    await super.initialize();
  }

  // -------------------------------------------------------------------------
  // Campaign-first flow
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async continueLatestCampaign(): Promise<void> {
    const latest = this.latestResumableCampaign;
    if (!latest) {
      this.warn('continueLatestCampaign:no-resumable-campaign');
      return;
    }

    try {
      await campaignService.loadCampaign({ campaignId: latest.id });
      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('continueLatestCampaign:failed', error);
      this.errorMessage = 'Failed to load campaign. Try Load Campaign or start a new adventure.';
    }
  }

  /** @inheritdoc */
  async startNewAdventure(): Promise<void> {
    // Soft advisory: no text provider configured — show dialog, allow proceed.
    if (!this._hasTextProvider() && !this.showMissingProvidersDialog) {
      this.showMissingProvidersDialog = true;
      return;
    }

    // Destructive confirmation when a resumable campaign exists.
    if (this.hasResumableCampaign) {
      this.showNewAdventureConfirm = true;
      return;
    }

    await this._createNewAdventure();
  }

  /** @inheritdoc */
  async confirmNewAdventure(): Promise<void> {
    this.showNewAdventureConfirm = false;
    await this._createNewAdventure();
  }

  /** @inheritdoc */
  cancelNewAdventure(): void {
    this.showNewAdventureConfirm = false;
  }

  /** @inheritdoc */
  async proceedWithoutProviders(): Promise<void> {
    this.showMissingProvidersDialog = false;

    if (this.hasResumableCampaign) {
      this.showNewAdventureConfirm = true;
      return;
    }

    await this._createNewAdventure();
  }

  /** @inheritdoc */
  openLoadCampaign(): void {
    this.showLoadCampaignModal = true;
  }

  /** @inheritdoc */
  closeLoadCampaign(): void {
    this.showLoadCampaignModal = false;
  }

  /** @inheritdoc */
  async loadCampaignById(campaignId: string): Promise<void> {
    const summary = this.campaignSummaries.find((s) => s.id === campaignId);
    if (!summary) {
      this.warn('loadCampaignById:not-found', { campaignId });
      return;
    }

    // Failed campaigns cannot be loaded — surface an error instead.
    if (summary.isFailed) {
      this.debug('loadCampaignById:failed-campaign-blocked', { campaignId });
      this.errorMessage = 'This campaign failed to load previously and cannot be resumed.';
      return;
    }

    // Interrupted setup — resume character creation instead of loading.
    if (summary.isCreating) {
      this.showLoadCampaignModal = false;
      await routerService.goToRoute('setup', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
      return;
    }

    try {
      await campaignService.loadCampaign({ campaignId });
      this.showLoadCampaignModal = false;
      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('loadCampaignById:failed', error);
      this.errorMessage = 'Failed to load campaign.';
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard / gamepad focus management
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  moveFocus(direction: 1 | -1): void {
    const count = this.menuItemIds.length;
    if (count === 0) {
      return;
    }
    this.focusedIndex = (this.focusedIndex + direction + count) % count;
    this._applyDomFocus();
  }

  /** @inheritdoc */
  async activateFocused(): Promise<void> {
    const id = this.menuItemIds[this.focusedIndex];
    switch (id) {
      case 'continue':
        await this.continueLatestCampaign();
        return;
      case 'new-adventure':
        await this.startNewAdventure();
        return;
      case 'load-campaign':
        this.openLoadCampaign();
        return;
      case 'settings':
        await this.goToOptions();
        return;
      case 'account':
        if (this.isLoggedIn) {
          await this.signOut();
        } else {
          await this.loginWithGoogle();
        }
        return;
      case 'credits':
        this.showCreditsModal();
        return;
      case 'quit':
        await this.quitApp();
        return;
      default:
        return;
    }
  }

  /** Focuses the DOM button matching the focused menu item ID. */
  private _applyDomFocus(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const id = this.menuItemIds[this.focusedIndex];
    const element = document.querySelector<HTMLElement>(`[data-menu-item="${id}"]`);
    element?.focus();
  }

  // -------------------------------------------------------------------------
  // Auth / secondary actions
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async loginWithGoogle(): Promise<void> {
    if (this._isSigningIn) {
      return;
    }

    this._isSigningIn = true;
    authService.setIsChangingAuthState(true);

    try {
      await authService.socialSignIn('google');
    } catch (error) {
      this.debug('loginWithGoogle:error', { error: String(error) });
    } finally {
      authService.setIsChangingAuthState(false);
      this._isSigningIn = false;
    }
  }

  /** @inheritdoc */
  async signOut(): Promise<void> {
    if (this._isSigningIn) {
      return;
    }

    this._isSigningIn = true;

    try {
      await authService.signOut();
    } catch (error) {
      this.debug('signOut:error', { error: String(error) });
    } finally {
      this._isSigningIn = false;
    }
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
  openMissingProvidersDialog(): void {
    this.showMissingProvidersDialog = true;
  }

  /** @inheritdoc */
  closeMissingProvidersDialog(): void {
    this.showMissingProvidersDialog = false;
  }

  /** @inheritdoc */
  async goToSettingsForProviderSetup(): Promise<void> {
    this.showMissingProvidersDialog = false;
    await routerService.goToRoute('settings', {
      queryParameters: { from: 'start' },
      pathParameters: undefined,
    });
  }

  /**
   * Returns the credit groups for the credits modal.
   * Public getter so the View can iterate groups.
   */
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

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Creates a fresh campaign draft and routes to /setup for character
   * creation. Clears stale in-memory game state first.
   */
  private async _createNewAdventure(): Promise<void> {
    try {
      await campaignService.startNewCampaign();
    } catch (error) {
      this.error('_createNewAdventure:failed', error);
      this.errorMessage = 'Failed to start a new adventure. Please try again.';
      return;
    }

    // Clear any stale state from a previous play session
    inventoryService.reset();
    worldStateService.reset();
    playerStateService.reset();
    equipmentService.reset();
    gameModeService.reset();

    await routerService.goToRoute('setup', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /**
   * Returns true if a text AI provider is configured.
   * Checks for a non-empty API key (cloud provider) or a localhost
   * endpoint with a model name (local text service).
   */
  private _hasTextProvider(): boolean {
    const { textProvider } = aiSettingsService;

    // Cloud provider with a configured API key
    if (textProvider.apiKey) {
      return true;
    }

    // Local text service: endpoint is a localhost URL with a model name
    if (textProvider.endpoint?.includes('localhost') && textProvider.model) {
      return true;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getStartViewModel = (options: StartViewModelOptions): StartViewModelInterface =>
  StartViewModel.create(options);
