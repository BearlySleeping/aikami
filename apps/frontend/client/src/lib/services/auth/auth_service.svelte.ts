// apps/frontend/client/src/lib/services/api/auth.svelte.ts
//
// Desktop (Tauri) social sign-in note: Firebase's authorized-domains check
// rejects the Tauri webview's origin outright for signInWithPopup/
// signInWithRedirect, so socialSignIn() detects Tauri and hands off to a
// device-link flow instead — see _linkDeviceSignIn():
//   1. Generate a random code, open DEVICE_LINK_URL (a real, authorized
//      domain) with it in the system browser via the opener plugin.
//   2. That page (apps/frontend/client/src/routes/link) signs in normally,
//      then calls the existing completeDeviceHandoff endpoint to mint a
//      custom token keyed by the code.
//   3. _awaitDeviceHandoffToken() races a poll loop against a Tauri deep-
//      link event for that same code — whichever notices first calls
//      signInWithCustomToken. See src-tauri/src/lib.rs for the Rust half.
import {
  type AuthProviderId,
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  type FirebaseAuthServiceInterface,
  firebaseAuthService,
  firebaseFunctionsService,
  type SocialSignInError,
  type SocialSignInResponse,
} from '@aikami/frontend/services';
import type {
  AppResult,
  AuthMessageData,
  AuthMessageResponse,
  AuthMessageType,
  CurrentUser,
  FirebaseSignInProviderName,
  FirebaseUser,
  RegisterForm,
} from '@aikami/types';
import { getUserLiteData, toAppErrorFromUnknownError } from '@aikami/utils';
import { isTauri } from '$lib/views/utils/is_tauri';
import { analyticService } from '../analytics/analytics_service.svelte.ts';

/**
 * Where the desktop app sends users to sign in — a normal page load of the
 * web build, which (unlike the Tauri webview) is a Firebase-authorized
 * domain, so signInWithPopup/signInWithRedirect work there unmodified.
 * Kept in sync with `customDomains.production.client` in
 * scripts/src/lib/deploy/deployment_config.ts.
 */
const DEVICE_LINK_URL = 'https://aikami.bearlysleeping.com/link';

/** How often to poll for the token while waiting on the /link browser tab. */
const DEVICE_LINK_POLL_INTERVAL_MS = 2000;

/** Give up waiting for the browser-tab sign-in after this long. */
const DEVICE_LINK_TIMEOUT_MS = 5 * 60 * 1000;

export type AuthServiceOptions = BaseFrontendClassOptions & {
  auth: FirebaseAuthServiceInterface;
};

export type AuthServiceInterface = BaseFrontendClassInterface & {
  /**
   * The currently signed-in user.
   */
  readonly currentUser: CurrentUser | undefined;

  /**
   * Whether Firebase Auth has completed its initial auth state resolution.
   * Before this is true, redirects based on auth state should be suppressed.
   */
  readonly isAuthReady: boolean;

  /**
   * Whether a user is currently signed in.
   */
  readonly isLoggedIn: boolean;

  /**
   * The UID of the currently signed-in user.
   */
  readonly uid: string | undefined;

  /**
   * Sets the current user.
   * @param user The user to set.
   * @param onlyIfEmpty If true, the user will only be set if there is no current user.
   */
  setCurrentUser(user: CurrentUser | undefined, onlyIfEmpty?: boolean): void;

  /**
   * Initializes Firebase Auth and resolves the initial user state.
   * Returns the current user (or undefined) before setting up the
   * reactive listener for future auth state changes.
   */
  initialize(): Promise<CurrentUser | undefined>;

  /**
   * Signs in a user with email and password.
   * @param options The sign-in options.
   * @returns A promise that resolves with true if the sign-in was successful, false otherwise.
   */
  signInWithEmailAndPassword(options: { email: string; password: string }): Promise<AppResult>;

  /**
   * Signs in a user anonymously.
   * @returns A promise that resolves with true if the sign-in was successful, false otherwise.
   */
  signInAnonymously(): Promise<boolean>;

  /**
   * Signs out the current user.
   * @returns A promise that resolves with true if the sign-out was successful, false otherwise.
   */
  signOut(): Promise<boolean>;

  /**
   * Signs in a user with a social provider.
   * @param provider The social provider to use.
   * @returns A promise that resolves with the social sign-in response.
   */
  socialSignIn(provider: FirebaseSignInProviderName): Promise<SocialSignInResponse>;

  /**
   * Registers a new user.
   * @param registerForm The registration form data.
   * @returns A promise that resolves with true if the registration was successful, false otherwise.
   */
  registerUser(registerForm: RegisterForm): Promise<boolean>;

  /**
   * Sends a password reset email to a user.
   * @param email The user's email address.
   * @returns A promise that resolves with true if the email was sent successfully, false otherwise.
   */
  sendPasswordResetEmail(email: string): Promise<boolean>;

  /**
   * Gets the ID token of the current user.
   * @returns A promise that resolves with the ID token, or undefined if there is no current user.
   */
  getIdToken(): Promise<string | undefined>;

  /**
   * Sets whether the auth state is currently changing.
   * @param value The value to set.
   */
  setIsChangingAuthState(value: boolean): void;

  /**
   * Completes a device-flow authentication handoff for game clients.
   * Creates a custom Firebase token and writes it to Firestore at
   * `device_handoffs/{code}` so the game can retrieve it.
   *
   * @returns The custom Firebase sign-in token.
   */
  completeDeviceHandoff(options: {
    code: string;
    uid: string;
  }): Promise<{ customFirebaseSignInToken: string }>;
};

export class AuthService
  extends BaseFrontendClass<AuthServiceOptions>
  implements AuthServiceInterface
{
  currentUser = $state<CurrentUser | undefined>();
  isAuthReady = $state(false);
  isLoggedIn = $derived(!!this.currentUser);
  uid = $derived(this.currentUser?.id);

  /**
   * Whether the auth state is currently changing.
   * This is used to prevent multiple auth state changes from happening at the same time.
   */
  private _isChangingAuthState = false;

  private _initialized = false;

  /**
   * The single in-flight initialize() promise. Cached so concurrent callers
   * (AppViewModel, LinkViewModel, …) all await the SAME initialization
   * instead of getting `currentUser` (usually still undefined) back early —
   * which previously let one-shot checks like the /link handoff trigger run
   * before auth had actually resolved.
   */
  private _initPromise: Promise<CurrentUser | undefined> | undefined;

  private get _auth(): FirebaseAuthServiceInterface {
    return this._options.auth;
  }

  async initialize(): Promise<CurrentUser | undefined> {
    this.log('initialize');
    if (!this._initPromise) {
      this._initPromise = this._initializeOnce();
    }
    return await this._initPromise;
  }

  private async _initializeOnce(): Promise<CurrentUser | undefined> {
    try {
      if (this._initialized) {
        return this.currentUser;
      }
      this._initialized = true;

      // Register onIdTokenChanged and capture the initial auth state.
      // Firebase Auth resolves the initial state asynchronously (IndexedDB),
      // so getAuthUser() returns null until the first callback fires.
      const initialUser = await new Promise<FirebaseUser | undefined>((resolve) => {
        let firstCall = true;

        this._auth.onIdTokenChanged(
          async (user) => {
            if (this._isChangingAuthState) {
              return;
            }

            if (firstCall) {
              firstCall = false;
              resolve(user);
              return;
            }

            await this.setAuthUser(user);
          },
          (error) => {
            this.error(error.message);
            this.currentUser = undefined;
            if (firstCall) {
              firstCall = false;
              resolve(undefined);
            }
          },
        );
      });

      await this.setAuthUser(initialUser);
      this.isAuthReady = true;

      return this.currentUser;
    } catch (error) {
      this.error('initialize', error);
      this.isAuthReady = true;
      return undefined;
    }
  }

  async signInWithEmailAndPassword(options: {
    email: string;
    password: string;
  }): Promise<AppResult> {
    this.log('signInWithEmailAndPassword', options);
    try {
      const user = await this._auth.signInWithEmailAndPassword(options);
      await this.setAuthUser(user);
      return { success: true, data: undefined };
    } catch (error: unknown) {
      // TypeScript defaults to unknown in strict mode
      this.error('signInWithEmailAndPassword', error);

      return {
        success: false,
        error: toAppErrorFromUnknownError(error),
      };
    }
  }

  async signOut(): Promise<boolean> {
    try {
      this.log('signOut');
      await this._auth.signOut();
      await this.setAuthUser(undefined);

      void this.logEvent('logout', undefined);

      return true;
    } catch (error) {
      this.error('signOut', error);
      return false;
    }
  }

  async signInAnonymously(): Promise<boolean> {
    try {
      this.log('signInAnonymously');
      const user = await this._auth.signInAnonymously();
      await this.setAuthUser(user);

      return true;
    } catch (error) {
      this.error('signInAnonymously', error);
      return false;
    }
  }

  async socialSignIn(provider: FirebaseSignInProviderName): Promise<SocialSignInResponse> {
    // Firebase's authorized-domains check rejects the Tauri webview's origin
    // outright for signInWithPopup/signInWithRedirect — this isn't fixable by
    // configuration. Hand off to a browser tab on a real, authorized domain
    // instead. See auth_service.svelte.ts's module doc comment for the
    // mechanism (device-link code + poll/deep-link race).
    if (isTauri()) {
      return this._linkDeviceSignIn();
    }

    const toAuthProviderId = (provider: FirebaseSignInProviderName): AuthProviderId => {
      switch (provider) {
        case 'google':
          return 'google.com';
        case 'github':
          return 'github.com';
        default:
          throw new Error(`Invalid provider: ${provider}`);
      }
    };

    // Popup sign-in is used on every non-Tauri path — same as the hub.
    // The deployed site serves COOP: same-origin-allow-popups and NO COEP
    // (apps/frontend/client/firebase.json), so the cross-origin popup at
    // aikami-production.firebaseapp.com/__/auth/handler keeps `window.opener`
    // and the OAuth helper can relay the result back.
    //
    // This deliberately gives up cross-origin isolation: `crossOriginIsolated`
    // requires COOP to be exactly `same-origin`, which severs the opener and
    // makes the SDK reject with `auth/popup-closed-by-user`. Isolation is only
    // an optimization here — the engine falls back to the N-buffer ArrayBuffer
    // path (engine/src/config/memory_config.ts), sqlite falls back to an
    // IndexedDB-snapshotted DB, and the SharedArrayBuffer TTS streaming
    // pipeline requires a local Kokoro server (see docs/gotchas/cross-origin-isolation.md).
    try {
      const response = await this._auth.signInWithPopup(toAuthProviderId(provider));

      const isFailed = (
        response: SocialSignInResponse,
      ): response is SocialSignInResponse<'failed'> => response.status === 'failed';

      if (isFailed(response)) {
        this.error('socialSignIn:failed', response.payload);
        this.showSnackbar({
          text: `Sign-in failed: ${response.payload.message ?? response.payload.code ?? 'Unknown error'}`,
          type: 'error',
        });
        return response;
      }

      const isExitingUser = (
        response: SocialSignInResponse,
      ): response is SocialSignInResponse<'exitingUser'> => response.status === 'exitingUser';

      if (isExitingUser(response)) {
        await this.setAuthUser(response.payload);
      }

      return response;
    } catch (error) {
      this.error('auth signInWithPopup', error);
      const errMsg: string =
        error instanceof Error
          ? error.message
          : (((error as Record<string, unknown>)?.message as string) ??
            ((error as Record<string, unknown>)?.code as string) ??
            'Unknown error');
      this.showSnackbar({
        text: `Sign-in failed: ${errMsg}`,
        type: 'error',
      });
      const signInError = error as Omit<SocialSignInError, 'emailAlreadyExists'>;
      return {
        payload: {
          ...signInError,
          accountExists: signInError.code === 'auth/account-exists-with-different-credential',
        },
        status: 'failed',
      };
    }
  }

  /**
   * Desktop sign-in: opens the device-link page in the system browser (a
   * real, Firebase-authorized domain) and waits for that tab to complete a
   * normal sign-in and hand back a custom token — via whichever of the
   * poll/deep-link race in {@link _awaitDeviceHandoffToken} resolves first.
   */
  private async _linkDeviceSignIn(): Promise<SocialSignInResponse> {
    const code = crypto.randomUUID();
    const handoffUrl = `${DEVICE_LINK_URL}?code=${code}`;

    try {
      // NOTE: the plugin's JS API is `openUrl` (URLs) / `openPath` (files) —
      // there is no `open` export, and destructuring it silently yields
      // `undefined`, which throws "t is not a function" in the minified
      // release build (the error the user saw on Sign In).
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(handoffUrl);
    } catch (error) {
      // The browser couldn't be opened — don't enter the five-minute token
      // wait; surface the URL so the user can complete sign-in manually.
      this.error('linkDeviceSignIn:openUrl-failed', error);
      const message = `Could not open the sign-in page. Open ${handoffUrl} manually and complete sign-in there.`;
      this.showSnackbar({ text: `Sign-in failed: ${message}`, type: 'error' });
      return {
        status: 'failed',
        payload: {
          code: 'browser-open-failed',
          message,
          email: '',
          accountExists: false,
        } as unknown as SocialSignInError,
      };
    }

    try {
      const token = await this._awaitDeviceHandoffToken(code);
      if (!token) {
        throw new Error('Sign-in timed out — please try again.');
      }

      const user = await this._auth.signInWithCustomToken(token);
      if (!user) {
        throw new Error('Sign-in failed.');
      }
      await this.setAuthUser(user);

      return { status: 'exitingUser', payload: user };
    } catch (error) {
      this.error('linkDeviceSignIn', error);
      const errMsg = error instanceof Error ? error.message : 'Sign-in failed';
      this.showSnackbar({ text: `Sign-in failed: ${errMsg}`, type: 'error' });
      // Nothing currently reads a 'failed' socialSignIn() payload's fields on
      // the Tauri path — this shape only exists to satisfy the interface.
      return {
        status: 'failed',
        payload: {
          code: 'device-handoff-failed',
          message: errMsg,
          email: '',
          accountExists: false,
        } as unknown as SocialSignInError,
      };
    }
  }

  /**
   * Races a ~2s poll loop against a Tauri deep-link event, both hitting the
   * same `poll_device_handoff` callable — whichever asks first wins (the
   * Firestore doc is deleted on read), the other observes null and stops
   * quietly. The deep-link half is best-effort: it's reliably instant on
   * Windows/macOS, but this project ships Linux as an AppImage with no
   * installer step to register the OS URL-scheme association, so polling is
   * the mechanism that actually has to work there.
   */
  private async _awaitDeviceHandoffToken(code: string): Promise<string | null> {
    const exchange = async (): Promise<string | null> => {
      const { customFirebaseSignInToken } = await firebaseFunctionsService.call(
        'poll_device_handoff',
        { code },
      );
      return customFirebaseSignInToken;
    };

    const urlMatchesCode = (url: string): boolean => {
      try {
        return new URL(url).searchParams.get('code') === code;
      } catch {
        return false;
      }
    };

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const unlisteners: Array<() => void> = [];

      const finish = (token: string | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(pollTimer);
        clearTimeout(timeoutTimer);
        for (const unlisten of unlisteners) {
          try {
            unlisten();
          } catch (error) {
            // Listener teardown must never block resolving the token.
            this.debug('_awaitDeviceHandoffToken:unlisten-failed', { error: String(error) });
          }
        }
        unlisteners.length = 0;
        resolve(token);
      };

      /**
       * Stores a listener teardown for finish(), or — if the wait already
       * settled (e.g. the poll finished while the deep-link listener was
       * still registering) — invokes it immediately so it can't leak.
       */
      const registerUnlisten = (unlisten: () => void): void => {
        if (settled) {
          try {
            unlisten();
          } catch (error) {
            this.debug('_awaitDeviceHandoffToken:unlisten-failed', { error: String(error) });
          }
          return;
        }
        unlisteners.push(unlisten);
      };

      const onMatchedUrl = (): void => {
        void exchange()
          .then((token) => {
            // Only finish on a real token — a null result means a racing poll
            // already consumed the handoff, so keep the polling/retry flow
            // alive instead of failing the wait.
            if (token) {
              finish(token);
            }
          })
          .catch((error) => {
            this.debug('_awaitDeviceHandoffToken:deep-link-error', { error: String(error) });
          });
      };

      // Self-scheduling poll: each exchange runs only after the previous one
      // settles, with increasing backoff after the initial attempts.
      const pollBackoffMs = [
        DEVICE_LINK_POLL_INTERVAL_MS,
        DEVICE_LINK_POLL_INTERVAL_MS,
        3000,
        5000,
      ];
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      let pollAttempt = 0;
      const scheduleNextPoll = (): void => {
        if (settled) {
          return;
        }
        const delay = pollBackoffMs[Math.min(pollAttempt, pollBackoffMs.length - 1)];
        pollAttempt += 1;
        pollTimer = setTimeout(async () => {
          try {
            const token = await exchange();
            if (token) {
              finish(token);
              return;
            }
          } catch (error) {
            this.debug('_awaitDeviceHandoffToken:poll-error', { error: String(error) });
          }
          scheduleNextPoll();
        }, delay);
      };
      scheduleNextPoll();

      const timeoutTimer = setTimeout(() => finish(null), DEVICE_LINK_TIMEOUT_MS);

      // macOS/iOS/Android: the deep-link plugin's own event, fired natively
      // by the OS while this instance is already running.
      void (async () => {
        try {
          const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
          const unlisten = await onOpenUrl((urls) => {
            if (urls.some(urlMatchesCode)) {
              onMatchedUrl();
            }
          });
          registerUnlisten(unlisten);
        } catch (error) {
          this.debug('_awaitDeviceHandoffToken:deep-link-listener-failed', {
            error: String(error),
          });
        }
      })();

      // Windows/Linux: the deep-link plugin's docs say `onOpenUrl` doesn't
      // fire natively there — a relaunch instead lands in src-tauri/src/
      // lib.rs's single-instance closure, which forwards the URL via this
      // custom event. Registration failing here is non-fatal either way —
      // the poll loop above is the guaranteed fallback on every platform.
      void (async () => {
        try {
          const { listen } = await import('@tauri-apps/api/event');
          const unlisten = await listen<{ url: string }>('deep-link-received', (event) => {
            if (urlMatchesCode(event.payload.url)) {
              onMatchedUrl();
            }
          });
          registerUnlisten(unlisten);
        } catch (error) {
          this.debug('_awaitDeviceHandoffToken:single-instance-listener-failed', {
            error: String(error),
          });
        }
      })();
    });
  }

  setIsChangingAuthState(value: boolean): void {
    this.log('setIsChangingAuthState', value);
    this._isChangingAuthState = value;
  }

  async registerUser(registerForm: RegisterForm): Promise<boolean> {
    try {
      this.setIsChangingAuthState(true);

      this.log('registerUser', { registerForm });
      const { customFirebaseSignInToken } = await this.callAuthEndpoint({
        payload: {
          registerForm,
          uid: registerForm.uid,
        },
        type: 'register',
      });

      const user = await this._auth.signInWithCustomToken(customFirebaseSignInToken);

      this.log('registerUser', { user });

      await this.setAuthUser(user);

      void this.logEvent('signUp', {
        method: registerForm.signInProvider,
      });
      this.setIsChangingAuthState(false);

      return true;
    } catch (error) {
      this.error('registerUser', error);

      this.setIsChangingAuthState(false);

      return false;
    }
  }

  async sendPasswordResetEmail(email: string): Promise<boolean> {
    this.log('sendPasswordResetEmail', { email });
    try {
      await this._auth.sendPasswordResetEmail(email);
      this.log('Password reset email sent', { email });
      return true;
    } catch (error) {
      this.error('sendPasswordResetEmail', error);
      return false;
    }
  }

  setCurrentUser(user: CurrentUser | undefined, onlyIfEmpty = false): void {
    if (onlyIfEmpty && this.currentUser) {
      return;
    }

    const currentUser = this.currentUser;

    if (!currentUser || !user || user.id !== currentUser.id) {
      this.log('setCurrentUser', { user });
      this.currentUser = user;
      return;
    }

    if (currentUser.currentSignInProvider) {
      user.currentSignInProvider = currentUser.currentSignInProvider;
    }
    if (currentUser.photoURL) {
      user.photoURL = currentUser.photoURL;
    }
    //  if (currentUser.email) {
    // 	user.email = currentUser.email;
    //  }
    if (currentUser.displayName) {
      user.displayName = currentUser.displayName;
    }
    if (currentUser.phoneNumber) {
      user.phoneNumber = currentUser.phoneNumber;
    }

    this.currentUser = user;
    this.log('setCurrentUser', user);
  }

  async getIdToken(): Promise<string | undefined> {
    try {
      const user = await this._auth.getAuthUser();
      if (!user) {
        return;
      }
      return await this._auth.getIdToken(user, true);
    } catch (error) {
      this.error('getIdToken', error);
      return;
    }
  }

  protected async setAuthUser(user: FirebaseUser | undefined): Promise<void> {
    if (!user) {
      this.setCurrentUser(undefined);
      return;
    }

    const userDataLite = await getUserLiteData({
      user,
    });

    this.setCurrentUser(userDataLite);
    analyticService.setAnalyticUser(userDataLite);
  }

  protected async callAuthEndpoint<T extends AuthMessageType>(
    data: AuthMessageData<T>,
  ): Promise<AuthMessageResponse<T>> {
    return await firebaseFunctionsService.call('auth', data);
  }

  async completeDeviceHandoff(options: {
    code: string;
    uid: string;
  }): Promise<{ customFirebaseSignInToken: string }> {
    return await this.callAuthEndpoint({
      type: 'completeDeviceHandoff',
      payload: { code: options.code, uid: options.uid },
    });
  }
}

export const authService: AuthServiceInterface = AuthService.create({
  auth: firebaseAuthService,
  className: 'AuthService',
});
