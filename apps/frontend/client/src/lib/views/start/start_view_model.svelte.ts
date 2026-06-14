// apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts
//
// ViewModel for the root Start Menu. Bridges AuthService (Firebase auth),
// RouterService (SPA navigation), and Tauri window API (desktop quit).
// Supports optional Google Sign-In — the game is fully functional without it.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { aiSettingsService, authService, routerService } from '$services';

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

  /** Whether the missing AI text provider dialog is visible. */
  readonly showMissingProvidersDialog: boolean;

  /** Start the game — checks for a configured text AI provider before proceeding. */
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
// ViewModel
// ---------------------------------------------------------------------------

class StartViewModel
  extends BaseViewModel<StartViewModelOptions>
  implements StartViewModelInterface
{
  /** Private — tracks sign-in/sign-out progress to prevent double-clicks. */
  private _isSigningIn = $state(false);

  /** Whether the credits modal is currently visible. */
  showCredits = $state(false);

  /** Whether the missing AI text provider dialog is visible. */
  showMissingProvidersDialog = $state(false);

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
  async startGame(): Promise<void> {
    if (!this._hasTextProvider()) {
      this.showMissingProvidersDialog = true;
      return;
    }

    await routerService.goToRoute('setup', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
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
      queryParameters: undefined,
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
      queryParameters: undefined,
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
    if (
      textProvider.endpoint &&
      textProvider.endpoint.includes('localhost') &&
      textProvider.model
    ) {
      return true;
    }

    return false;
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getStartViewModel = (options: StartViewModelOptions): StartViewModelInterface =>
  StartViewModel.create(options);
