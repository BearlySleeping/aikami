// packages/frontend/services/src/lib/base/dialog_capabilities.ts
//
// Late-bound dialog capability for BaseFrontendClass.
//
// BaseFrontendClass used to import the `dialogService` singleton directly
// (../services/dialog.svelte.ts), which pulled the whole dialog module — and
// through it, the app graph — into every module that imported a base class.
// That import-time coupling is why the client test preload had to fake the
// entire `@aikami/frontend/services` package just to instantiate a ViewModel.
//
// The bridge removes the cycle: the base package exposes only this narrow
// capability contract, and the app bootstrap registers the real DialogService
// once via `setDialogCapabilities()`. Before registration (unit tests, isolated
// imports) the no-op implementation keeps base classes import-safe and inert.

import type { ConditionalSnackbarData, DialogState, SnackbarData } from '../types/index.ts';

/** The dialog operations a BaseFrontendClass needs. Structurally satisfied by DialogServiceInterface. */
export type DialogCapabilities = {
  showSnackbar(snackbar: SnackbarData): void;
  showConditionalSnackbar(options: ConditionalSnackbarData): void;
  setAppLoading(loading: boolean, label?: string): void;
  open<T = unknown>(dialog: Omit<DialogState<T>, 'resolve'>): Promise<T | undefined>;
};

const noopDialogCapabilities: DialogCapabilities = {
  showSnackbar: () => {},
  showConditionalSnackbar: () => {},
  setAppLoading: () => {},
  open: async <T = unknown>(_dialog: Omit<DialogState<T>, 'resolve'>): Promise<T | undefined> =>
    undefined,
};

let _dialogCapabilities: DialogCapabilities = noopDialogCapabilities;

/**
 * Registers the application's dialog implementation. Called once from the app
 * bootstrap; idempotent.
 */
export const setDialogCapabilities = (capabilities: DialogCapabilities): void => {
  _dialogCapabilities = capabilities;
};

/** Returns the registered dialog implementation, or the inert default. */
export const getDialogCapabilities = (): DialogCapabilities => _dialogCapabilities;
