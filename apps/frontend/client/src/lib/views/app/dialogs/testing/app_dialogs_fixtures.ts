// apps/frontend/client/src/lib/views/app/dialogs/testing/app_dialogs_fixtures.ts
//
// Feature-owned test doubles for the app-dialogs ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  AppDialogCapabilities,
  AppDialogsProgressCapabilities,
} from '../app_dialogs_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Dialog capability with no active state and inert operations. */
export const createAppDialogCapabilities = (
  overrides: Partial<AppDialogCapabilities> = {},
): AppDialogCapabilities => ({
  currentDialog: undefined,
  appLoading: undefined,
  snackbar: undefined,
  close: () => unconfigured('close'),
  hideSnackbar: () => unconfigured('hideSnackbar'),
  ...overrides,
});

/** Progress capability with zero progress until overridden. */
export const createAppDialogsProgress = (
  generationProgress = 0,
): AppDialogsProgressCapabilities => ({ generationProgress });
