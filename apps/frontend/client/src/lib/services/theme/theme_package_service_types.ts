// apps/frontend/client/src/lib/services/theme/theme_package_service_types.ts

/** Progress of one bounded Hub package download. */
export type ThemeDownloadProgress = {
  readonly receivedBytes: number;
  /** `0` when the response did not declare a length. */
  readonly totalBytes: number;
  readonly cancelled: boolean;
};

/** Caller-owned controls for one Hub package download. */
export type ThemeHubDownloadOptions = {
  /** Aborts the transfer; the active theme is untouched either way. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ThemeDownloadProgress) => void;
};
