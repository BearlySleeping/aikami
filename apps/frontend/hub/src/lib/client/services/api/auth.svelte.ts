import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  type FirebaseAuthServiceInterface,
  firebaseAuthService,
} from '@aikami/frontend/services';
import type { CurrentUser, FirebaseUser } from '@aikami/types';
import { getUserLiteData } from '@aikami/utils';
import { internalAPIService } from './internal.svelte.ts';

export type AuthServiceOptions = BaseFrontendClassOptions & {
  auth: FirebaseAuthServiceInterface;
};

export type AuthServiceInterface = BaseFrontendClassInterface & {
  readonly currentUser: CurrentUser | undefined;
  readonly isGoogleSigningIn: boolean;
  readonly isLoggedIn: boolean;
  readonly uid: string | undefined;

  setCurrentUser(user: CurrentUser | undefined, onlyIfEmpty?: boolean): void;
  initialize(): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getIdToken(): Promise<string | undefined>;
};

export class AuthService
  extends BaseFrontendClass<AuthServiceOptions>
  implements AuthServiceInterface
{
  currentUser = $state<CurrentUser | undefined>();
  isGoogleSigningIn = $state(false);

  get isLoggedIn(): boolean {
    return !!this.currentUser;
  }

  get uid(): string | undefined {
    return this.currentUser?.id;
  }

  private _initialized = false;
  /** SSR hydration guard: skip first null (IndexedDB not yet restored). */
  private _initialAuthResolved = false;
  private _currentToken: string | undefined;
  /** Sequential gate for token sync — only one network request at a time. */
  private _tokenUpdatePromise: Promise<void> | null = null;

  private get _auth(): FirebaseAuthServiceInterface {
    return this._options.auth;
  }

  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    try {
      await this._auth.onIdTokenChanged(
        async (user) => {
          await this.setAuthUser(user);
        },
        (error) => {
          this.error(error.message);
          this.currentUser = undefined;
        },
      );
    } catch (error) {
      this.error('initialize', error);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.debug('signInWithGoogle');
    this.isGoogleSigningIn = true;
    try {
      const response = await this._auth.signInWithPopup('google.com');
      if (response.status === 'failed') {
        const rawMessage =
          'message' in response.payload && typeof response.payload.message === 'string'
            ? response.payload.message
            : 'Google sign-in failed';

        // The Firebase blocking function (before_sign_in) throws a
        // permission-denied HttpsError when the user is not authorized.
        // Firebase wraps it as auth/internal-error and appends the
        // error code suffix, e.g.:
        //   "Your account has not been authorized yet..." (auth/internal-error).
        // Strip the suffix and provide a clean admin-appropriate message.
        const cleaned = rawMessage.replace(/\s*\(auth\/[^)]+\)\.?$/, '').trim();

        const code =
          'code' in response.payload && typeof response.payload.code === 'string'
            ? response.payload.code
            : undefined;

        if (
          code === 'auth/internal-error' &&
          /permission|denied|authorized|waitlist/i.test(cleaned)
        ) {
          throw new Error(
            'Your Google account is not authorized to access the admin area. ' +
              'Please contact the system administrator to add your email to the approved list.',
          );
        }

        throw new Error(cleaned || 'Google sign-in failed');
      }
      const currentUser = await this._auth.getAuthUser();
      if (currentUser) {
        await this.setAuthUser(currentUser);

        // Force token refresh to pick up custom claims (e.g. userRole)
        // set by the session endpoint after checking admin_emails.
        // Without this, currentUser retains stale claims from the
        // initial ID token and the ViewModel's superAdmin check fails.
        await this.setAuthUser(currentUser, true);
      }
    } finally {
      this.isGoogleSigningIn = false;
    }
  }

  async signOut(): Promise<void> {
    this.log('signOut');
    await this._auth.signOut();
    await this.setAuthUser(undefined, true);
  }

  setCurrentUser(user: CurrentUser | undefined, onlyIfEmpty = false): void {
    if (onlyIfEmpty && this.currentUser) {
      return;
    }
    const currentUser = this.currentUser;

    if (!currentUser || !user || user.id !== currentUser.id) {
      this.currentUser = user;
      return;
    }

    // Same user — merge updated data (e.g. userRole from custom claims),
    // preserving UI-only fields that may not be on the new object.
    user.currentSignInProvider ||= currentUser.currentSignInProvider;
    user.photoURL ||= currentUser.photoURL;
    user.displayName ||= currentUser.displayName;
    user.phoneNumber ||= currentUser.phoneNumber;
    this.currentUser = user;
  }

  async getIdToken(): Promise<string | undefined> {
    try {
      const user = await this._auth.getAuthUser();
      if (!user) {
        return;
      }
      // No forceRefresh — avoids infinite onIdTokenChanged loop
      return await this._auth.getIdToken(user);
    } catch (error) {
      this.error('getIdToken', error);
      return;
    }
  }

  // ─── Private helpers ────────────────────────────────────────

  private async setAuthUser(user: FirebaseUser | undefined, forceRefresh?: boolean): Promise<void> {
    // SSR hydration guard
    if (!user && !this._initialAuthResolved) {
      this.debug('setAuthUser:skipped (pending session restore)');
      return;
    }
    this._initialAuthResolved = true;

    await this._setToken(user, forceRefresh);

    if (!user) {
      this.setCurrentUser(undefined);
      return;
    }

    const userDataLite = await getUserLiteData({ user });
    this.setCurrentUser(userDataLite);
  }

  /** Sequential gate for token sync. */
  private async _setToken(user: FirebaseUser | undefined, forceRefresh?: boolean): Promise<void> {
    const prev = this._tokenUpdatePromise;
    const current = (async () => {
      if (prev) {
        await prev;
      }
      await this._doSetToken(user, forceRefresh);
    })();
    this._tokenUpdatePromise = current;
    try {
      await current;
    } finally {
      if (this._tokenUpdatePromise === current) {
        this._tokenUpdatePromise = null;
      }
    }
  }

  private _decodeTokenClaims(token: string): { sub: string; authTime: number; iat: number } | null {
    try {
      const payloadB64 = token.split('.')[1];
      if (!payloadB64) {
        return null;
      }
      const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(base64));
      return { sub: claims.sub, authTime: claims.auth_time, iat: claims.iat };
    } catch {
      return null;
    }
  }

  private _tokenFingerprint(token: string): string {
    const claims = this._decodeTokenClaims(token);
    if (!claims) {
      return `raw:${token}`;
    }
    return `${claims.sub}|${claims.authTime}|${claims.iat}`;
  }

  /**
   * Syncs the Firebase ID token (or clears it) with the backend session.
   * The token is only cached after the backend sync succeeds, so a failed
   * sync never leaves a stale client-side token.
   */
  private async _doSetToken(user: FirebaseUser | undefined, forceRefresh?: boolean): Promise<void> {
    let token: string | undefined;
    try {
      token = user ? await this._auth.getIdToken(user, forceRefresh) : undefined;
    } catch (error) {
      this.warn('_setToken: failed to get ID token', error);
      return;
    }

    if (!forceRefresh) {
      if (token === this._currentToken) {
        return;
      }
      if (token && this._currentToken) {
        if (this._tokenFingerprint(token) === this._tokenFingerprint(this._currentToken)) {
          this._currentToken = token;
          return;
        }
      }
    }

    try {
      await internalAPIService.setToken(token);
    } catch (error) {
      this.warn('_setToken: failed to sync with backend', error);
      // Don't cache a token the backend does not have.
      this._currentToken = undefined;
      return;
    }

    this._currentToken = token;
  }
}

export const authService: AuthServiceInterface = AuthService.create({
  auth: firebaseAuthService,
  className: 'AuthService',
});
