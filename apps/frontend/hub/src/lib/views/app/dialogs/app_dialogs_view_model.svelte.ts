// apps/frontend/hub/src/lib/views/app/dialogs/app_dialogs_view_model.svelte.ts
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
  /**
   * Reads the current confirm dialog directly from the reactive dialog
   * service state (the service is the single source of truth — a local
   * copy here would never stay in sync).
   */
  get confirmDialog(): ConfirmDialogData | undefined {
    const dialog = dialogService.currentDialog;
    if (dialog?.type !== 'confirm') {
      return undefined;
    }
    return dialog.props as ConfirmDialogData;
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
    this.debug('Confirm dialog agreed');
    dialogService.close(true);
  }

  confirmDialogCancel(): void {
    this.debug('Confirm dialog cancelled');
    dialogService.close(false);
  }
}

export const getAppDialogsViewModel = (
  options: AppDialogsViewModelOptions,
): AppDialogsViewModelInterface => AppDialogsViewModel.create(options);
