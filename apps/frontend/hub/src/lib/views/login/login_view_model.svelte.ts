// apps/frontend/hub/src/lib/views/login/login_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  routerService,
} from '@aikami/frontend/services';
import { authService } from '$services';

export type LoginViewModelOptions = BaseViewModelOptions;

export type LoginViewModelInterface = BaseViewModelInterface & {
  readonly isGoogleSigningIn: boolean;
  handleGoogleSignIn(): Promise<void>;
};

class LoginViewModel
  extends BaseViewModel<LoginViewModelOptions>
  implements LoginViewModelInterface
{
  get isGoogleSigningIn(): boolean {
    return authService.isGoogleSigningIn;
  }

  async handleGoogleSignIn(): Promise<void> {
    this.debug('handleGoogleSignIn');
    this.errorMessage = undefined;

    try {
      await authService.signInWithGoogle();

      await routerService.goToRoute('personas', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Sign in failed. Please try again.';
    }
  }
}

export const getLoginViewModel = (options: LoginViewModelOptions): LoginViewModelInterface =>
  LoginViewModel.create(options);
