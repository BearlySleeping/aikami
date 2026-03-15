import { toAppErrorFromUnknownError } from '@aikami/utils';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { logger } from '$logger';

// This type definition remains the same
export type APICalls = Record<string, [unknown, unknown]>;

/**
 * Enhanced SvelteKit API call handler.
 *
 * This function wraps an endpoint's logic with centralized error handling,
 * logging, and now, conditional request body parsing to support large
 * payloads.
 *
 * @param endpoint - The name of the API endpoint for logging purposes.
 * @param event - The SvelteKit RequestEvent object.
 * @param promise - The async function containing the endpoint's business logic.
 * @param options - Optional configuration for this specific API call.
 * @param options.bodySizeLimit - If provided, the body will be parsed manually
 *   with a size check against this limit (in bytes). If omitted, SvelteKit's
 *   default parser and limit are used.
 */
export const onSvelteKitAPICall = async <
  AllFunctions extends APICalls,
  Endpoint extends keyof AllFunctions,
>(
  endpoint: Endpoint,
  event: RequestEvent,
  promise: (
    payload: AllFunctions[Endpoint][0],
  ) => AllFunctions[Endpoint][1] | Promise<AllFunctions[Endpoint][1]>,
): Promise<Response> => {
  const callEndpoint = endpoint as string;
  const apiName = `api/${callEndpoint}`;
  logger.log('onSvelteKitAPICall', apiName);

  try {
    const { request } = event;

    const payload = (await request.json()) as AllFunctions[Endpoint][0];
    // --- End of Conditional Logic ---

    logger.log(apiName, payload);

    const response = await promise(payload);

    // Return a successful response, ensuring `undefined` becomes `null` for valid JSON.
    return json({ response: response ?? null });
  } catch (err) {
    // Your original, correct error handling logic.
    const appError = toAppErrorFromUnknownError(err);
    logger.error(apiName, appError);

    // Throw the final, formatted error for SvelteKit to handle.
    throw error(appError.cause.statusCode, {
      details: appError.cause.details,
      message: appError.message,
      type: appError.cause.errorType,
    });
  }
};
