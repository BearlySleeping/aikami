import { getRegisterDataFromCredential } from '@aikami/frontend/utils';
import type { FirebaseAuthCredential, FirebaseUser, RegisterData } from '@aikami/types';
import { BaseClass, type BaseClassInterface, toAppError } from '@aikami/utils';
import type { Unsubscribe, User } from 'firebase/auth';

export type SocialSignInError = {
  /** The email of the user's account used. */
  email: string;
  /** The firebase.auth.AuthCredential type that was used. */
  credential: FirebaseAuthCredential;
  code: string;
  message: string;
  /**
   * If this is true, then the user's email is already in the system with a
   * different account sign in method.
   *
   * Example: The user has an email account and tries to sign in with a google
   * account with the same email.
   */
  accountExists: boolean;
};

export type SocialSignInStatus = 'exitingUser' | 'newUser' | 'failed';

export type SocialSignInResponses = {
  exitingUser: User;
  newUser: RegisterData;
  failed: SocialSignInError;
};

export type SocialSignInResponse<T extends SocialSignInStatus = SocialSignInStatus> = {
  status: T;
  payload: SocialSignInResponses[T];
};
type Auth = typeof import('@aikami/frontend/configs/auth.ts');

export type AuthProviderId = 'google.com' | 'github.com' | 'microsoft.com';

export type FirebaseAuthServiceInterface = BaseClassInterface & {
  getAuthUser(): Promise<FirebaseUser | undefined>;

  signInWithPopup(providerId: AuthProviderId): Promise<SocialSignInResponse>;

  signInWithRedirect(providerId: AuthProviderId): Promise<void>;

  signInWithEmailAndPassword(options: { email: string; password: string }): Promise<User>;

  createUserWithEmailAndPassword(options: {
    email: string;
    password: string;
  }): Promise<{ user: User }>;

  sendPasswordResetEmail(email: string): Promise<void>;

  updateProfile(user: User, profile: { displayName?: string; photoURL?: string }): Promise<void>;

  updatePassword(options: { oldPassword: string; newPassword: string }): Promise<void>;

  confirmPasswordReset(options: {
    password: string;
    email: string;
    actionCode: string;
  }): Promise<User>;

  verifyPasswordResetCode(actionCode: string): Promise<void>;

  onIdTokenChanged(
    nextOrObserver: (user?: User) => void,
    error?: (error: Error) => void,
    completed?: () => void,
  ): Promise<Unsubscribe>;

  signInWithCustomToken(customToken: string): Promise<User | undefined>;

  signOut(): Promise<void>;

  getIdToken(user: User, forceRefresh?: boolean): Promise<string>;

  updateEmail(newEmail: string): Promise<void>;
};

class FirebaseAuthService extends BaseClass implements FirebaseAuthServiceInterface {
  private static _auth?: Auth;

  async confirmPasswordReset(options: {
    password: string;
    email: string;
    actionCode: string;
  }): Promise<User> {
    const { actionCode, email, password } = options;
    const { auth, firebaseConfirmPasswordReset, signInWithEmailAndPassword } =
      await this._getAuth();

    await firebaseConfirmPasswordReset(auth, actionCode, password);
    await signInWithEmailAndPassword(auth, email, password);
    const user = auth.currentUser;
    if (!user) {
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'auth.currentUser is undefined',
      });
    }

    return user;
  }

  async signOut(): Promise<void> {
    this.log('signOut');
    const { auth, firebaseSignOut } = await this._getAuth();

    await firebaseSignOut(auth);
  }

  async getIdToken(user: User, forceRefresh?: boolean): Promise<string> {
    const { getIdToken } = await this._getAuth();

    return getIdToken(user, forceRefresh);
  }

  async updatePassword(options: { oldPassword: string; newPassword: string }): Promise<void> {
    const { newPassword, oldPassword } = options;
    const { auth, firebaseUpdatePassword, signInWithEmailAndPassword } = await this._getAuth();
    const user = auth.currentUser;
    if (!user?.email) {
      throw toAppError({ errorType: 'unauthorized', errorMessage: 'User is not logged in' });
    }
    const response = await signInWithEmailAndPassword(auth, user.email, oldPassword);
    this.debug('updatePassword:signInWithEmailAndPassword', { response });
    await firebaseUpdatePassword(user, newPassword);
  }

  async verifyPasswordResetCode(actionCode: string): Promise<void> {
    const { auth, firebaseVerifyPasswordResetCode } = await this._getAuth();
    await firebaseVerifyPasswordResetCode(auth, actionCode);
  }

  async updateEmail(newEmail: string): Promise<void> {
    const { auth, updateEmail } = await this._getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'auth.currentUser is undefined',
      });
    }

    await updateEmail(currentUser, newEmail);
  }

  async signInWithCustomToken(customToken: string): Promise<User | undefined> {
    const { auth, signInWithCustomToken } = await this._getAuth();

    await signInWithCustomToken(auth, customToken);

    return auth.currentUser ?? undefined;
  }

  async signInWithEmailAndPassword(options: { email: string; password: string }): Promise<User> {
    const { email, password } = options;
    const { auth, signInWithEmailAndPassword } = await this._getAuth();

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user ?? auth.currentUser;
    if (!user) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'auth.currentUser is undefined',
      });
    }

    return user;
  }

  async createUserWithEmailAndPassword(options: {
    email: string;
    password: string;
  }): Promise<{ user: User }> {
    const { email, password } = options;
    const { auth, createUserWithEmailAndPassword } = await this._getAuth();
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return { user: userCredential.user };
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    const { auth, sendPasswordResetEmail } = await this._getAuth();
    await sendPasswordResetEmail(auth, email);
  }

  async updateProfile(
    user: User,
    profile: { displayName?: string; photoURL?: string },
  ): Promise<void> {
    const { updateProfile } = await this._getAuth();
    await updateProfile(user, profile);
  }

  async signInWithRedirect(providerId: AuthProviderId): Promise<void> {
    const { auth, GithubAuthProvider, GoogleAuthProvider, OAuthProvider, signInWithRedirect } =
      await this._getAuth();

    const getProvider = () => {
      switch (providerId) {
        case 'google.com':
          return new GoogleAuthProvider();
        case 'github.com':
          return new GithubAuthProvider();
        case 'microsoft.com': {
          const provider = new OAuthProvider('microsoft.com');
          provider.setCustomParameters({ tenant: 'common' });
          provider.addScope('email');
          provider.addScope('profile');
          return provider;
        }
        default:
          return new OAuthProvider(providerId);
      }
    };

    await signInWithRedirect(auth, getProvider());
  }

  async signInWithPopup(providerId: AuthProviderId): Promise<SocialSignInResponse> {
    try {
      const {
        auth,
        getAdditionalUserInfo,
        GithubAuthProvider,
        GoogleAuthProvider,
        OAuthProvider,
        signInWithPopup,
      } = await this._getAuth();
      const getProvider = () => {
        switch (providerId) {
          case 'google.com':
            return new GoogleAuthProvider();
          case 'github.com':
            return new GithubAuthProvider();
          case 'microsoft.com': {
            const provider = new OAuthProvider('microsoft.com');
            // 'common' allows both personal Microsoft accounts and work/school accounts.
            // Set to a tenant ID to restrict to a specific Azure AD tenant.
            provider.setCustomParameters({ tenant: 'common' });
            provider.addScope('email');
            provider.addScope('profile');
            return provider;
          }
          default:
            return new OAuthProvider(providerId);
        }
      };

      const userCredential = await signInWithPopup(auth, getProvider());
      const additionalUserInfo = getAdditionalUserInfo(userCredential);
      const response: SocialSignInResponse =
        additionalUserInfo && !additionalUserInfo.isNewUser
          ? {
              payload: userCredential.user,
              status: 'exitingUser',
            }
          : {
              payload: getRegisterDataFromCredential({ userCredential, getAdditionalUserInfo }),
              status: 'newUser',
            };

      this.log('signInWithPopup', {
        currentUser: auth.currentUser,
        response,
      });

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

  async onIdTokenChanged(
    nextOrObserver: (user?: User) => void,
    error?: (error: Error) => void,
    completed?: () => void,
  ): Promise<Unsubscribe> {
    const { auth, onIdTokenChanged } = await this._getAuth();

    return onIdTokenChanged(
      auth,
      (user: User | null) => nextOrObserver(user ?? undefined),
      error,
      completed,
    );
  }

  async getAuthUser(): Promise<FirebaseUser | undefined> {
    const { auth } = await this._getAuth();
    return auth.currentUser ?? undefined;
  }

  private async _getAuth(): Promise<Auth> {
    if (FirebaseAuthService._auth) {
      return FirebaseAuthService._auth;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on SSR`);
    }

    FirebaseAuthService._auth = await import('@aikami/frontend/configs/auth.ts');
    return FirebaseAuthService._auth;
  }
}

export const firebaseAuthService: FirebaseAuthServiceInterface = FirebaseAuthService.create({
  className: 'FirebaseAuthService',
});
