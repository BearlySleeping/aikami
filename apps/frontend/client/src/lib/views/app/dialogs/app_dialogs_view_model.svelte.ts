// apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_view_model.svelte.ts
import type { DialogState } from '@aikami/frontend/services';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { dialogService } from '$services';
import { imageGenerationService } from '$services/image/image_generation_service.svelte';

export type AppDialogsViewModelOptions = BaseViewModelOptions;

export type ToastItem = {
  readonly id: number;
  readonly text: string;
  readonly type: 'success' | 'error' | 'warning' | 'info';
};

export type AppDialogsViewModelInterface = BaseViewModelInterface & {
  readonly currentDialog: DialogState | undefined;
  readonly toasts: readonly ToastItem[];
  readonly appLoading: typeof dialogService.appLoading;
  /** Background task progress (0-100). 0 = hidden. */
  readonly bottomProgress: number;
  closeDialog(result?: unknown): void;
  dismissToast(id: number): void;
};

class AppDialogsViewModel
  extends BaseViewModel<AppDialogsViewModelOptions>
  implements AppDialogsViewModelInterface
{
  private _toasts: ToastItem[] = $state([]);
  private _toastId = 0;

  get currentDialog() {
    return dialogService.currentDialog;
  }

  get toasts(): readonly ToastItem[] {
    return this._toasts;
  }

  get appLoading() {
    return dialogService.appLoading;
  }

  /** Aggregates progress from services that report background task progress. */
  get bottomProgress(): number {
    return imageGenerationService.generationProgress;
  }

  closeDialog = (result?: unknown): void => {
    dialogService.close(result);
  };

  dismissToast(id: number): void {
    this._toasts = this._toasts.filter((t) => t.id !== id);
  }

  async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      $effect(() => {
        const snackbar = dialogService.snackbar;
        if (!snackbar) {
          return;
        }
        const id = ++this._toastId;
        this._toasts = [
          ...this._toasts,
          { id, text: snackbar.text, type: (snackbar.type as ToastItem['type']) ?? 'info' },
        ];
        setTimeout(() => this.dismissToast(id), 5000);
        dialogService.hideSnackbar();
      });
    });

    await super.initialize();
  }
}

export const getAppDialogsViewModel = (
  options: AppDialogsViewModelOptions,
): AppDialogsViewModelInterface => new AppDialogsViewModel(options);
