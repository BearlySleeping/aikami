// packages/utils/src/lib/common/error.ts
import type { AppError, ErrorType } from '@aikami/types';
/**
 * Convert an error type to a [HTTP status
 * code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses)
 * from the range 400-599.
 *
 * @param errorType The error type.
 * @returns The [HTTP status
 *   code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses).
 *   Must be in the range 400-599.
 */
export const toHttpErrorStatusCode = (errorType: ErrorType): AppError['cause']['statusCode'] => {
  switch (errorType) {
    case 'cancelled':
      return 499;
    case 'invalid-argument':
      return 400;
    case 'deadline-exceeded':
      return 504;
    case 'not-found':
      return 404;
    case 'already-exists':
      return 409;
    case 'permission-denied':
      return 403;
    case 'resource-exhausted':
      return 429;
    case 'failed-precondition':
      return 400;
    case 'aborted':
      return 409;
    case 'out-of-range':
      return 400;
    case 'unimplemented':
      return 501;
    case 'unavailable':
      return 503;
    case 'unauthenticated':
    case 'invalid-credentials':
      return 401;
    default:
      return 500;
  }
};

/**
 * Get a Error object that the frontend can easily read and understand from when
 * thrown.
 *
 * @param errorType The error type.
 * @param errorMessage The error message.
 * @param details The error details.
 * @returns A HttpsError.
 */
export const toAppError = (errorType: ErrorType, errorMessage: string, details?: unknown): Error =>
  new Error(errorMessage, {
    cause: {
      details,
      errorType,
      statusCode: toHttpErrorStatusCode(errorType),
    } satisfies AppError['cause'],
  });

export const toAppErrorFromUnknownError = (error: unknown): AppError => {
  if (!(error instanceof Error)) {
    return {
      cause: {
        details: error,
        errorType: 'unknown',
        statusCode: 500,
      },
      message: typeof error === 'string' ? error : 'Unknown error',
    } satisfies AppError;
  }

  // 1. Check if it already has our AppError 'cause' structure
  const cause = error.cause as AppError['cause'] | undefined;
  if (cause?.errorType) {
    return {
      message: error.message,
      cause: {
        details: cause.details,
        errorType: cause.errorType,
        statusCode: cause.statusCode ?? 500,
      },
    } satisfies AppError;
  }

  // 2. Check if it's a Firebase-style error (has a string 'code' property)
  if ('code' in error && typeof (error as Record<string, unknown>).code === 'string') {
    const firebaseCode = (error as Record<string, unknown>).code as string;

    // Map Firebase codes to our AppError types
    let mappedErrorType: ErrorType = 'unknown';
    if (firebaseCode === 'auth/user-not-found') mappedErrorType = 'user-not-found';
    else if (firebaseCode === 'auth/invalid-credential' || firebaseCode === 'auth/wrong-password')
      mappedErrorType = 'invalid-credentials';
    else if (firebaseCode.startsWith('auth/')) mappedErrorType = 'unauthenticated';

    return {
      message: error.message, // Keep the original Firebase message
      cause: {
        details: { code: firebaseCode }, // Store the exact Firebase code in details
        errorType: mappedErrorType,
        statusCode: toHttpErrorStatusCode(mappedErrorType),
      },
    } satisfies AppError;
  }

  // 3. Fallback for standard JS Errors that have no cause or code
  return {
    message: error.message,
    cause: {
      details: undefined,
      errorType: 'unknown',
      statusCode: 500,
    },
  } satisfies AppError;
};
