// apps/frontend/pwa/src/lib/views/auth/login/forgot-password/forgot-password-view-model.svelte.ts
import {
  BaseFormViewModel,
  type BaseFormViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { CoreFormSchema } from '@aikami/schemas';
import { toAppErrorFromUnknownError } from '@aikami/utils';
import { z } from 'zod';
import { authService } from '$services';
import type { LoginViewModelInterface } from '../login-view-model.svelte.ts';

const ForgotPasswordFormSchema = CoreFormSchema.extend({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
});

export type ForgotPasswordViewModelOptions = BaseViewModelOptions & {
  loginViewModel: LoginViewModelInterface;
};

export type ForgotPasswordViewModelInterface = BaseFormViewModelInterface<
  typeof ForgotPasswordFormSchema
> & {
  /**
   * Whether the dialog is open.
   */
  readonly isOpen: boolean;

  /**
   * Closes the dialog.
   */
  close(): void;
};

class ForgotPasswordViewModel
  extends BaseFormViewModel<typeof ForgotPasswordFormSchema, ForgotPasswordViewModelOptions>
  implements ForgotPasswordViewModelInterface
{
  /**
   * The login view model.
   */
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
        await this._sendResetEmail(values.email);
      },
    });
    this._loginViewModel = options.loginViewModel;
  }

  /**
   * Sends a password reset email to the user.
   * @param email The user's email address
   */
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
