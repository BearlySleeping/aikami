// apps/frontend/client/src/lib/views/auth/login/login_view_model.svelte.ts
//
// Shared LoginViewModel — the single source of truth for the Google
// sign-in / sign-out control used by the start menu, the in-game menu, and
// the /link device-handoff page. Owns the in-progress spinner state and
// sign-in error surfacing; the actual auth state lives on authService (the
// real source of truth), so any view rendering <LoginView /> reactively
// reflects sign-in changes — the browser popup flow resolves in-place, and
// the Tauri path hands off to the /link device page which resolves on load.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { authService } from '$services';

export type LoginViewModelInterface = BaseViewModelInterface & {
  /** Whether a sign-in or sign-out is in progress. */
  readonly isSigningIn: boolean;

  /** Whether the user is currently signed in. */
  readonly isLoggedIn: boolean;

  /** The logged-in player's display name, or undefined. */
  readonly playerDisplayName: string | undefined;

  /** Button label — "Sign In" inside Tauri, "Sign In with Google" in the browser. */
  readonly signInLabel: string;

  /** Signs in with Google (optional). No-op while a sign-in is in progress. */
  signIn(): Promise<void>;

  /** Signs out the current user. */
  signOut(): Promise<void>;
};

export type LoginViewModelOptions = BaseViewModelOptions;

class LoginViewModel
  extends BaseViewModel<LoginViewModelOptions>
  implements LoginViewModelInterface
{
  /** Private — tracks sign-in/sign-out progress to prevent double-clicks. */
  private _isSigningIn = $state(false);

  /** @inheritdoc */
  get isSigningIn(): boolean {
    return this._isSigningIn;
  }

  /** @inheritdoc */
  get isLoggedIn(): boolean {
    return authService.isLoggedIn;
  }

  /** @inheritdoc */
  get playerDisplayName(): string | undefined {
    return authService.currentUser?.displayName || authService.currentUser?.email || undefined;
  }

  /** @inheritdoc */
  get signInLabel(): string {
    return this.isTauri ? 'Sign In' : 'Sign In with Google';
  }

  /** Same check used by start_view_model.svelte.ts / menu_view_model.svelte.ts's `isTauri` getters. */
  private get isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  /** @inheritdoc */
  async signIn(): Promise<void> {
    if (this._isSigningIn) {
      return;
    }

    this._isSigningIn = true;
    this.errorMessage = undefined;
    authService.setIsChangingAuthState(true);

    try {
      const response = await authService.socialSignIn('google');
      // socialSignIn always uses the popup flow in the browser (the Tauri
      // path hands off to the /link device page instead). Callers that need
      // to act once signed in (e.g. the /link handoff) react to
      // authService.isLoggedIn rather than the response, which covers every
      // path alike.
      if (response.status === 'failed') {
        this.errorMessage = response.payload.message || response.payload.code || 'Sign-in failed';
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Sign-in failed';
      this.debug('signIn:error', { error: String(error) });
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
}

export const getLoginViewModel = (options: LoginViewModelOptions): LoginViewModelInterface =>
  LoginViewModel.create(options);
