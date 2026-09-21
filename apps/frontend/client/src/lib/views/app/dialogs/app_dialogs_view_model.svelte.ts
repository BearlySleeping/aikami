// apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_view_model.svelte.ts
//
// AppDialogsViewModel — renders the app-wide dialog/toast surface and aggregates
// background-task progress.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/app_dialogs_fixtures.ts).
// Production wiring lives in ./app_dialogs_composition.ts.

import type { AppLoadingData, DialogState, SnackbarData } from '@aikami/frontend/services';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';

// ── Capability contracts ────────────────────────────────────────────────

/** The dialog/toast state and operations the surface reads. */
export type AppDialogCapabilities = {
  readonly currentDialog: DialogState | undefined;
  readonly appLoading: AppLoadingData | undefined;
  readonly snackbar: SnackbarData | undefined;
  close(result?: unknown): void;
  hideSnackbar(): void;
};

/** The background-task progress the surface aggregates. */
export type AppDialogsProgressCapabilities = {
  readonly generationProgress: number;
};

// ── Types ───────────────────────────────────────────────────────────────

export type AppDialogsViewModelOptions = BaseViewModelOptions & {
  /** Dialog service capability. */
  dialog: AppDialogCapabilities;
  /** Background-task progress capability. */
  progress: AppDialogsProgressCapabilities;
};

export type ToastItem = {
  readonly id: number;
  readonly text: string;
  readonly type: 'success' | 'error' | 'warning' | 'info';
};

export type AppDialogsViewModelInterface = BaseViewModelInterface & {
  readonly currentDialog: DialogState | undefined;
  readonly toasts: readonly ToastItem[];
  readonly appLoading: AppLoadingData | undefined;
  /** Background task progress (0-100). 0 = hidden. */
  readonly bottomProgress: number;
  closeDialog(result?: unknown): void;
  dismissToast(id: number): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class AppDialogsViewModel
  extends BaseViewModel<AppDialogsViewModelOptions>
  implements AppDialogsViewModelInterface
{
  private readonly _dialog: AppDialogCapabilities;
  private readonly _progress: AppDialogsProgressCapabilities;

  private _toasts: ToastItem[] = $state([]);
  private _toastId = 0;

  constructor(options: AppDialogsViewModelOptions) {
    super(options);
    this._dialog = options.dialog;
    this._progress = options.progress;
  }

  get currentDialog(): DialogState | undefined {
    return this._dialog.currentDialog;
  }

  get toasts(): readonly ToastItem[] {
    return this._toasts;
  }

  get appLoading(): AppLoadingData | undefined {
    return this._dialog.appLoading;
  }

  /** Aggregates progress from services that report background task progress. */
  get bottomProgress(): number {
    return this._progress.generationProgress;
  }

  closeDialog(result?: unknown): void {
    this._dialog.close(result);
  }

  dismissToast(id: number): void {
    this._toasts = this._toasts.filter((t) => t.id !== id);
  }

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      $effect(() => {
        const snackbar = this._dialog.snackbar;
        if (!snackbar) {
          return;
        }
        const id = ++this._toastId;
        this._toasts = [
          ...this._toasts,
          { id, text: snackbar.text, type: (snackbar.type as ToastItem['type']) ?? 'info' },
        ];
        setTimeout(() => this.dismissToast(id), 5000);
        this._dialog.hideSnackbar();
      });
    });

    await super.initialize();
  }
}

/**
 * Builds the app-dialogs ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getAppDialogsViewModel` in ./app_dialogs_composition.ts.
 */
export const createAppDialogsViewModel = (
  options: AppDialogsViewModelOptions,
): AppDialogsViewModelInterface => AppDialogsViewModel.create(options);
