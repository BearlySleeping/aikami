import type { CallableContext, CommonError, Response, UserClaims } from '@aikami/types';
import { toUserClaims } from '@aikami/utils';
import { https } from 'firebase-functions';

/** @see https://firebase.google.com/docs/reference/functions/providers_https_#functionserrorcode */
type HttpsErrorType =
  | 'aborted'
  | 'already-exists'
  | 'cancelled'
  | 'data-loss'
  | 'deadline-exceeded'
  | 'failed-precondition'
  | 'internal'
  | 'invalid-argument'
  | 'not-found'
  | 'ok'
  | 'out-of-range'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'unauthenticated'
  | 'unavailable'
  | 'unimplemented'
  | 'unknown';

/**
 * Get a Error object that the frontend can easily read and understand from when
 * thrown.
 *
 * @param errorCode The error code
 * @param errorMessage The error message.
 * @param details The error details.
 * @returns A HttpsError.
 */
export const toHttpsError = (
  errorCode: HttpsErrorType,
  errorMessage: string,
  details?: unknown,
): https.HttpsError => new https.HttpsError(errorCode, errorMessage, details);

/**
 * Validates auth context for callable function for an active user. Throws
 * permission-denied error `context.auth` is undefined
 *
 * @param context the firebase context
 * @returns the user claims
 */
export const assertUser = (context: CallableContext): UserClaims => {
  if (!context.auth) {
    throw toHttpsError('permission-denied', 'function called without context.auth');
  } else {
    return toUserClaims(context.auth);
  }
};

/**
 * Validates auth context for callable function for an active user. Throws
 * permission-denied error if userRole is not `superAdmin
 *
 * @param context the firebase context
 * @returns the user claims
 */
export const assertSuperAdmin = (context: CallableContext): UserClaims => {
  if (!context.auth) {
    throw toHttpsError('permission-denied', 'function called without context.auth');
  }
  const userClaims = toUserClaims(context.auth);

  if (userClaims.userRole !== 'superAdmin') {
    throw toHttpsError('permission-denied', 'function called without context.auth');
  } else {
    return userClaims;
  }
};

/**
 * Sends a descriptive error response when running a callable function
 *
 * @param promise the function
 */
export const catchErrors = async <T>(promise: Promise<T> | T): Promise<T> => {
  try {
    const response = await promise;
    return response;
  } catch (error_) {
    const error =
      error_ instanceof https.HttpsError
        ? error_
        : toHttpsError('unknown', (error_ as CommonError).message ?? '', error_);
    throw error;
  }
};

/**
 * Sends a descriptive error response when running a callable function
 *
 * @param response the response object
 * @param promise the function
 */
export const catchAPIErrors = async (
  response: Response,
  promise: () => Promise<void>,
): Promise<void> => {
  try {
    await promise();
  } catch (error) {
    response.status(500).send(error);
  }
};
