// apps/frontend/pwa/src/lib/views/app/dialogs/app_dialogs_view_model.svelte.ts
import type { ConfirmDialogData, DialogState } from '@aikami/frontend/services';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { dialogService } from '$services';

export type AppDialogsViewModelOptions = BaseViewModelOptions;

export type AppDialogsViewModelInterface = BaseViewModelInterface & {
  /** The currently open dialog (generic). */
  readonly currentDialog: DialogState | undefined;

  /** The data for the snackbar. */
  readonly snackbar: typeof dialogService.snackbar;

  /** The data for the app loading indicator. */
  readonly appLoading: typeof dialogService.appLoading;

  /** Close the current dialog with an optional result. */
  closeDialog(result?: unknown): void;

  /** Hides the snackbar. */
  hideSnackbar(): void;

  // ── Backward-compat ────────────────────────────────────

  /** @deprecated Use `currentDialog` instead. */
  readonly confirmDialog: ConfirmDialogData | undefined;

  /** @deprecated Use `currentDialog` instead. */
  readonly inviteDialog: unknown;

  /** @deprecated Use `closeDialog()` instead. */
  closeInviteDialog(): void;
  /** @deprecated Use `closeDialog(true)` via the generic flow. */
  confirmDialogAgree(): void;
  /** @deprecated Use `closeDialog(false)` via the generic flow. */
  confirmDialogCancel(): void;
};

class AppDialogsViewModel
  extends BaseViewModel<AppDialogsViewModelOptions>
  implements AppDialogsViewModelInterface
{
  get currentDialog() {
    return dialogService.currentDialog;
  }

  get snackbar() {
    return dialogService.snackbar;
  }

  get appLoading() {
    return dialogService.appLoading;
  }

  closeDialog = (result?: unknown): void => {
    dialogService.close(result);
  };

  hideSnackbar(): void {
    dialogService.hideSnackbar();
  }

  // ── Backward-compat passthroughs ─────────────────────────

  get confirmDialog(): ConfirmDialogData | undefined {
    if (dialogService.currentDialog?.type !== 'confirm') {
      return undefined;
    }
    const props = (dialogService.currentDialog.props ?? {}) as Partial<ConfirmDialogData>;
    return {
      title: (props.title as string) ?? '',
      message: (props.message as string) ?? '',
      agreeLabel: (props.agreeLabel as string) ?? 'OK',
      disagreeLabel: (props.disagreeLabel as string) ?? 'Cancel',
      hideDisagreeButton: (props.hideDisagreeButton as boolean) ?? false,
      resolve: (value: boolean) => dialogService.close(value),
    };
  }

  get inviteDialog() {
    return dialogService.currentDialog?.type === 'invite-member'
      ? dialogService.currentDialog
      : undefined;
  }

  closeInviteDialog(): void {
    dialogService.close(true);
  }

  confirmDialogAgree(): void {
    dialogService.close(true);
  }

  confirmDialogCancel(): void {
    dialogService.close(false);
  }
}

export const getAppDialogsViewModel = (
  options: AppDialogsViewModelOptions,
): AppDialogsViewModelInterface => new AppDialogsViewModel(options);
