// apps/frontend/client/src/lib/views/app/dialogs/testing/app_dialogs_reactive_fixtures.svelte.ts
//
// Reactive app-dialogs double for the real-Svelte (Vitest Browser Mode) lane.
// Dialog/snackbar/loading state is real `$state`, so the ViewModel's `$effect`
// can observe a snackbar arriving and convert it into a toast.

import type { AppLoadingData, DialogState, SnackbarData } from '@aikami/frontend/services';
import type { AppDialogCapabilities } from '../app_dialogs_view_model.svelte';

export type ReactiveAppDialogsHarness = {
  /** The dialog capability to inject into the ViewModel. */
  dialog: AppDialogCapabilities;
  /** Publish a reactive snackbar. */
  setSnackbar(snackbar: SnackbarData | undefined): void;
  /** Replace the reactive current dialog. */
  setDialog(dialog: DialogState | undefined): void;
  /** Replace the reactive loading state. */
  setAppLoading(loading: AppLoadingData | undefined): void;
};

/**
 * Creates an app-dialogs double whose dialog/snackbar/loading state is real
 * Svelte `$state`.
 */
export const createReactiveAppDialogsHarness = (): ReactiveAppDialogsHarness => {
  let currentDialog = $state<DialogState | undefined>(undefined);
  let appLoading = $state<AppLoadingData | undefined>(undefined);
  let snackbar = $state<SnackbarData | undefined>(undefined);

  const dialog: AppDialogCapabilities = {
    get currentDialog() {
      return currentDialog;
    },
    get appLoading() {
      return appLoading;
    },
    get snackbar() {
      return snackbar;
    },
    close: () => {
      currentDialog = undefined;
    },
    hideSnackbar: () => {
      snackbar = undefined;
    },
  };

  return {
    dialog,
    setSnackbar: (next) => {
      snackbar = next;
    },
    setDialog: (next) => {
      currentDialog = next;
    },
    setAppLoading: (next) => {
      appLoading = next;
    },
  };
};
