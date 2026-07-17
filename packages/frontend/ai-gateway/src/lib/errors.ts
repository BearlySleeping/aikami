// packages/frontend/ai-gateway/src/lib/errors.ts
//
// Normalized gateway error surface. Every failure that escapes the gateway
// is an AiGatewayException carrying the shared AiGatewayError shape.
// Contract: C-320 AC-4

import type { AiCapability, AiGatewayError, AiGatewayErrorCode, AiMode } from '@aikami/types';

/**
 * Typed error thrown by every gateway call. Structurally satisfies the
 * shared `AiGatewayError` shape from `@aikami/types` while remaining a
 * real `Error` for stack traces and `instanceof` checks.
 *
 * Messages must never contain secrets (API keys are redacted upstream).
 */
export class AiGatewayException extends Error implements AiGatewayError {
  /** Machine-readable normalized error code. */
  readonly code: AiGatewayErrorCode;

  /** Which capability the failing call targeted. */
  readonly capability: AiCapability;

  /** Which mode served (or failed to serve) the call. */
  readonly mode: AiMode;

  /** Provider id when known. */
  readonly provider?: string;

  /** Whether retrying the call may succeed. Never true for 'cancelled'. */
  readonly retryable: boolean;

  /** Original error, for debugging. Never logged with secrets. */
  readonly originalError?: unknown;

  constructor(options: {
    code: AiGatewayErrorCode;
    capability: AiCapability;
    mode: AiMode;
    message: string;
    provider?: string;
    originalError?: unknown;
  }) {
    super(options.message);
    this.name = 'AiGatewayException';
    this.code = options.code;
    this.capability = options.capability;
    this.mode = options.mode;
    this.provider = options.provider;
    this.retryable = isRetryableGatewayCode(options.code);
    this.originalError = options.originalError;
  }
}

/**
 * Factory for AiGatewayException — the preferred construction path.
 */
export const createAiGatewayError = (options: {
  code: AiGatewayErrorCode;
  capability: AiCapability;
  mode: AiMode;
  message: string;
  provider?: string;
  originalError?: unknown;
}): AiGatewayException => new AiGatewayException(options);

/**
 * Type guard for AiGatewayException.
 */
export const isAiGatewayError = (error: unknown): error is AiGatewayException =>
  error instanceof AiGatewayException;

/**
 * Whether a normalized code represents a transient (retryable) failure.
 * Retry policy is per-adapter and must never retry after 'cancelled'.
 */
export const isRetryableGatewayCode = (code: AiGatewayErrorCode): boolean => {
  switch (code) {
    case 'provider_unreachable':
    case 'rate_limited':
    case 'timeout':
      return true;
    case 'not_configured':
    case 'auth_failed':
    case 'cancelled':
    case 'invalid_response':
    case 'mode_unavailable':
      return false;
  }
};

/**
 * Maps an HTTP status code from a provider response to a gateway code.
 */
export const httpStatusToGatewayCode = (status: number): AiGatewayErrorCode => {
  if (status === 401 || status === 403) {
    return 'auth_failed';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status >= 500) {
    return 'provider_unreachable';
  }
  return 'invalid_response';
};

/** Returns true when the error represents an abort/cancellation. */
export const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
};

/**
 * Normalizes any thrown value into an AiGatewayException, preserving the
 * original message so existing call-site expectations keep matching.
 */
export const toAiGatewayError = (options: {
  error: unknown;
  capability: AiCapability;
  mode: AiMode;
  provider?: string;
}): AiGatewayException => {
  const { error, capability, mode, provider } = options;

  if (isAiGatewayError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  const code = classifyErrorMessage({ error, message });

  return createAiGatewayError({
    code,
    capability,
    mode,
    provider,
    message,
    originalError: error,
  });
};

/**
 * Heuristic classification of raw errors into normalized gateway codes.
 */
const classifyErrorMessage = (options: { error: unknown; message: string }): AiGatewayErrorCode => {
  const { error, message } = options;

  if (isAbortError(error)) {
    return 'cancelled';
  }

  const lower = message.toLowerCase();

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'timeout';
  }
  if (lower.includes('no endpoint configured') || lower.includes('provider configured')) {
    return 'not_configured';
  }

  const httpMatch = message.match(/HTTP (\d{3})/);
  if (httpMatch) {
    return httpStatusToGatewayCode(Number(httpMatch[1]));
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('connection refused') ||
    lower.includes('network')
  ) {
    return 'provider_unreachable';
  }

  if (lower.includes('json') || lower.includes('no response body')) {
    return 'invalid_response';
  }

  return 'provider_unreachable';
};
