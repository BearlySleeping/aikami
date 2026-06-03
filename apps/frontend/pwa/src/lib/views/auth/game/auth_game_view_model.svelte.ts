// apps/frontend/pwa/src/lib/views/auth/game/auth-game-view-model.svelte.ts
import type { SocialSignInError } from '@aikami/frontend/services';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { toAppError, toAppErrorFromUnknownError } from '@aikami/utils';
import { authService } from '$services';

type AuthState = 'idle' | 'signing_in' | 'success' | 'error' | 'handoff_complete';

export type AuthGameViewModelOptions = BaseViewModelOptions;

export type AuthGameViewModelInterface = BaseViewModelInterface & {
  /**
   * The current authentication state.
   */
  readonly authState: AuthState;

  /**
   * The Firebase ID token retrieved after successful authentication.
   */
  readonly idToken: string;

  /**
   * The email input value for email/password sign-in.
   */
  email: string;

  /**
   * The password input value for email/password sign-in.
   */
  password: string;

  /**
   * Whether the token has been copied to the clipboard.
   */
  readonly copied: boolean;

  /**
   * Whether the page was opened from the Godot game.
   */
  readonly isGameAuth: boolean;

  /**
   * The device flow auth code from the URL (e.g., `?code=ABC123`).
   */
  readonly gameCode: string | null;

  /**
   * Whether a postMessage can be sent to the opener window.
   */
  readonly canPostMessage: boolean;

  /**
   * Handles Google sign-in for game authentication.
   */
  handleGoogleSignIn(): Promise<void>;

  /**
   * Handles email/password sign-in for game authentication.
   */
  handleEmailSignIn(): Promise<void>;

  /**
   * Copies the ID token to the clipboard.
   */
  copyToken(): Promise<void>;

  /**
   * Closes the current window.
   */
  closeWindow(): void;

  /**
   * Resets the auth state to idle and clears any error.
   */
  resetToIdle(): void;
};

class AuthGameViewModel
  extends BaseViewModel<AuthGameViewModelOptions>
  implements AuthGameViewModelInterface
{
  private _authState = $state<AuthState>('idle');
  private _idToken = $state('');
  private _email = $state('');
  private _password = $state('');
  private _copied = $state(false);

  get authState(): AuthState {
    return this._authState;
  }

  get idToken(): string {
    return this._idToken;
  }

  get email(): string {
    return this._email;
  }

  set email(value: string) {
    this._email = value;
  }

  get password(): string {
    return this._password;
  }

  set password(value: string) {
    this._password = value;
  }

  get copied(): boolean {
    return this._copied;
  }

  get isGameAuth(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const params = new URLSearchParams(window.location.search);
    return params.has('game') || params.has('code');
  }

  get gameCode(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    return params.get('code');
  }

  get canPostMessage(): boolean {
    return typeof window !== 'undefined' && !!window.opener;
  }

  async initialize(): Promise<void> {
    this.debug('initialize');

    const isOldGameParam =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('game');
    if (!this.isGameAuth) {
      window.location.href = '/login';
      return;
    }

    // Device flow: redirect from old `?game` to new `?code=` based flow is handled
    // by this method; no redirect needed — just proceed.
    void isOldGameParam; // keep unused variable to signal intent

    await super.initialize();
  }

  async handleGoogleSignIn(): Promise<void> {
    this.debug('handleGoogleSignIn');
    this._authState = 'signing_in';
    this.errorMessage = undefined;

    try {
      const response = await authService.socialSignIn('google');

      if (response.status === 'failed') {
        const payload = response.payload as SocialSignInError;
        throw toAppError({
          errorType: 'unauthorized',
          errorMessage: payload.message || 'Google sign-in failed',
        });
      }

      if (response.status !== 'exitingUser') {
        throw toAppError({
          errorType: 'not-found',
          errorMessage: 'No user returned from Google sign-in',
        });
      }

      await this._completeAuth();
    } catch (err) {
      this.error('Google sign-in failed', err);
      this.errorMessage = toAppErrorFromUnknownError(err).message;
      this._authState = 'error';
    }
  }

  async handleEmailSignIn(): Promise<void> {
    this.debug('handleEmailSignIn');

    if (!this._email || !this._password) {
      this.errorMessage = 'Please enter email and password';
      return;
    }

    this._authState = 'signing_in';
    this.errorMessage = undefined;

    try {
      const result = await authService.signInWithEmailAndPassword({
        email: this._email,
        password: this._password,
      });

      if (!result.success) {
        throw (
          result.error ??
          toAppError({
            errorType: 'unauthorized',
            errorMessage: 'Invalid email or password',
          })
        );
      }

      await this._completeAuth();
    } catch (err) {
      this.error('Email sign-in failed', err);
      this.errorMessage = toAppErrorFromUnknownError(err).message;
      this._authState = 'error';
    }
  }

  async copyToken(): Promise<void> {
    this.debug('copyToken');

    try {
      await navigator.clipboard.writeText(this._idToken);
      this._copied = true;
      setTimeout(() => {
        this._copied = false;
      }, 2000);
    } catch (err) {
      this.error('Failed to copy token', err);
      this.errorMessage = 'Failed to copy token to clipboard';
    }
  }

  closeWindow(): void {
    this.debug('closeWindow');
    window.close();
  }

  resetToIdle(): void {
    this.debug('resetToIdle');
    this._authState = 'idle';
    this.errorMessage = undefined;
  }

  private async _completeAuth(): Promise<void> {
    this.debug('completeAuth');

    try {
      const token = await authService.getIdToken();
      const uid = authService.currentUser?.id;

      if (!token) {
        throw toAppError({
          errorType: 'internal',
          errorMessage: 'Failed to retrieve authentication token',
        });
      }

      this._idToken = token;
      this._authUid = uid || '';

      const code = this.gameCode;

      if (code) {
        // Device Flow: write custom token to Firestore for the game to pick up
        await this._completeHandoff(code, uid || '');
      } else {
        // Legacy flow: show token for copy / postMessage
        this._authState = 'success';
        this._sendTokenToOpener(token);
      }
    } catch (err) {
      this.error('Failed to complete authentication', err);
      this.errorMessage = toAppErrorFromUnknownError(err).message;
      this._authState = 'error';
    }
  }

  /**
   * Completes the device flow handoff by calling the server action
   * to mint a custom token and write it to Firestore.
   */
  private async _completeHandoff(code: string, uid: string): Promise<void> {
    this.debug('completeHandoff', { code, uid });

    const formData = new FormData();
    formData.append('code', code);
    formData.append('uid', uid);

    const response = await fetch('?/completeHandoff', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw toAppError({
        errorType: 'internal',
        errorMessage: (errorBody as { message?: string }).message || 'Handoff failed',
      });
    }

    this._authState = 'handoff_complete';
  }

  /**
   * Sends the ID token to the opener window via postMessage (legacy flow).
   */
  private _sendTokenToOpener(token: string): void {
    if (typeof window === 'undefined' || !window.opener) {
      return;
    }

    const origin = new URLSearchParams(window.location.search).get('origin') || '*';
    window.opener.postMessage({ type: 'GAME_AUTH_SUCCESS', token }, origin);
  }
}

export const getAuthGameViewModel = (
  options: AuthGameViewModelOptions,
): AuthGameViewModelInterface => new AuthGameViewModel(options);
