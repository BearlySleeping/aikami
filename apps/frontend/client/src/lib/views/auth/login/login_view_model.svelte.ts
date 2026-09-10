// apps/frontend/client/src/lib/views/auth/login/login_view_model.svelte.ts
//
// Shared LoginViewModel — the single source of truth for the Google
// sign-in / sign-out control used by the start menu, the in-game menu, and
// the /link device-handoff page. Owns the in-progress spinner state and
// sign-in error surfacing; the actual auth state lives on the injected auth
// capability (the real source of truth), so any view rendering <LoginView />
// reactively reflects sign-in changes.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/login_fixtures.ts). Production
// wiring lives in ./login_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { isTauri as defaultIsTauri } from '$lib/views/utils/is_tauri';

// ── Capability contracts ────────────────────────────────────────────────

/** The identity fields the login control displays. */
export type LoginUser = {
  readonly displayName?: string;
  readonly email?: string;
};

/** The sign-in outcome the control reacts to. */
export type LoginSignInResponse =
  | { readonly status: 'exitingUser'; readonly payload: unknown }
  | {
      readonly status: 'failed';
      readonly payload: { readonly message?: string; readonly code?: string };
    };

/** The auth operations and observable state the login control reads. */
export type LoginAuthCapabilities = {
  readonly isLoggedIn: boolean;
  readonly currentUser: LoginUser | undefined;
  socialSignIn(options: { provider: 'google'; callbackURL?: string }): Promise<LoginSignInResponse>;
  signOut(): Promise<unknown>;
};

// ── Types ───────────────────────────────────────────────────────────────

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

export type LoginViewModelOptions = BaseViewModelOptions & {
  /** Auth operations and observable state. */
  auth: LoginAuthCapabilities;
  /** Platform probe for the Tauri webview. Defaults to the real `isTauri()`. */
  isTauri?: () => boolean;
  /** Current URL provider for the OAuth callback. Defaults to `window.location`. */
  currentUrl?: () => { pathname: string; href: string };
};

// ── Implementation ──────────────────────────────────────────────────────

const defaultCurrentUrl = (): { pathname: string; href: string } => {
  if (typeof window !== 'undefined' && window.location) {
    return { pathname: window.location.pathname, href: window.location.href };
  }
  return { pathname: '', href: '' };
};

class LoginViewModel
  extends BaseViewModel<LoginViewModelOptions>
  implements LoginViewModelInterface
{
  private readonly _auth: LoginAuthCapabilities;
  private readonly _isTauri: () => boolean;
  private readonly _currentUrl: () => { pathname: string; href: string };

  /** Private — tracks sign-in/sign-out progress to prevent double-clicks. */
  private _isSigningIn = $state(false);

  constructor(options: LoginViewModelOptions) {
    super(options);
    this._auth = options.auth;
    this._isTauri = options.isTauri ?? defaultIsTauri;
    this._currentUrl = options.currentUrl ?? defaultCurrentUrl;
  }

  /** @inheritdoc */
  get isSigningIn(): boolean {
    return this._isSigningIn;
  }

  /** @inheritdoc */
  get isLoggedIn(): boolean {
    return this._auth.isLoggedIn;
  }

  /** @inheritdoc */
  get playerDisplayName(): string | undefined {
    return this._auth.currentUser?.displayName || this._auth.currentUser?.email || undefined;
  }

  /** @inheritdoc */
  get signInLabel(): string {
    return this._isTauri() ? 'Sign In' : 'Sign In with Google';
  }

  /** @inheritdoc */
  async signIn(): Promise<void> {
    if (this._isSigningIn) {
      return;
    }

    this._isSigningIn = true;
    this.errorMessage = undefined;

    // C-449 AC-6: when on the /link route, pass the current URL as callbackURL
    // so the OAuth redirect returns to the link page with the code intact
    // instead of falling back to the default callback (/).
    const { pathname, href } = this._currentUrl();
    const callbackURL = pathname === '/link' ? href : undefined;

    try {
      const response = await this._auth.socialSignIn({ provider: 'google', callbackURL });
      // socialSignIn uses a full-page redirect in the browser (the Tauri
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
      await this._auth.signOut();
    } catch (error) {
      this.debug('signOut:error', { error: String(error) });
    } finally {
      this._isSigningIn = false;
    }
  }
}

/**
 * Builds a login ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getLoginViewModel` in ./login_composition.ts.
 */
export const createLoginViewModel = (options: LoginViewModelOptions): LoginViewModelInterface =>
  LoginViewModel.create(options);
