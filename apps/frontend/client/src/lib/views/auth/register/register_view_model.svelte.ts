// apps/frontend/client/src/lib/views/auth/register/register-view-model.svelte.ts
import type { SocialSignInResponse } from '@aikami/frontend/services';
import {
  BaseFormViewModel,
  type BaseFormViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import type { FirebaseSignInProviderName } from '@aikami/types';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import Type from 'typebox';
import { authService, routerService } from '$services';

const RegisterFormSchema = Type.Intersect([
  CoreFormSchema,
  Type.Object({
    email: Type.String({ minLength: 1, format: 'email' }),
    password: Type.String({ minLength: 8 }),
    displayName: Type.String({ minLength: 1 }),
  }),
]);

export type RegisterViewModelOptions = BaseViewModelOptions;

export type RegisterViewModelInterface = BaseFormViewModelInterface<typeof RegisterFormSchema> & {
  readonly isSocialSigningIn: FirebaseSignInProviderName | undefined;
  socialRegister(provider: FirebaseSignInProviderName): Promise<void>;
  goToLogin(): Promise<void>;
};

class RegisterViewModel
  extends BaseFormViewModel<typeof RegisterFormSchema, RegisterViewModelOptions>
  implements RegisterViewModelInterface
{
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
        await this._registerWithEmail(
          String(values.email ?? ''),
          String(values.password ?? ''),
          String(values.displayName ?? ''),
        );
      },
    });
  }

  get isSocialSigningIn(): FirebaseSignInProviderName | undefined {
    return this._isSocialSigningIn;
  }

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
      const appError = toAppErrorFromUnknownError(err);
      const errorMessage = appError.message;

      if (errorMessage.includes('email-already-in-use')) {
        this._errors.email = 'This email is already registered';
      } else if (errorMessage.includes('weak-password')) {
        this._errors.password = 'Password is too weak';
      } else {
        this._errors.email = 'Failed to create account. Please try again.';
        this.errorMessage = appError.message;
      }
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
        this.errorMessage = 'Failed to sign up. Please try again.';
        this.showSnackbar({
          text: 'Failed to sign up. Please try again.',
          type: 'error',
        });
      }
    } catch (err) {
      this.error('Social registration error', err);
      this.errorMessage = toAppErrorFromUnknownError(err).message;
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
