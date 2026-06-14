// apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService } from '$services';

export type MenuViewModelOptions = BaseViewModelOptions & {
  /** Called when the player clicks "Start" to begin the game. */
  onStart: () => void;

  /** Called when the player clicks "Options". */
  onOptions: () => void;

  /** Called when the player clicks "Credits". */
  onCredits: () => void;
};

export type MenuViewModelInterface = BaseViewModelInterface & {
  /** Whether the user is currently signed in. */
  readonly isLoggedIn: boolean;

  /** Whether running inside Tauri (desktop). */
  readonly isTauri: boolean;

  /** Whether a Google sign-in is in progress. */
  readonly isSigningIn: boolean;

  /** The logged-in player's display name, or undefined. */
  readonly playerDisplayName: string | undefined;

  /** Starts the game — works offline without login. */
  startGame(): void;

  /** Signs in with Google (optional). */
  loginWithGoogle(): Promise<void>;

  /** Navigates to the options screen. */
  goToOptions(): void;

  /** Navigates to the credits screen. */
  goToCredits(): void;

  /** Quits the desktop app (Tauri only). */
  quitApp(): Promise<void>;
};

class MenuViewModel extends BaseViewModel<MenuViewModelOptions> implements MenuViewModelInterface {
  private _isSigningIn = $state(false);

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
  startGame(): void {
    this._options.onStart();
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
  goToOptions(): void {
    this._options.onOptions();
  }

  /** @inheritdoc */
  goToCredits(): void {
    this._options.onCredits();
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

export const getMenuViewModel = (options: MenuViewModelOptions): MenuViewModelInterface =>
  MenuViewModel.create(options);
