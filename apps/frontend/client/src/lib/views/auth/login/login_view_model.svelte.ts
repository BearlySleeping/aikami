// apps/frontend/client/src/lib/views/auth/login/login-view-model.svelte.ts
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

const LoginFormSchema = Type.Intersect([
  CoreFormSchema,
  Type.Object({
    email: Type.String({ minLength: 1, format: 'email' }),
    password: Type.String({ minLength: 1 }),
  }),
]);

export type LoginViewModelOptions = BaseViewModelOptions;

export type LoginViewModelInterface = BaseFormViewModelInterface<typeof LoginFormSchema> & {
  readonly isSocialSigningIn: FirebaseSignInProviderName | undefined;
  readonly showForgotPasswordDialog: boolean;
  socialLogin(provider: FirebaseSignInProviderName): Promise<void>;
  goToRegister(): Promise<void>;
  openForgotPasswordDialog(): void;
  closeForgotPasswordDialog(): void;
};

class LoginViewModel
  extends BaseFormViewModel<typeof LoginFormSchema, LoginViewModelOptions>
  implements LoginViewModelInterface
{
  private _isSocialSigningIn = $state<FirebaseSignInProviderName | undefined>();
  private _showForgotPasswordDialog = $state(false);

  constructor(options: LoginViewModelOptions) {
    super({
      ...options,
      initialValues: {
        email: '',
        password: '',
      },
      schema: LoginFormSchema,
      onSubmit: async (values) => {
        await this._loginWithEmail(String(values.email ?? ''), String(values.password ?? ''));
      },
    });
  }

  get isSocialSigningIn(): FirebaseSignInProviderName | undefined {
    return this._isSocialSigningIn;
  }

  get showForgotPasswordDialog(): boolean {
    return this._showForgotPasswordDialog;
  }

  private async _loginWithEmail(email: string, password: string): Promise<void> {
    try {
      const result = await authService.signInWithEmailAndPassword({ email, password });
      if (!result.success) {
        throw result.error;
      }
      await routerService.goToRoute('settings', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (err) {
      this.error('Login failed', err);
      const appError = toAppErrorFromUnknownError(err);
      if (
        appError.cause.errorType === 'unauthenticated' ||
        appError.cause.errorType === 'invalid-credentials'
      ) {
        this._errors.password = 'Invalid email or password';
      } else {
        this.errorMessage = appError.message;
        this._errors.password = 'Invalid email or password';
      }
    }
  }

  async socialLogin(provider: FirebaseSignInProviderName): Promise<void> {
    this.log('socialLogin', provider);

    if (this._isSocialSigningIn || this.isSubmitting) {
      this.warn('Already signing in');
      return;
    }
    this._isSocialSigningIn = provider;
    authService.setIsChangingAuthState(true);

    const socialSignInResponse = await authService.socialSignIn(provider);
    await this._handleSocialLoginResponse(socialSignInResponse);
    authService.setIsChangingAuthState(false);
    this._isSocialSigningIn = undefined;
  }

  async goToRegister(): Promise<void> {
    await routerService.goToRoute('register', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  openForgotPasswordDialog(): void {
    if (this.isSubmitting || this._isSocialSigningIn) {
      return;
    }
    this._showForgotPasswordDialog = true;
  }

  closeForgotPasswordDialog(): void {
    this._showForgotPasswordDialog = false;
  }

  private async _handleSocialLoginResponse(
    socialSignInResponse: SocialSignInResponse,
  ): Promise<void> {
    this.log('handleSocialLoginResponse', socialSignInResponse);

    switch (socialSignInResponse.status) {
      case 'exitingUser':
      case 'newUser':
        return await routerService.navigateToApp();
      case 'failed':
        break;
    }
  }
}

export const getLoginViewModel = (options: LoginViewModelOptions): LoginViewModelInterface =>
  new LoginViewModel(options);
