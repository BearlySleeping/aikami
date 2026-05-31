// packages/frontend/services/src/lib/services/dialog.svelte.ts
import { BaseClass } from '@aikami/utils';
import type {
  BaseFrontendClassInterface,
  BaseFrontendClassOptions,
} from '../base/base_frontend_class.ts';
import type {
  AppLoadingData,
  ConditionalSnackbarData,
  ConfirmDialogData,
  DialogState,
  SnackbarData,
} from '../types/dialog.ts';

export type DialogServiceOptions = BaseFrontendClassOptions;

export type DialogServiceInterface = BaseFrontendClassInterface & {
  // ── Generic dialog ──────────────────────────────────────

  /** The currently open dialog, if any. */
  readonly currentDialog: DialogState | undefined;

  /**
   * Open a dialog by its type identifier.
   *
   * @returns A promise that resolves when `close(result)` is called.
   *
   * @example
   *   const result = await dialogService.open({ type: 'integration-connect', props: { integrationId: 'slack' } });
   *   if (result?.success) { ... }
   */
  open<T = unknown>(dialog: Omit<DialogState<T>, 'resolve'>): Promise<T | undefined>;

  /** Close the current dialog with an optional result. */
  close<T = unknown>(result?: T): void;

  // ── Loading ─────────────────────────────────────────────

  appLoading: AppLoadingData | undefined;

  setAppLoading(loading: boolean, label?: string): void;

  // ── Snackbar ────────────────────────────────────────────

  snackbar: SnackbarData | undefined;

  showSnackbar(snackbar: SnackbarData): void;
  showConditionalSnackbar(snackbar: ConditionalSnackbarData): void;
  hideSnackbar(): void;

  // ── Legacy (backward-compat) ────────────────────────────

  /** @deprecated Use `open({ type: 'confirm', props: ... })` instead. */
  openConfirmDialog(confirmDialog: Omit<ConfirmDialogData, 'resolve'>): Promise<boolean>;

  /** @deprecated Use `open({ type: 'invite-member' })` instead. */
  openInviteDialog(): Promise<boolean>;
};

export class DialogService
  extends BaseClass<DialogServiceOptions>
  implements DialogServiceInterface
{
  // ── Reactive state ────────────────────────────────────────

  currentDialog = $state<DialogState | undefined>();
  snackbar = $state<SnackbarData | undefined>();
  appLoading = $state<AppLoadingData | undefined>();

  // ── Generic dialog ────────────────────────────────────────

  async open<T = unknown>(dialog: Omit<DialogState<T>, 'resolve'>): Promise<T | undefined> {
    this.log('open', { type: dialog.type });
    return await new Promise((resolve) => {
      this.currentDialog = { ...dialog, resolve } as DialogState;
    });
  }

  close<T = unknown>(result?: T): void {
    this.log('close', { type: this.currentDialog?.type });
    const resolve = this.currentDialog?.resolve as ((v: T) => void) | undefined;
    this.currentDialog = undefined;
    resolve?.(result as T);
  }

  // ── Loading ────────────────────────────────────────────────

  setAppLoading(loading: boolean, label?: string): void {
    this.log('setAppLoading', { label, loading });
    this.appLoading = loading ? { label } : undefined;
  }

  // ── Snackbar ───────────────────────────────────────────────

  showSnackbar(snackbar: SnackbarData): void {
    this.log('showSnackbar', { snackbar });
    this.snackbar = {
      ...snackbar,
      type: snackbar.type ?? 'success',
    };
  }

  showConditionalSnackbar({ errorText, responseOk, successText }: ConditionalSnackbarData): void {
    this.showSnackbar({
      text: responseOk ? successText : errorText,
      type: responseOk ? 'success' : 'error',
    });
  }

  hideSnackbar(): void {
    this.log('hideSnackbar');
    this.snackbar = undefined;
  }

  // ── Legacy (backward-compat) ───────────────────────────────

  async openConfirmDialog(data: Omit<ConfirmDialogData, 'resolve'>): Promise<boolean> {
    const result = await this.open<boolean>({
      type: 'confirm',
      props: data as Record<string, unknown>,
    });
    return result ?? false;
  }

  async openInviteDialog(): Promise<boolean> {
    const result = await this.open<boolean>({ type: 'invite-member' });
    return result ?? false;
  }
}

export const dialogService: DialogServiceInterface = new DialogService({
  className: 'DialogService',
});
