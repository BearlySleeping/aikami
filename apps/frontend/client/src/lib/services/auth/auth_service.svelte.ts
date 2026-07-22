// apps/frontend/client/src/lib/services/api/auth.svelte.ts
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
import { analyticService } from '../analytics/analytics_service.svelte.ts';

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

  private get _auth(): FirebaseAuthServiceInterface {
    return this._options.auth;
  }

  private _currentToken: string | undefined;

  async initialize(): Promise<CurrentUser | undefined> {
    this.log('initialize');
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

            await this.setAuthUser(user, true);
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

      await this.setAuthUser(initialUser, true);
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
      await this.setAuthUser(user, true);

      await this.setAuthUser(user, true);
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
      await this.setAuthUser(undefined, true);

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
    try {
      const toAuthProviderId = (provider: FirebaseSignInProviderName): AuthProviderId => {
        switch (provider) {
          case 'google':
            return 'google.com';
          case 'github':
            return 'github.com';
          default:
            throw new Error('inavlid provider', provider);
        }
      };

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
      this.showSnackbar({
        text: String(error instanceof Error ? error.message : error),
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

  protected async setAuthUser(
    user: FirebaseUser | undefined,
    forceRefresh?: boolean,
  ): Promise<void> {
    await this._setToken(user, forceRefresh);

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

  async syncAuthWithBackend(forceEmpty = false): Promise<boolean> {
    try {
      const user = forceEmpty ? undefined : await this._auth.getAuthUser();
      this.log('syncAuthWithBackend', { user });

      await this._setToken(user, true);

      return true;
    } catch (error) {
      this.error('syncAuthWithBackend', error);
      return false;
    }
  }

  /**
   * Set a JSON Web Token (JWT) used to identify the user to a Firebase
   * service on the server.
   *
   * @remarks
   * Returns the current token if it has not expired or if it will not expire
   * in the next five minutes. Otherwise, this will refresh the token and
   * return a new one.
   * @param user - The user.
   * @param forceRefresh - Force refresh regardless of token expiration.
   * @public
   */
  private async _setToken(user?: FirebaseUser, forceRefresh?: boolean) {
    const token = user ? await this._auth.getIdToken(user, forceRefresh) : undefined;
    if (!forceRefresh && token === this._currentToken) {
      return;
    }

    this._currentToken = token;

    this.log('_setToken', { forceRefresh, uid: user?.uid });

    // In SPA mode, Firebase callable functions handle auth automatically.
    // The ID token is managed by the Firebase Auth SDK and included in
    // callable function requests without manual synchronization.
  }
}

export const authService: AuthServiceInterface = AuthService.create({
  auth: firebaseAuthService,
  className: 'AuthService',
});
