// packages/frontend/services/src/lib/types/dialog.ts
import type { Color } from '@aikami/frontend/utils';

// ── Loading & Snackbar (unchanged) ──────────────────────────

export type AppLoadingData = {
  label?: string;
};

export type SnackbarType = 'success' | 'error' | 'warning' | 'info';

export type SnackbarData = {
  text: string;
  type?: SnackbarType;
};

export type ConditionalSnackbarData = {
  successText: string;
  errorText: string;
  responseOk: boolean;
};

// ── Generic Dialog ──────────────────────────────────────────

/**
 * Every dialog that the app can open is described by one of these.
 *
 * The view uses `type` to select which Svelte component to render
 * and passes `props` through to it. When the component calls
 * `dialogService.close(result)`, the `resolve` callback fires
 * and the `await dialogService.open(...)` promise resolves.
 */
export type DialogState<T = unknown> = {
  /** Unique type identifier — used to select the component. */
  type: string;
  /** Props forwarded to the component. */
  props?: Record<string, unknown>;
  /**
   * Called to resolve the dialog. The component calls
   * `dialogService.close(result)` which invokes this.
   */
  resolve?: (value: T) => void;
};

// ── Legacy types (kept for ConfirmDialog-specific styling) ──

export type ResolveDialogData = {
  resolve?: (value: boolean) => void;
};

export type ConfirmDialogData = ResolveDialogData & {
  title: string;
  message: string;
  agreeLabel?: string;
  agreeColor?: Color;
  disagreeLabel?: string;
  imageName?: string;
  minWidth?: number | string;
  hideDisagreeButton?: boolean;
};

/**
 * @deprecated Use `open({ type: 'invite-member' })` via the generic DialogState.
 * Kept for backward-compatibility with existing code.
 */
export type InviteDialogData = ResolveDialogData;
