import {
  type AuthProviderId,
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  type FirebaseAuthServiceInterface,
  firebaseAuthService,
  type SocialSignInError,
  type SocialSignInResponse,
} from '@aikami/frontend/services';
import type {
  AuthMessageData,
  AuthMessageResponse,
  AuthMessageType,
  CurrentUser,
  FirebaseSignInProviderName,
  FirebaseUser,
  RegisterForm,
} from '@aikami/types';
import { getUserLiteData } from '@aikami/utils';
import { analyticService } from './analytic.svelte.ts';
import { internalAPIService } from './internal.svelte.ts';

export type AuthServiceOptions = BaseFrontendClassOptions & {
  auth: FirebaseAuthServiceInterface;
};

export type AuthServiceInterface = BaseFrontendClassInterface & {
  /**
   * The currently signed-in user.
   */
  readonly currentUser: CurrentUser | undefined;

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
   * Initializes the service.
   */
  initialize(): Promise<void>;

  /**
   * Signs in a user with email and password.
   * @param options The sign-in options.
   * @returns A promise that resolves with true if the sign-in was successful, false otherwise.
   */
  signInWithEmailAndPassword(options: { email: string; password: string }): Promise<boolean>;

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
};

export class AuthService
  extends BaseFrontendClass<AuthServiceOptions>
  implements AuthServiceInterface
{
  currentUser = $state<CurrentUser | undefined>();
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

  async initialize(): Promise<void> {
    this.log('initialize');
    try {
      if (this._initialized) {
        return;
      }
      this._initialized = true;

      await this._auth.onIdTokenChanged(
        async (user) => {
          if (this._isChangingAuthState) {
            return;
          }

          await this.setAuthUser(user, true);
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

  async signInWithEmailAndPassword(options: { email: string; password: string }): Promise<boolean> {
    this.log('signInWithEmailAndPassword', options);
    try {
      const user = await this._auth.signInWithEmailAndPassword(options);
      await this.setAuthUser(user, true);

      return true;
    } catch (error) {
      this.error('signInWithEmailAndPassword', error);
      return false;
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

      const isExitingUser = (
        response: SocialSignInResponse,
      ): response is SocialSignInResponse<'exitingUser'> => response.status === 'exitingUser';

      if (isExitingUser(response)) {
        await this.setAuthUser(response.payload);
      }

      return response;
    } catch (error) {
      this.error('auth signInWithPopup', error);
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

      void this.logEvent('sign_up', {
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
    user: FirebaseUser | null | undefined,
    forceRefresh?: boolean,
  ): Promise<void> {
    this.debug('setAuthUser', { forceRefresh, user });

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
    return await internalAPIService.callAuthEndpoint(data);
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
  private async _setToken(user?: FirebaseUser | null, forceRefresh?: boolean) {
    const token = user ? await this._auth.getIdToken(user, forceRefresh) : undefined;
    if (!forceRefresh && token === this._currentToken) {
      return;
    }

    this._currentToken = token;

    this.log('_setToken', { forceRefresh, uid: user?.uid });

    return await internalAPIService.setToken(token ?? undefined);
  }
}

export const authService: AuthServiceInterface = new AuthService({
  auth: firebaseAuthService,
  className: 'AuthService',
});
