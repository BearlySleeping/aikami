import type { SocialSignInResponse } from '@aikami/frontend/services';
import {
  BaseFormViewModel,
  type BaseFormViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import type { FirebaseSignInProviderName } from '@aikami/types';
import { z } from 'zod';
import { authService, routerService } from '$services';

const RegisterFormSchema = CoreFormSchema.extend({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(1, 'Display name is required'),
});

export type RegisterViewModelOptions = BaseViewModelOptions;

export type RegisterViewModelInterface = BaseFormViewModelInterface<typeof RegisterFormSchema> & {
  /**
   * The social sign-in provider that is currently in progress.
   */
  readonly isSocialSigningIn: FirebaseSignInProviderName | undefined;

  /**
   * Handles social registration with Google or GitHub.
   * @param provider The social provider to use.
   */
  socialRegister(provider: FirebaseSignInProviderName): Promise<void>;

  /**
   * Navigates to the login page.
   */
  goToLogin(): Promise<void>;
};

class RegisterViewModel
  extends BaseFormViewModel<typeof RegisterFormSchema, RegisterViewModelOptions>
  implements RegisterViewModelInterface
{
  /**
   * The social sign-in provider that is currently in progress.
   */
  private _isSocialSigningIn = $state<FirebaseSignInProviderName | undefined>();

  constructor(options: RegisterViewModelOptions) {
    super({
      ...options,
      initialValues: {
        email: '',
        password: '',
        displayName: '',
      },
      schema: RegisterFormSchema,
      onSubmit: async (values) => {
        await this._registerWithEmail(values.email, values.password, values.displayName);
      },
    });
  }

  isSocialSigningIn = $derived(this._isSocialSigningIn);

  /**
   * Registers a new user with email and password.
   * @param email User's email
   * @param password User's password
   * @param displayName User's full name
   * @param phoneNumber User's phone number (optional)
   */
  private async _registerWithEmail(
    email: string,
    password: string,
    displayName: string,
  ): Promise<void> {
    try {
      await authService.registerUser({
        email,
        password,
        displayName,
        signInProvider: 'email',
      });

      this.showSnackbar({
        text: 'Account created successfully! Welcome!',
        type: 'success',
      });

      await routerService.goToRoute('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (err) {
      this.error('Registration failed', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to create account';

      if (errorMessage.includes('email-already-in-use')) {
        this._errors.email = 'This email is already registered';
      } else if (errorMessage.includes('weak-password')) {
        this._errors.password = 'Password is too weak';
      } else {
        this._errors.email = 'Failed to create account. Please try again.';
      }
      throw err;
    }
  }

  async socialRegister(provider: FirebaseSignInProviderName): Promise<void> {
    if (this._isSocialSigningIn || this.isSubmitting) {
      this.warn('Already signing in');
      return;
    }

    this._isSocialSigningIn = provider;
    this.debug('Social register started', { provider });

    try {
      const response: SocialSignInResponse = await authService.socialSignIn(provider);

      if (response.status === 'newUser' || response.status === 'exitingUser') {
        this.showSnackbar({
          text:
            response.status === 'newUser'
              ? 'Account created successfully! Welcome!'
              : 'Welcome back!',
          type: 'success',
        });

        await routerService.goToRoute('dashboard', {
          pathParameters: undefined,
          queryParameters: undefined,
        });
      } else {
        this.error('Social registration failed', response);
        this.showSnackbar({
          text: 'Failed to sign up. Please try again.',
          type: 'error',
        });
      }
    } catch (err) {
      this.error('Social registration error', err);
      this.showSnackbar({
        text: 'An error occurred during sign up',
        type: 'error',
      });
    } finally {
      this._isSocialSigningIn = undefined;
    }
  }

  async goToLogin(): Promise<void> {
    await routerService.goToRoute('login', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }
}

export const getRegisterViewModel = (
  options: RegisterViewModelOptions,
): RegisterViewModelInterface => new RegisterViewModel(options);
