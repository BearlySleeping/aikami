// apps/frontend/client/src/lib/services/auth/auth_service.svelte.ts
//
// Desktop (Tauri) social sign-in note: the Tauri webview can't run a Google
// OAuth popup, so socialSignIn() detects Tauri and hands off to the Better
// Auth device-authorization flow instead — see _betterAuthDeviceHandoff():
//   1. Request a device code from the hub, open the /link verification page
//      (a real browser domain) with the user code in the system browser via
//      the opener plugin.
//   2. That page (apps/frontend/client/src/routes/link) signs in normally,
//      then approves the device code.
//   3. _awaitBetterAuthDeviceApproval() polls the hub until the user
//      approves, then adopts the session cookie.
//
// Auth is served entirely by Better Auth (session cookie, backed by D1 on
// the hub). There is no Firebase path.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  AppResult,
  AuthMessageData,
  AuthMessageResponse,
  AuthMessageType,
  CurrentUser,
  FirebaseSignInProviderName,
  RegisterForm,
} from '@aikami/types';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import { isTauri } from '$lib/views/utils/is_tauri';
import { hubApiBase } from '../api/hub_api_client';
import {
  sendPasswordResetEmail as baSendPasswordResetEmail,
  signInWithEmailAndPassword as baSignInWithEmailAndPassword,
  signUpWithEmailAndPassword as baSignUpWithEmailAndPassword,
  getBetterAuthSession,
  pollDeviceHandoff as pollBetterAuthDeviceHandoff,
  signOutBetterAuth,
  socialSignInRedirect,
  startDeviceHandoff,
} from './better_auth_client';

/**
 * Where the desktop app sends users to sign in — a normal page load of the
 * web build, which (unlike the Tauri webview) can run the Better Auth
 * device-authorization verification. Kept in sync with
 * `customDomains.production.client` in
 * scripts/src/lib/deploy/deployment_config.ts.
 */
const DEVICE_LINK_URL = 'https://aikami.bearlysleeping.com/link';

// ---------------------------------------------------------------------------
// Social sign-in result types (previously provided by the Firebase auth
// service; now local to the client's Better Auth path).
// ---------------------------------------------------------------------------

export type SocialSignInError = {
  code?: string;
  message?: string;
  email?: string;
  accountExists?: boolean;
};

export type SocialSignInResponse =
  | { status: 'exitingUser'; payload: CurrentUser }
  | { status: 'failed'; payload: SocialSignInError };

export type AuthServiceOptions = BaseFrontendClassOptions;

export type AuthServiceInterface = BaseFrontendClassInterface & {
  /**
   * The currently signed-in user.
   */
  readonly currentUser: CurrentUser | undefined;

  /**
   * Whether auth has completed its initial state resolution.
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
   * Initializes auth and resolves the initial user state.
   * Returns the current user (or undefined).
   */
  initialize(): Promise<CurrentUser | undefined>;

  /**
   * Signs in a user with email and password.
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
   * Completes a device-flow authentication handoff for game clients.
   * Approves the Better Auth device-authorization code from the /link page.
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
  /**
   * The single in-flight initialize() promise. Cached so concurrent callers
   * (AppViewModel, LinkViewModel, …) all await the SAME initialization
   * instead of getting `currentUser` (usually still undefined) back early.
   */
  private _initPromise: Promise<CurrentUser | undefined> | undefined;

  async initialize(): Promise<CurrentUser | undefined> {
    this.log('initialize');
    this._initPromise ??= this._initializeBetterAuth();
    return await this._initPromise;
  }

  /**
   * Resolve the initial Better Auth session (cookie-based) and hydrate app
   * state. The session is read once and re-checked on demand.
   */
  private async _initializeBetterAuth(): Promise<CurrentUser | undefined> {
    try {
      const user = await getBetterAuthSession();
      this.setCurrentUser(user);
      this.isAuthReady = true;
      return user;
    } catch (error) {
      this.error('initialize:better-auth', error);
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
      const user = await baSignInWithEmailAndPassword(options);
      this.setCurrentUser(user);
      return { success: true, data: undefined };
    } catch (error: unknown) {
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
      await signOutBetterAuth();
      this.setCurrentUser(undefined);
      return true;
    } catch (error) {
      this.error('signOut', error);
      return false;
    }
  }

  async signInAnonymously(): Promise<boolean> {
    // Better Auth has no anonymous sign-in — the desktop save/load dev tool
    // falls back to a normal sign-in instead.
    this.log('signInAnonymously:unsupported');
    return false;
  }

  async socialSignIn(provider: FirebaseSignInProviderName): Promise<SocialSignInResponse> {
    // Browser uses a full-page redirect to the hub's Google OAuth; Tauri (no
    // OAuth popup) uses the device-authorization flow with the same polling
    // UX as before.
    if (!isTauri()) {
      try {
        await socialSignInRedirect(provider as import('@aikami/types').SignInSocialProvider);
      } catch (error) {
        this.error('socialSignIn:redirect', error);
        return {
          status: 'failed',
          payload: {
            code: 'social-signin-failed',
            message: error instanceof Error ? error.message : 'Sign-in failed',
            email: '',
            accountExists: false,
          },
        };
      }
      // The page navigates away; the caller reacts to authService.isLoggedIn
      // after the callback route resolves, so this placeholder is never read.
      return { status: 'exitingUser', payload: this.currentUser as unknown as CurrentUser };
    }
    return this._betterAuthDeviceHandoff();
  }

  /**
   * Tauri device handoff via Better Auth's device-authorization flow.
   * Requests a device code, opens the /link verification page in the system
   * browser, and polls until the user approves.
   */
  private async _betterAuthDeviceHandoff(): Promise<SocialSignInResponse> {
    let deviceCode: string;
    let interval: number;
    let expiresIn: number;
    try {
      const start = await startDeviceHandoff();
      deviceCode = start.deviceCode;
      interval = start.interval;
      expiresIn = start.expiresIn;
      // Open the client's /link page (a real browser domain) with the user
      // code, where the user signs in and approves the device.
      const linkUrl = `${DEVICE_LINK_URL}?code=${encodeURIComponent(start.userCode)}`;
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(linkUrl);
    } catch (error) {
      this.error('betterAuthDeviceHandoff:start', error);
      const message = error instanceof Error ? error.message : 'Could not start device sign-in';
      this.showSnackbar({ text: `Sign-in failed: ${message}`, type: 'error' });
      return {
        status: 'failed',
        payload: {
          code: 'device-handoff-failed',
          message,
          email: '',
          accountExists: false,
        },
      };
    }

    try {
      const user = await this._awaitBetterAuthDeviceApproval(deviceCode, interval, expiresIn);
      if (!user) {
        throw new Error('Sign-in timed out — please try again.');
      }
      this.setCurrentUser(user);
      return { status: 'exitingUser', payload: user };
    } catch (error) {
      this.error('betterAuthDeviceHandoff', error);
      const errMsg = error instanceof Error ? error.message : 'Sign-in failed';
      this.showSnackbar({ text: `Sign-in failed: ${errMsg}`, type: 'error' });
      return {
        status: 'failed',
        payload: {
          code: 'device-handoff-failed',
          message: errMsg,
          email: '',
          accountExists: false,
        },
      };
    }
  }

  /** Poll the hub until the device authorization is approved (or times out). */
  private async _awaitBetterAuthDeviceApproval(
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
  ): Promise<CurrentUser | undefined> {
    const deadline = Date.now() + expiresInSeconds * 1000;
    let delayMs = intervalSeconds * 1000;
    while (Date.now() < deadline) {
      const result = await pollBetterAuthDeviceHandoff(deviceCode);
      if (result?.user) {
        return result.user;
      }
      // RFC 8628: slow_down increases the required polling delay.
      if (result?.slowDown) {
        delayMs = Math.max(delayMs + 5000, delayMs * 1.5);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return undefined;
  }

  async registerUser(registerForm: RegisterForm): Promise<boolean> {
    try {
      this.log('registerUser', { registerForm });
      const user = await baSignUpWithEmailAndPassword({
        name: registerForm.displayName,
        email: registerForm.email,
        password: registerForm.password,
      });
      this.setCurrentUser(user);
      return true;
    } catch (error) {
      this.error('registerUser', error);
      return false;
    }
  }

  async sendPasswordResetEmail(email: string): Promise<boolean> {
    this.log('sendPasswordResetEmail', { email });
    try {
      await baSendPasswordResetEmail(email);
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
    // Better Auth has no Firebase ID token — the session is cookie-based.
    return undefined;
  }

  protected async callAuthEndpoint<T extends AuthMessageType>(
    data: AuthMessageData<T>,
  ): Promise<AuthMessageResponse<T>> {
    // Legacy Firebase-keyed auth actions are not used on the Better Auth
    // path. Kept for interface compatibility; callers must not rely on it.
    void data;
    throw new Error('callAuthEndpoint is not supported on the Better Auth path');
  }

  async completeDeviceHandoff(options: {
    code: string;
    uid: string;
  }): Promise<{ customFirebaseSignInToken: string }> {
    // The device-link code is the device-authorization user code — approve it
    // via the plugin instead of minting a Firebase custom token.
    await this.approveDeviceHandoff(options.code);
    return { customFirebaseSignInToken: '' };
  }

  /**
   * Approve a Better Auth device-authorization code from the /link page.
   * Claims the code (GET /device) then approves it (POST /device/approve)
   * so the polling desktop client can exchange it for a session token.
   */
  async approveDeviceHandoff(userCode: string): Promise<void> {
    const base = hubApiBase();
    // Claim the code for the signed-in user (idempotent).
    await fetch(`${base}/auth/device?user_code=${encodeURIComponent(userCode)}`, {
      method: 'GET',
      credentials: 'include',
    });
    const response = await fetch(`${base}/auth/device/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userCode }),
    });
    if (!response.ok) {
      throw toAppErrorFromUnknownError(await response.json().catch(() => ({})));
    }
  }
}

export const authService: AuthServiceInterface = AuthService.create({
  className: 'AuthService',
});
