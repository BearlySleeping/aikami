// apps/frontend/hub/src/lib/client/services/api/auth.svelte.ts
//
// Hub auth service backed by Better Auth (session cookie) instead of Firebase
// Auth. The hub's server (hooks.server.ts) resolves the session from the
// Better Auth cookie and seeds `currentUser` via SSR; this client service
// re-checks the session on initialize(), performs Google sign-in via a
// full-page redirect to the Better Auth social handler, and signs out by
// clearing the session cookie.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { CurrentUser } from '@aikami/types';
import {
  getBetterAuthSession,
  signInWithGoogleRedirect,
  signOutBetterAuth,
} from './better_auth_client.ts';

export type AuthServiceOptions = BaseFrontendClassOptions;

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

  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }
    this._initialized = true;

    try {
      // Re-resolve the Better Auth session (cookie-based). SSR has already
      // seeded currentUser from the session cookie; this confirms/refreshes it
      // on the client and clears it if the session is no longer valid.
      const user = await getBetterAuthSession();
      this.setCurrentUser(user);
    } catch (error) {
      this.error('initialize', error);
      this.currentUser = undefined;
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.debug('signInWithGoogle');
    this.isGoogleSigningIn = true;
    // Full-page redirect to the Better Auth social handler. The page
    // navigates away; on return the session cookie is set and hooks.server.ts
    // resolves the user, routing them to the dashboard.
    signInWithGoogleRedirect();
  }

  async signOut(): Promise<void> {
    this.log('signOut');
    try {
      await signOutBetterAuth();
    } catch (error) {
      this.error('signOut', error);
    }
    this.setCurrentUser(undefined, true);
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

    // Same user — merge updated data, preserving UI-only fields that may not
    // be on the new object.
    user.currentSignInProvider ||= currentUser.currentSignInProvider;
    user.photoURL ||= currentUser.photoURL;
    user.displayName ||= currentUser.displayName;
    this.currentUser = user;
  }

  async getIdToken(): Promise<string | undefined> {
    // Better Auth has no Firebase ID token — the hub's session is cookie-based.
    return undefined;
  }
}

export const authService: AuthServiceInterface = AuthService.create({
  className: 'AuthService',
});
