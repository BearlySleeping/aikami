// apps/frontend/game/src/lib/services/firebase/auth.ts
/**
 * Firebase Auth module for the game client — REST-based, no Firebase SDK.
 * Uses browser fetch + localStorage for session persistence.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/core/base_game_class.ts';
import { getConfig } from './config.ts';
import type { FirebaseHttpClientInterface } from './http_client.ts';

const SESSION_KEY = 'aikami_firebase_auth_session';

/**
 * Raw response from Firebase Auth REST API (sign-up / sign-in).
 */
type AuthApiResponse = {
  idToken?: string;
  email?: string;
  localId?: string;
  refreshToken?: string;
  expiresIn?: string;
  error?: {
    code: number;
    message: string;
  };
};

/**
 * Authenticated Firebase user for the game client.
 */
export type FirebaseUser = {
  uid: string;
  email: string | null;
  idToken: string;
  refreshToken: string;
};

export type FirebaseAuthOptions = BaseGameClassOptions & {
  http: FirebaseHttpClientInterface;
};

export type FirebaseAuthInterface = BaseGameClassInterface & {
  readonly currentUser: FirebaseUser | null;
  readonly isAuthenticated: boolean;
  clearSession(): void;
  signInAnonymous(): Promise<FirebaseUser | null>;
  signInWithEmail(email: string, password: string): Promise<FirebaseUser | null>;
  signUpWithEmail(email: string, password: string): Promise<FirebaseUser | null>;
  signInWithCustomToken(customToken: string): Promise<FirebaseUser | null>;
  signOut(): void;
};

/**
 * Service for Firebase Authentication via REST API.
 */
class FirebaseAuth extends BaseGameClass<FirebaseAuthOptions> implements FirebaseAuthInterface {
  private _currentUser: FirebaseUser | null = null;
  private readonly _http: FirebaseHttpClientInterface;

  constructor(options: FirebaseAuthOptions) {
    super(options);
    this._http = options.http;
    this._restoreSession();
  }

  /** Currently authenticated user, or null if not signed in. */
  get currentUser(): FirebaseUser | null {
    return this._currentUser;
  }

  /** Whether a user is currently signed in. */
  get isAuthenticated(): boolean {
    return this._currentUser !== null;
  }

  // ── Session Persistence (localStorage) ──────────────────────

  /**
   * Restores the auth session from localStorage.
   */
  private _restoreSession(): void {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        return;
      }

      const data = JSON.parse(raw) as FirebaseUser;
      if (data.uid && data.idToken) {
        this._currentUser = data;
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  /**
   * Saves the current auth session to localStorage.
   */
  private _saveSession(): void {
    if (!this._currentUser) {
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(this._currentUser));
  }

  /**
   * Clears the saved auth session.
   */
  clearSession(): void {
    this._currentUser = null;
    localStorage.removeItem(SESSION_KEY);
  }

  // ── Auth Methods ────────────────────────────────────────────

  /**
   * Signs in anonymously using Firebase Auth REST API.
   * @returns Authenticated user or null on failure
   */
  async signInAnonymous(): Promise<FirebaseUser | null> {
    const config = getConfig();
    const url = `${config.authEndpoint}/accounts:signUp?key=${config.apiKey}`;

    try {
      const result = await this._http.post(url, { returnSecureToken: true });
      const data = result.body as AuthApiResponse;

      if (data.error) {
        return null;
      }

      this._currentUser = {
        uid: data.localId || '',
        email: null,
        idToken: data.idToken || '',
        refreshToken: data.refreshToken || '',
      };
      this._saveSession();
      return this._currentUser;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Signs in with email and password.
   * @param email - User email
   * @param password - User password
   * @returns Authenticated user or null on failure
   */
  async signInWithEmail(email: string, password: string): Promise<FirebaseUser | null> {
    const config = getConfig();
    const url = `${config.authEndpoint}/accounts:signInWithPassword?key=${config.apiKey}`;

    try {
      const result = await this._http.post(url, {
        email,
        password,
        returnSecureToken: true,
      });
      const data = result.body as AuthApiResponse;

      if (data.error) {
        return null;
      }

      this._currentUser = {
        uid: data.localId || '',
        email: data.email || email,
        idToken: data.idToken || '',
        refreshToken: data.refreshToken || '',
      };
      this._saveSession();
      return this._currentUser;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Signs up with email and password.
   * @param email - User email
   * @param password - User password
   * @returns Authenticated user or null on failure
   */
  async signUpWithEmail(email: string, password: string): Promise<FirebaseUser | null> {
    const config = getConfig();
    const url = `${config.authEndpoint}/accounts:signUp?key=${config.apiKey}`;

    try {
      const result = await this._http.post(url, {
        email,
        password,
        returnSecureToken: true,
      });
      const data = result.body as AuthApiResponse;

      if (data.error) {
        return null;
      }

      this._currentUser = {
        uid: data.localId || '',
        email: data.email || email,
        idToken: data.idToken || '',
        refreshToken: data.refreshToken || '',
      };
      this._saveSession();
      return this._currentUser;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Signs in with a custom token obtained from the PWA auth handoff.
   * @param customToken - Firebase custom token
   * @returns Authenticated user or null on failure
   */
  async signInWithCustomToken(customToken: string): Promise<FirebaseUser | null> {
    const config = getConfig();
    const url = `${config.authEndpoint}/accounts:signInWithCustomToken?key=${config.apiKey}`;

    try {
      const result = await this._http.post(url, {
        token: customToken,
        returnSecureToken: true,
      });
      const data = result.body as AuthApiResponse;

      if (data.error) {
        return null;
      }

      // signInWithCustomToken does NOT return localId in the response.
      // Extract uid from the idToken JWT's `sub` claim instead.
      const uid = data.localId || this._decodeJwtSub(data.idToken || '');

      this._currentUser = {
        uid,
        email: data.email || null,
        idToken: data.idToken || '',
        refreshToken: data.refreshToken || '',
      };
      this._saveSession();
      return this._currentUser;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Decodes the `sub` claim from a JWT payload without verifying the signature.
   */
  private _decodeJwtSub(jwt: string): string {
    try {
      const payload = jwt.split('.')[1];
      if (!payload) {
        return '';
      }
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return decoded.sub || '';
    } catch {
      return '';
    }
  }

  /**
   * Signs out and clears the session.
   */
  signOut(): void {
    this.clearSession();
  }

  override async setup(): Promise<void> {
    this.debug('setup');
  }
}

export const getFirebaseAuth = (options: FirebaseAuthOptions): FirebaseAuthInterface =>
  new FirebaseAuth(options);
