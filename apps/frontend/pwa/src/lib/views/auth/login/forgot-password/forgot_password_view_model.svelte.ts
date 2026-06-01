// apps/frontend/pwa/src/lib/views/auth/login/forgot-password/forgot-password-view-model.svelte.ts
import {
  BaseFormViewModel,
  type BaseFormViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import Type from 'typebox';
import { authService } from '$services';
import type { LoginViewModelInterface } from '../login_view_model.svelte.ts';

const ForgotPasswordFormSchema = Type.Intersect([
  CoreFormSchema,
  Type.Object({
    email: Type.String({ minLength: 1, format: 'email' }),
  }),
]);

export type ForgotPasswordViewModelOptions = BaseViewModelOptions & {
  loginViewModel: LoginViewModelInterface;
};

export type ForgotPasswordViewModelInterface = BaseFormViewModelInterface<
  typeof ForgotPasswordFormSchema
> & {
  readonly isOpen: boolean;
  close(): void;
};

class ForgotPasswordViewModel
  extends BaseFormViewModel<typeof ForgotPasswordFormSchema, ForgotPasswordViewModelOptions>
  implements ForgotPasswordViewModelInterface
{
  private _loginViewModel: LoginViewModelInterface;

  get isOpen(): boolean {
    return this._loginViewModel.showForgotPasswordDialog;
  }

  constructor(options: ForgotPasswordViewModelOptions) {
    super({
      ...options,
      initialValues: {
        email: '',
      },
      schema: ForgotPasswordFormSchema,
      onSubmit: async (values) => {
        await this._sendResetEmail(String(values.email ?? ''));
      },
    });
    this._loginViewModel = options.loginViewModel;
  }

  private async _sendResetEmail(email: string): Promise<void> {
    try {
      await authService.sendPasswordResetEmail(email);
      this.showSnackbar({
        text: 'Password reset email sent. Please check your inbox.',
        type: 'success',
      });
      this.close();
    } catch (err) {
      this.error('Failed to send reset email', err);
      this._errors.email = 'Failed to send reset email. Please try again.';
      this.errorMessage = toAppErrorFromUnknownError(err).message;
    }
  }

  close(): void {
    this._loginViewModel.closeForgotPasswordDialog();
    this.reset();
  }
}

export const getForgotPasswordViewModel = (
  options: ForgotPasswordViewModelOptions,
): ForgotPasswordViewModelInterface => new ForgotPasswordViewModel(options);
