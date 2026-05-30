// packages/frontend/api-core/src/api/errors.ts

/**
 * Standardized error codes for API client failures.
 */
export type ApiErrorCode =
  | 'network_timeout'
  | 'network_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'cors_blocked'
  | 'bad_request'
  | 'unknown';

/**
 * A structured API error with a stable error code and human-readable message.
 */
export class ApiError extends Error {
  /** Stable error code for programmatic handling. */
  readonly code: ApiErrorCode;

  /** HTTP status code if the error came from an HTTP response. */
  readonly status: number | null;

  /**
   * Creates a new ApiError.
   *
   * @param code - Stable error code.
   * @param message - Human-readable description.
   * @param status - HTTP status code (null for network errors).
   */
  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /**
   * Maps an HTTP status code to an {@link ApiErrorCode}.
   */
  static fromStatus(status: number, message?: string): ApiError {
    const code = statusCodeMap[status] ?? 'unknown';
    const displayMessage = message ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
    return new ApiError(code, displayMessage, status);
  }

  /**
   * Creates a network error (no response received).
   */
  static fromNetworkError(cause: unknown): ApiError {
    const message = cause instanceof Error ? cause.message : String(cause);

    // Detect CORS errors
    if (message.includes('CORS') || message.includes('cors')) {
      return new ApiError(
        'cors_blocked',
        'Request blocked by CORS policy. The local service may not be configured to allow cross-origin requests.',
        null,
      );
    }

    // Detect timeout
    if (message.includes('timed out') || message.includes('timeout') || message.includes('abort')) {
      return new ApiError('network_timeout', `Request timed out: ${message}`, null);
    }

    return new ApiError('network_error', `Network error: ${message}`, null);
  }
}

/**
 * Mapping of HTTP status codes to ApiErrorCode.
 */
const statusCodeMap: Record<number, ApiErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  408: 'network_timeout',
  429: 'rate_limited',
  500: 'server_error',
  502: 'server_error',
  503: 'server_error',
  504: 'network_timeout',
};
