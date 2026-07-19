// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
//
// ViewModel for the root Start Menu. Bridges AuthService (Firebase auth),
// RouterService (SPA navigation), and Tauri window API (desktop quit).
// Supports optional Google Sign-In — the game is fully functional without it.
// Contract: C-323 Enforce the Mandatory Text AI Capability Gate (AC-3)
// Contract: C-334 Crash Detection Recovery (AC-5)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { GameOverlayService } from '$lib/services/game/game_overlay_service.svelte';
import { personaService } from '$lib/services/persona/persona_repository.svelte';
import type { SaveSlotInfo } from '$services';
import {
  aiGatewayService,
  authService,
  campaignService,
  equipmentService,
  gameModeService,
  gameSaveService,
  inventoryService,
  playerStateService,
  routerService,
  worldStateService,
} from '$services';

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

  /** Start a New Game — resets state and routes to character creation. */
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

  /** C-334 AC-5: Whether recovery was accepted (vs declined). */
  private _recoveryAccepted = false;

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
  async startNewGame(): Promise<void> {
    if (!this._resolveTextProvider()) {
      // @ts-expect-error — 'capability' route not yet registered in routes config
      await routerService.goToRoute('capability', {
        queryParameters: { reason: 'text-required' },
        pathParameters: undefined,
      });
      return;
    }

    // Check for existing characters from previous sessions
    const characterCount = this._getCharacterCount();

    if (characterCount === 1) {
      // One character — load it directly into /game
      await this._startWithExistingCharacter();
      return;
    }

    if (characterCount > 1) {
      // Multiple characters — let the user choose
      await routerService.goToRoute('characters', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
      return;
    }

    // Zero characters — go to character creation
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
   * Loads the single existing character as the active persona and navigates
   * to /game. Called when exactly one saved character exists.
   */
  private async _startWithExistingCharacter(): Promise<void> {
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (!stored) {
        return;
      }
      const characters = JSON.parse(stored) as Array<{ persona: { id: string } }>;
      if (characters.length === 0) {
        return;
      }

      const characterId = characters[0].persona.id;

      // Set as active persona if logged in, so the game can find it
      try {
        await personaService.setActivePersona(characterId);
      } catch {
        // Non-critical — GameViewModel falls back to localStorage
      }
    } catch (error) {
      this.warn('_startWithExistingCharacter:persona-set-failed', error);
    }

    // Clear any stale state from a previous play session
    inventoryService.reset();
    worldStateService.reset();
    playerStateService.reset();
    equipmentService.reset();
    gameModeService.reset();

    await routerService.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async continueGame(): Promise<void> {
    if (!this._resolveTextProvider()) {
      // @ts-expect-error — 'capability' route not yet registered in routes config
      await routerService.goToRoute('capability', {
        queryParameters: { reason: 'text-required' },
        pathParameters: undefined,
      });
      return;
    }

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

    // C-334 AC-5: Check for stale session marker (crash recovery)
    try {
      const campaignId = await GameOverlayService.checkSessionMarker();
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

  /**
   * Resolves whether a text AI provider is available via the gateway.
   * Returns true when the gateway can resolve a text generation mode.
   * On failure (no provider configured, gateway throws), returns false.
   */
  private _resolveTextProvider(): boolean {
    try {
      aiGatewayService.resolveMode('text');
      return true;
    } catch {
      return false;
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
    this._recoveryAccepted = true;

    try {
      // Find the most recent save for the crashed campaign
      await gameSaveService.fetchAvailableSaves(this.recoveryCampaignId);
      const saves = gameSaveService.availableSaves;

      if (saves.length === 0) {
        // No saves — just clear the marker and show start screen
        await GameOverlayService.clearSessionMarker();
        this.showRecoveryPrompt = false;
        this.debug('acceptRecovery:no-saves-for-campaign');
        return;
      }

      const latestSave = saves[0];
      this.debug('acceptRecovery', { slotId: latestSave.id, mapName: latestSave.mapName });

      // Clear the session marker before navigating
      await GameOverlayService.clearSessionMarker();

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
    await GameOverlayService.clearSessionMarker();
    this.showRecoveryPrompt = false;
    this.recoveryCampaignId = undefined;
    this.debug('declineRecovery');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getStartViewModel = (options: StartViewModelOptions): StartViewModelInterface =>
  StartViewModel.create(options);
