// packages/shared/types/src/lib/api/request_functions.ts
// biome-ignore-all lint/style/useNamingConvention: Firestack derives Cloud Function names from file names, which must be snake_case. Keys in this type map match those file names.
import type { AIMessageData, AIMessageResponse } from './ai.ts';

/**
 * All registered request functions. Each key maps to [Payload, Response].
 * Add new requests here to get full type safety in the onCall handler.
 *
 * No index signature — this ensures that `RequestFunctions['landing_chat']`
 * resolves to the exact `[LandingChatRequest, LandingChatResponse]` tuple,
 * not `unknown`.
 */
export type RequestFunctions = {
  ai: [AIMessageData, AIMessageResponse];
};

export type RequestFunction = keyof RequestFunctions;
export type RequestFunctionRequest<T extends RequestFunction = RequestFunction> =
  RequestFunctions[T][0];
export type RequestFunctionResponse<T extends RequestFunction = RequestFunction> =
  RequestFunctions[T][1];
