// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
//
// ViewModel for the root Start Menu. Bridges AuthService (Firebase auth),
// RouterService (SPA navigation), and Tauri window API (desktop quit).
// Supports optional Google Sign-In — the game is fully functional without it.
// Contract: C-334 Crash Detection Recovery (AC-5)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PackIndexEntry } from '@aikami/types';
import {
  authService,
  campaignService,
  equipmentService,
  gameModeService,
  gameOverlayService,
  gameSaveService,
  inventoryService,
  packRegistryService,
  personaService,
  playerStateService,
  routerService,
  worldStateService,
} from '$services';
import type { SaveSlotInfo } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StartViewModelOptions = BaseViewModelOptions;

export type StartViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is currently signed in. */
  readonly isLoggedIn: boolean;

  /** Whether running inside Tauri (desktop). */
  readonly isTauri: boolean;

  /** Whether a Google sign-in or sign-out is in progress. */
  readonly isSigningIn: boolean;

  /** An initialization error message, or null when initialized successfully. */
  readonly initError: string | null;

  /** The logged-in player's display name, or undefined. */
  readonly playerDisplayName: string | undefined;

  /** Whether the credits modal is visible. */
  readonly showCredits: boolean;

  /** Whether there are existing IndexedDB saves available. */
  readonly hasSaves: boolean;

  /** Available save slots from IndexedDB (sorted newest first). */
  readonly availableSaves: readonly SaveSlotInfo[];

  /** C-334 AC-5: Whether a crash recovery prompt should be shown. */
  readonly showRecoveryPrompt: boolean;

  /** C-334 AC-5: The campaign ID from the stale session marker. */
  readonly recoveryCampaignId: string | undefined;

  /** C-334 AC-5: Whether a recovery action is in progress. */
  readonly isRecovering: boolean;

  /** Start a New Game with Emberwatch — resets state and routes to character creation. */
  startNewGame(): Promise<void>;

  /** Continue the most recent saved game. */
  continueGame(): Promise<void>;

  /** @deprecated Use {@link startNewGame} instead. */
  startGame(): Promise<void>;

  /** Signs in with Google (optional). Updates to "Sign Out" when logged in. */
  loginWithGoogle(): Promise<void>;

  /** Signs out the current user. */
  signOut(): Promise<void>;

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
// ViewModel
// ---------------------------------------------------------------------------

class StartViewModel
  extends BaseViewModel<StartViewModelOptions>
  implements StartViewModelInterface
{
  /** Private — tracks sign-in/sign-out progress to prevent double-clicks. */
  private _isSigningIn = $state(false);

  /** Initialization error message — null when initialization succeeded. */
  private _initError = $state<string | null>(null);

  /** Whether there are existing IndexedDB saves. */
  hasSaves = $state(false);

  /** Available save slots from IndexedDB (sorted newest first). */
  availableSaves: SaveSlotInfo[] = $state([]);

  /** Whether the credits modal is currently visible. */
  showCredits = $state(false);

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
  get initError(): string | null {
    return this._initError;
  }

  /** @inheritdoc */
  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  /** @inheritdoc */
  async startNewGame(): Promise<void> {
    // Campaign generation is beta; default to Emberwatch directly.
    await this._proceedWithPack('emberwatch');
  }

  /** @inheritdoc */
  async continueGame(): Promise<void> {
    if (this.availableSaves.length === 0) {
      this.warn('continueGame:no-saves');
      return;
    }

    // Load the most recent save (sorted newest first)
    const latestSave = this.availableSaves[0];
    const campaignId = latestSave.campaignId;

    try {
      if (campaignId) {
        // C-334 AC-3: Load the campaign first, then the boot pipeline handles the save
        await campaignService.loadCampaign({ campaignId });
      }

      await routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('continueGame:failed', error);
      this.errorMessage = 'Failed to load save. Try starting a new game.';
    }
  }

  /** @inheritdoc @deprecated */
  async startGame(): Promise<void> {
    return this.startNewGame();
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    this.debug('initialize');

    // Check for existing campaigns
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

    // Check IndexedDB for existing game saves
    try {
      await gameSaveService.fetchAvailableSaves();
      this.availableSaves = gameSaveService.availableSaves;
      this.hasSaves = this.availableSaves.length > 0;
      this.debug('initialize:saves-checked', {
        count: this.availableSaves.length,
      });
    } catch (error) {
      this.warn('initialize:save-check-failed', error);
      this.hasSaves = false;
    }

    await super.initialize();
    this._showLoadingView = false;
  }

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
  retry(): void {
    window.location.reload();
  }

  /**
   * Returns the credit groups for the credits modal.
   * Public getter so the View can iterate groups.
   */
  get creditGroups(): readonly CreditGroup[] {
    return CREDIT_GROUPS;
  }

  /**
   * Returns the number of saved characters in localStorage.
   * Used to determine the New Game flow: 0→/setup, 1→/game, 2+→/characters.
   */
  private _getCharacterCount(): number {
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (!stored) {
        return 0;
      }
      const characters = JSON.parse(stored) as unknown[];
      return Array.isArray(characters) ? characters.length : 0;
    } catch {
      return 0;
    }
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
      this.errorMessage = 'Failed to recover session. Try starting a new game.';
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
      this.errorMessage = 'Failed to load content packs. Try starting a new game.';
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
   * Handles existing-character branching from the original startNewGame logic.
   */
  private async _proceedWithPack(packId: string): Promise<void> {
    try {
      // Check for existing characters from previous sessions
      const characterCount = this._getCharacterCount();

      if (characterCount === 1) {
        // One character — load it directly into /game with this pack
        inventoryService.reset();
        worldStateService.reset();
        playerStateService.reset();
        equipmentService.reset();
        gameModeService.reset();

        try {
          const stored = localStorage.getItem('aikami-characters');
          if (stored) {
            const characters = JSON.parse(stored) as Array<{ persona: { id: string } }>;
            if (characters.length > 0) {
              try {
                await personaService.setActivePersona(characters[0].persona.id);
              } catch {
                // Non-critical
              }
            }
          }
        } catch (error) {
          this.warn('_proceedWithPack:persona-set-failed', error);
        }

        await campaignService.startNewCampaign({ contentPackId: packId });
        campaignService.completeSetup();
        await routerService.goToRoute('game', {
          queryParameters: undefined,
          pathParameters: undefined,
        });
        return;
      }

      if (characterCount > 1) {
        // Multiple characters — create campaign, let user choose character
        await campaignService.startNewCampaign({ contentPackId: packId });
        await routerService.goToRoute('personas', {
          queryParameters: undefined,
          pathParameters: undefined,
        });
        return;
      }

      // Zero characters — go to character creation with pack selected
      inventoryService.reset();
      worldStateService.reset();
      playerStateService.reset();
      equipmentService.reset();
      gameModeService.reset();

      await campaignService.startNewCampaign({ contentPackId: packId });

      await routerService.goToRoute('setup', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('_proceedWithPack:failed', error);
      this.errorMessage = 'Failed to start campaign. Try starting a new game.';
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getStartViewModel = (options: StartViewModelOptions): StartViewModelInterface =>
  StartViewModel.create({ ...options, startWithLoadingView: true } as StartViewModelOptions);
