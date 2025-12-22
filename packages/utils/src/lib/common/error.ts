import type { AppError, ErrorType } from '@aikami/types'
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
export const toHttpErrorStatusCode = (
  errorType: ErrorType,
): AppError['cause']['statusCode'] => {
  switch (errorType) {
    case 'cancelled':
      return 499
    case 'invalid-argument':
      return 400
    case 'deadline-exceeded':
      return 504
    case 'not-found':
      return 404
    case 'already-exists':
      return 409
    case 'permission-denied':
      return 403
    case 'resource-exhausted':
      return 429
    case 'failed-precondition':
      return 400
    case 'aborted':
      return 409
    case 'out-of-range':
      return 400
    case 'unimplemented':
      return 501
    case 'unavailable':
      return 503
    case 'unauthenticated':
      return 401
    case 'data-loss':
    case 'unknown':
    case 'internal':
    default:
      return 500
  }
}

/**
 * Get a Error object that the frontend can easily read and understand from when
 * thrown.
 *
 * @param errorType The error type.
 * @param errorMessage The error message.
 * @param details The error details.
 * @returns A HttpsError.
 */
export const toAppError = (
  errorType: ErrorType,
  errorMessage: string,
  details?: unknown,
): Error =>
  new Error(errorMessage, {
    cause: {
      details,
      errorType,
      statusCode: toHttpErrorStatusCode(errorType),
    } satisfies AppError['cause'],
  })

export const toAppErrorFromUnknownError = (error: unknown): AppError => {
  if (error instanceof Error) {
    const cause = error.cause as AppError['cause'] | undefined
    return {
      cause: {
        details: cause?.details,
        errorType: cause?.errorType ?? 'unknown',
        statusCode: cause?.statusCode ?? 500,
      },
      message: error.message,
    } satisfies AppError
  }
  return {
    cause: {
      details: error,
      errorType: 'unknown',
      statusCode: 500,
    },
    message: 'Unknown error',
  } satisfies AppError
}
