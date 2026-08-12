// packages/shared/types/src/lib/endpoints/callable_functions.ts
// biome-ignore-all lint/style/useNamingConvention: Firestack derives Cloud Function names from file names, which must be snake_case. Keys in this type map match those file names.

import type { AuthMessageData, AuthMessageResponse } from './auth.ts';

/**
 * All registered callable functions. Each key maps to [Payload, Response].
 * Add new callables here to get full type safety in the onCall handler.
 *
 * No index signature — this ensures that `CallableFunctions['landing_chat']`
 * resolves to the exact `[LandingChatRequest, LandingChatResponse]` tuple,
 * not `unknown`.
 */
export type CallableFunctions = {
  auth: [AuthMessageData, AuthMessageResponse];
  /**
   * Standalone (not routed through `auth`) because it must be callable with
   * no signed-in user — see packages/backend/auth/src/lib/poll_device_handoff.ts.
   */
  poll_device_handoff: [{ code: string }, { customFirebaseSignInToken: string | null }];
};

export type CallableFunction = keyof CallableFunctions;
export type CallableFunctionRequest<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][0];
export type CallableFunctionResponse<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][1];
