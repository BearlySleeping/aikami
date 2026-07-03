// packages/frontend/engine/src/ai_clients/api/types.ts

/**
 * Options for a single API request.
 */
export type RequestOptions = {
  /** Request timeout in milliseconds. Default: 15000. */
  timeout?: number;
  /** AbortSignal for manual cancellation. */
  signal?: AbortSignal;
  /** Retry configuration for transient failures. */
  retry?: RetryConfig;
  /** Additional headers to merge with defaults. */
  headers?: Record<string, string>;
};

/**
 * Retry behavior for transient failures (5xx, network timeout).
 */
export type RetryConfig = {
  /** Maximum number of retry attempts. Default: 3. */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds. Default: 1000. */
  initialDelayMs?: number;
};

/**
 * Configuration for the GameApiClient constructor.
 */
export type GameApiClientConfig = {
  /** Base URL for all requests (e.g. Firebase Functions URL). */
  baseUrl: string;
  /** Default request timeout in milliseconds. Default: 15000. */
  defaultTimeout?: number;
  /** Default retry configuration. */
  defaultRetry?: RetryConfig;
  /** Additional default headers. */
  defaultHeaders?: Record<string, string>;
};
