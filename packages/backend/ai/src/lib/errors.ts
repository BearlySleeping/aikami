// packages/backend/ai/src/lib/errors.ts
import type { AiServiceErrorCode } from './types.ts';

/**
 * Standardized error for AI service failures.
 *
 * Wraps vendor-specific errors into a consistent shape that callers
 * can handle without knowing the underlying provider.
 */
export class AiServiceError extends Error {
  /** Machine-readable error code for programmatic handling. */
  readonly code: AiServiceErrorCode;

  /** HTTP status code associated with this error. */
  readonly statusCode: number;

  /** Original vendor error if available (for debugging). */
  readonly originalError?: unknown;

  /**
   * Whether this error is retryable (transient failures like rate limits, timeouts).
   */
  readonly retryable: boolean;

  constructor(code: AiServiceErrorCode, message: string, options?: { originalError?: unknown }) {
    super(message);
    this.name = 'AiServiceError';
    this.code = code;
    this.originalError = options?.originalError;
    this.statusCode = mapCodeToStatusCode(code);
    this.retryable = isRetryable(code);
  }
}

/**
 * Maps an AiServiceErrorCode to a standard HTTP status code.
 */
const mapCodeToStatusCode = (code: AiServiceErrorCode): number => {
  switch (code) {
    case 'rate_limited':
      return 429;
    case 'authentication_failed':
      return 401;
    case 'content_filtered':
      return 422;
    case 'network_timeout':
      return 504;
    case 'token_exceeded':
      return 413;
    case 'invalid_response':
      return 502;
    case 'provider_unavailable':
      return 503;
    case 'circuit_open':
      return 503;
  }
};

/**
 * Determines whether an error code represents a transient (retryable) failure.
 *
 * Retryable: rate limits, timeouts, provider unavailability, circuit open.
 * Non-retryable: auth failures, content filtering, token exceeded, invalid responses.
 */
const isRetryable = (code: AiServiceErrorCode): boolean => {
  switch (code) {
    case 'rate_limited':
    case 'network_timeout':
    case 'provider_unavailable':
    case 'circuit_open':
      return true;
    case 'authentication_failed':
    case 'content_filtered':
    case 'token_exceeded':
    case 'invalid_response':
      return false;
  }
};
