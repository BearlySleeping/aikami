// apps/frontend/hub/src/lib/views/login/login_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
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
      // Google sign-in is a full-page redirect to the Better Auth social
      // handler. On return the session cookie is set and hooks.server.ts
      // resolves the user, routing them to the dashboard — no client-side
      // navigation here (it would race the redirect).
      await authService.signInWithGoogle();
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : 'Sign in failed. Please try again.';
    }
  }
}

export const getLoginViewModel = (options: LoginViewModelOptions): LoginViewModelInterface =>
  LoginViewModel.create(options);
