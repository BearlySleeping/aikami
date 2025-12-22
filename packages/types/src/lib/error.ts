import type { NumericRange } from './common.ts'

export type ErrorType =
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'not-implemented'
  | 'already-exists'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'ai_tokens_exceeded'
  | 'ai_no_text_response'
  | 'data-loss'
  | 'unauthenticated'
  | 'activity-not-found'
  | 'team-not-found'
  | 'user-not-found'
  | 'page-not-found'
  | 'video-not-found'
  | 'folder-not-found'
  | 'missing-type'
  | 'access-denied'
  | 'unauthorized'
  | 'server-error'
  | 'unknown-error'
  // CRM
  | 'user-not-created'
  | 'no-crm-team-created'
  | 'no-crm-team-created-contact-admin'
  | 'crm-member-not-in-team'
  | 'unknown-crm-provider'
  | 'reconnect-with-crm'
  | 'captcha-required'
  | 'captcha-invalid'
  | 'chrome-extension-not-signed-in'
  | 'project-not-found'

export type SvelteKitError = {
  type: ErrorType
  message?: string
  errorId?: string
  details?: unknown
}

/** Error that has been thrown by the {@link toAppError} function. */
export type AppError = {
  /**
   * A developer-facing error message, which is in English. Any user-facing
   * error message should be localized and sent in the
   * {@link HttpsError.cause}. The message may change in future versions of
   * Cloud Functions. Do not rely on the message to be accurate or to not
   * change.
   *
   * @example 'An internal error has occurred.'
   */
  message: string

  cause: {
    /**
     * A string representing the error type that signal specific error
     * conditions.
     *
     * @example 'cancelled'
     *
     * @see {@link ErrorType}
     */
    errorType: ErrorType

    /**
     * Additional error details.
     *
     * @example {"projectId": "my-project"}
     */
    details?: unknown

    /**
     * The [HTTP status
     * code](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses)
     * that should be returned for this error. Must be in the range
     * 400-599.
     *
     * @default 500
     */
    statusCode: NumericRange<400, 599>
  }
}
