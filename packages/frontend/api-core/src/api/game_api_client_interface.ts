// packages/frontend/api-core/src/api/game_api_client_interface.ts

import type { RequestOptions } from './types.ts';

/**
 * Typed HTTP client for game engine ↔ backend communication.
 *
 * Uses plain `fetch()` — no Firebase SDKs. Auth tokens are injected as
 * headers, not managed by Firebase Auth (the SvelteKit UI layer obtains
 * tokens and pushes them to the game engine via EngineBridge).
 *
 * All payloads and responses are plain serializable objects.
 * No Firebase SDK imports in this interface or its implementations.
 */
export interface GameApiClientInterface {
  /** Base URL for all requests. */
  readonly baseUrl: string;

  /** Whether an auth token has been set. */
  isAuthenticated(): boolean;

  /**
   * Sets or clears the auth token for subsequent requests.
   *
   * @param token - The bearer token, or null to clear.
   */
  setAuthToken(token: string | null): void;

  /**
   * POST request to a backend endpoint.
   *
   * @typeParam TResponse - Expected response body type.
   * @typeParam TRequest - Request body type.
   * @param path - URL path relative to baseUrl (e.g. '/api/prompt_ai').
   * @param body - Request payload.
   * @param options - Optional request config (timeout, signal, retry, headers).
   * @returns Parsed response body.
   */
  post<TResponse, TRequest = unknown>(
    path: string,
    body: TRequest,
    options?: RequestOptions,
  ): Promise<TResponse>;

  /**
   * GET request to a backend endpoint.
   *
   * @typeParam TResponse - Expected response body type.
   * @param path - URL path relative to baseUrl.
   * @param options - Optional request config (timeout, signal, retry, headers).
   * @returns Parsed response body.
   */
  get<TResponse>(path: string, options?: RequestOptions): Promise<TResponse>;
}
