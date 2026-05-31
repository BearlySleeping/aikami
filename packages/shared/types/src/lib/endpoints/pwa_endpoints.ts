/**
 * PWA Call endpoint types.
 *
 * Each key in PWACalls is an API path (e.g. 'auth', 'email-connections').
 * The key MUST match the file path under src/routes/api/.
 *
 * Each value is a tuple [Request, Response] where Request is the JSON body
 * the client sends and Response is the shape returned after unwrapping
 * onSvelteKitAPICall's { response: ... } wrapper.
 *
 * Usage:
 *   PWACalls['email-connections'][0]  → request shape
 *   PWACalls['email-connections'][1]  → response shape
 */

import type { AIMessageData, AIMessageResponse } from './ai.ts';
import type { AuthMessageData, AuthMessageResponse } from './auth.ts';
import type { ChatMessageData, ChatMessageResponse } from './chat.ts';

export type PWACallEndpoint = keyof PWACalls;

export type PWACallRequest<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][0];

export type PWACallResponse<T extends PWACallEndpoint = PWACallEndpoint> = PWACalls[T][1];

/**
 * Registry of all PWA API endpoints.
 *
 * Keys are API paths (e.g. 'auth', 'auth/cookie', 'email-connections').
 * Each maps to a [Request, Response] tuple.
 *
 * When adding a new endpoint:
 *  1. Create a new file `endpoint_{name}.ts` in this directory
 *  2. Define `{Name}ApiEvents`, `{Name}MessageData`, `{Name}MessagePayload`,
 *     `{Name}MessageResponse`, and `{Name}MessageType` (see endpoint_auth.ts)
 *  3. Import the new types here and add the [Request, Response] tuple
 *  4. Create the route file at src/routes/api/{path}/+server.ts
 *  5. Wire the client-side call through internalAPIService or a typed service
 *
 * For endpoints with a single action (one request/response pair), the
 * ApiEvents map can contain one entry. For multi-action endpoints, add
 * one entry per action — the `type` field in the message data acts as
 * the discriminator in both the client and server handler.
 */
export type PWACalls = {
  auth: [AuthMessageData, AuthMessageResponse];
  'auth/session': [{ token?: string }, undefined];
  chat: [ChatMessageData, ChatMessageResponse];
  ai: [AIMessageData, AIMessageResponse];
};
