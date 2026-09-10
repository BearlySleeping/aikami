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
// once via `setDialogCapabilities()`. Until it is registered, the package is
// import-safe (no dialogs are touched at import time). Using a dialog helper
// before registration throws a clear error rather than silently dropping the
// notification or resolving a confirm as cancelled.

import type { ConditionalSnackbarData, DialogState, SnackbarData } from '../types/index.ts';

/** The dialog operations a BaseFrontendClass needs. Structurally satisfied by DialogServiceInterface. */
export type DialogCapabilities = {
  showSnackbar(snackbar: SnackbarData): void;
  showConditionalSnackbar(options: ConditionalSnackbarData): void;
  setAppLoading(loading: boolean, label?: string): void;
  open<T = unknown>(dialog: Omit<DialogState<T>, 'resolve'>): Promise<T | undefined>;
};

let _dialogCapabilities: DialogCapabilities | undefined;

/**
 * Registers the application's dialog implementation and returns the previous
 * one, so tests can restore the prior state:
 *
 * ```ts
 * const previous = setDialogCapabilities(fakeDialog);
 * try { ... } finally { setDialogCapabilities(previous); }
 * ```
 *
 * Passing `undefined` clears the registration.
 */
export const setDialogCapabilities = (
  capabilities: DialogCapabilities | undefined,
): DialogCapabilities | undefined => {
  const previous = _dialogCapabilities;
  _dialogCapabilities = capabilities;
  return previous;
};

/**
 * Returns the registered dialog implementation.
 *
 * @throws if no implementation is registered — a missing bootstrap should fail
 * loudly at the call site instead of silently no-op'ing user-visible behavior.
 */
export const getDialogCapabilities = (): DialogCapabilities => {
  if (!_dialogCapabilities) {
    throw new Error(
      'Dialog capabilities are not registered. Call setDialogCapabilities() during app bootstrap (see views/app/app_composition.ts) before using BaseFrontendClass dialog helpers.',
    );
  }
  return _dialogCapabilities;
};
