import type { SocialSignInResponse } from '@aikami/frontend/services/index.ts';
import {
  BaseFormViewModel,
  type BaseFormViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/index.ts';
import { CoreFormSchema } from '@aikami/schemas/index.ts';
import type { FirebaseSignInProviderName } from '@aikami/types/index.ts';
import { z } from 'zod';
import { authService, routerService } from '$services/index.ts';

const LoginFormSchema = CoreFormSchema.extend({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginViewModelOptions = BaseViewModelOptions;

export type LoginViewModelInterface = BaseFormViewModelInterface<typeof LoginFormSchema> & {
  /**
   * The social sign-in provider that is currently in progress.
   */
  readonly isSocialSigningIn: FirebaseSignInProviderName | undefined;

  /**
   * Whether to show the forgot password dialog.
   */
  readonly showForgotPasswordDialog: boolean;

  /**
   * Handles social login with Google or GitHub.
   * @param provider The social provider to use
   */
  socialLogin(provider: FirebaseSignInProviderName): Promise<void>;

  /**
   * Navigates to the register page.
   */
  goToRegister(): Promise<void>;

  /**
   * Opens the forgot password dialog.
   */
  openForgotPasswordDialog(): void;

  /**
   * Closes the forgot password dialog.
   */
  closeForgotPasswordDialog(): void;
};

class LoginViewModel
  extends BaseFormViewModel<typeof LoginFormSchema, LoginViewModelOptions>
  implements LoginViewModelInterface
{
  /**
   * The social sign-in provider that is currently in progress.
   */
  private _isSocialSigningIn = $state<FirebaseSignInProviderName | undefined>();

  /**
   * Whether to show the forgot password dialog.
   */
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
        await this._loginWithEmail(values.email, values.password);
      },
    });
  }

  isSocialSigningIn = $derived(this._isSocialSigningIn);

  showForgotPasswordDialog = $derived(this._showForgotPasswordDialog);

  /**
   * Performs email/password login.
   * @param email User's email
   * @param password User's password
   */
  private async _loginWithEmail(email: string, password: string): Promise<void> {
    try {
      await authService.signInWithEmailAndPassword({ email, password });
      await routerService.goToRoute('dashboard', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
    } catch (err) {
      this.error('Login failed', err);
      this._errors.password = 'Invalid email or password';
      throw err;
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
