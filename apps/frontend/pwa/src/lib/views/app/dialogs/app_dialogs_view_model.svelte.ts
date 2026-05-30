// apps/frontend/pwa/src/lib/views/app/dialogs/app-dialogs-view-model.svelte.ts
import type { AppLoadingData, ConfirmDialogData, SnackbarData } from '@aikami/frontend/services';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { dialogService } from '$services';

export type AppDialogsViewModelOptions = BaseViewModelOptions;

export type AppDialogsViewModelInterface = BaseViewModelInterface & {
  /**
   * The data for the confirm dialog.
   */
  readonly confirmDialog: ConfirmDialogData | undefined;

  /**
   * The data for the snackbar.
   */
  readonly snackbar: SnackbarData | undefined;

  /**
   * The data for the app loading indicator.
   */
  readonly appLoading: AppLoadingData | undefined;

  /**
   * Hides the snackbar.
   */
  hideSnackbar(): void;

  /**
   * Agrees to the confirm dialog.
   */
  confirmDialogAgree(): void;

  /**
   * Cancels the confirm dialog.
   */
  confirmDialogCancel(): void;
};

class AppDialogsViewModel
  extends BaseViewModel<AppDialogsViewModelOptions>
  implements AppDialogsViewModelInterface
{
  get confirmDialog() {
    return dialogService.confirmDialog;
  }

  get snackbar() {
    return dialogService.snackbar;
  }

  get appLoading() {
    return dialogService.appLoading;
  }

  hideSnackbar(): void {
    this.debug('Hiding snackbar');
    dialogService.hideSnackbar();
  }

  confirmDialogAgree(): void {
    const dialog = dialogService.confirmDialog;
    if (!dialog?.resolve) {
      this.warn('No confirm dialog to agree to');
      return;
    }

    this.debug('Confirm dialog agreed');
    dialog.resolve(true);
    dialogService.confirmDialog = undefined;
  }

  confirmDialogCancel(): void {
    const dialog = dialogService.confirmDialog;
    if (!dialog?.resolve) {
      this.warn('No confirm dialog to cancel');
      return;
    }

    this.debug('Confirm dialog cancelled');
    dialog.resolve(false);
    dialogService.confirmDialog = undefined;
  }
}

export const getAppDialogsViewModel = (
  options: AppDialogsViewModelOptions,
): AppDialogsViewModelInterface => new AppDialogsViewModel(options);
