import { toAppErrorFromUnknownError } from '@aikami/utils';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { logger } from '$logger';

// ─── Helpers for mapped endpoint registries ──────────────────────────

/** All endpoint registries are { endpoint: { [T]: [Payload, Response] } }. */
export type APICalls = Record<string, Record<string, [unknown, unknown]>>;

/** Reconstruct the discriminated { type, payload } union from a mapped endpoint. */
type ReconstructMessage<T extends Record<string, [unknown, unknown]>> = {
  [K in keyof T & string]: { type: K; payload: T[K][0] };
}[keyof T & string];

/** Extract the union of all response shapes for a mapped endpoint. */
type ExtractResponse<T> = T extends Record<string, [unknown, infer Res]> ? Res : never;

export const onSvelteKitAPICall = async <
  AllFunctions extends APICalls,
  Endpoint extends keyof AllFunctions & string,
>(
  endpoint: Endpoint,
  event: RequestEvent,
  promise: (
    payload: ReconstructMessage<AllFunctions[Endpoint]>,
  ) => ExtractResponse<AllFunctions[Endpoint]> | Promise<ExtractResponse<AllFunctions[Endpoint]>>,
): Promise<Response> => {
  const callEndpoint = endpoint as string;
  const apiName = `api/${callEndpoint}`;
  logger.log('onSvelteKitAPICall', apiName);

  try {
    const { request } = event;

    const payload = (await request.json()) as ReconstructMessage<AllFunctions[Endpoint]>;

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
