// apps/frontend/client/src/lib/types/theme_package.ts
//
// C-529 AC-3 / AC-6 — the shapes the theme package lifecycle hands between the
// package service and the Interface settings ViewModel.
//
// Lives in `$types` rather than in the service module because a service file may
// only export its own singleton, options type and interface
// (`guard-service-conventions` S10), and because the ViewModel needs to name
// these shapes without importing the service implementation.

import type { ThemeInstallation } from '@aikami/schemas';

/** A package staged for preview, not yet installed. */
export type StagedTheme = {
  readonly operationId: number;
  readonly installation: ThemeInstallation;
  /** Object URL for the declared preview image, when the package has one. */
  readonly previewUrl: string | undefined;
  readonly fileNames: readonly string[];
};

/** A rejected package: the creator-visible reason, per diagnostic. */
export type ThemeImportFailure = {
  readonly code: string;
  readonly message: string;
  readonly subject: string | undefined;
};

/** Creator-supplied metadata for an export. */
export type ThemeExportOverrides = {
  readonly id?: string;
  readonly name?: string;
  readonly authorDisplayName?: string;
  readonly license?: string;
  readonly version?: string;
};

/**
 * Progress of one Hub download (C-530 AC-6).
 *
 * Reported so the Interface settings surface can render a responsive progress
 * line and a working cancel: `receivedBytes` grows monotonically, and
 * `cancelled` is set only by the caller's own abort.
 */
export type ThemeDownloadProgress = {
  readonly receivedBytes: number;
  /** `0` when the response did not declare a length. */
  readonly totalBytes: number;
  readonly cancelled: boolean;
};

/** Options for one Hub theme download. */
export type ThemeHubDownloadOptions = {
  /** Aborts the transfer; the active theme is untouched either way. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ThemeDownloadProgress) => void;
};
