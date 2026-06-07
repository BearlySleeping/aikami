// packages/shared/types/src/lib/api/callable_functions.ts
// biome-ignore-all lint/style/useNamingConvention: Firestack derives Cloud Function names from file names, which must be snake_case. Keys in this type map match those file names.

import type { AIMessageData, AIMessageResponse } from './ai.ts';
import type { AuthMessageData, AuthMessageResponse } from './auth.ts';
import type { ChatMessageData, ChatMessageResponse } from './chat.ts';
import type { ImageMessageData, ImageMessageResponse } from './image.ts';

/**
 * All registered callable functions. Each key maps to [Payload, Response].
 * Add new callables here to get full type safety in the onCall handler.
 *
 * No index signature — this ensures that `CallableFunctions['landing_chat']`
 * resolves to the exact `[LandingChatRequest, LandingChatResponse]` tuple,
 * not `unknown`.
 */
export type CallableFunctions = {
  ai: [AIMessageData, AIMessageResponse];
  auth: [AuthMessageData, AuthMessageResponse];
  chat: [ChatMessageData, ChatMessageResponse];
  image: [ImageMessageData, ImageMessageResponse];
};

export type CallableFunction = keyof CallableFunctions;
export type CallableFunctionRequest<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][0];
export type CallableFunctionResponse<T extends CallableFunction = CallableFunction> =
  CallableFunctions[T][1];
