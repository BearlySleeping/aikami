// apps/frontend/pwa/src/lib/client/game/services/firebase/functions.ts
/**
 * Firebase Cloud Functions REST client — no Firebase SDK.
 * Calls HTTP and callable functions via fetch.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/client/game/core/base_game_class.ts';
import { getConfig } from './config.ts';
import type { FirebaseHttpClientInterface } from './http_client.ts';

/**
 * Response from a Cloud Function call.
 */
export type FunctionsResponse<T = unknown> = {
  result?: T;
  error?: string;
};

export type FirebaseFunctionsOptions = BaseGameClassOptions & {
  http: FirebaseHttpClientInterface;
};

export type FirebaseFunctionsInterface = BaseGameClassInterface & {
  callFunction<T = unknown>(
    name: string,
    data?: Record<string, unknown>,
    region?: string,
  ): Promise<FunctionsResponse<T>>;
  callHttpFunction<T = unknown>(
    name: string,
    data?: Record<string, unknown>,
    region?: string,
  ): Promise<FunctionsResponse<T>>;
};

/**
 * Service for calling Firebase Cloud Functions via REST API.
 */
class FirebaseFunctions
  extends BaseGameClass<FirebaseFunctionsOptions>
  implements FirebaseFunctionsInterface
{
  private readonly _http: FirebaseHttpClientInterface;

  constructor(options: FirebaseFunctionsOptions) {
    super(options);
    this._http = options.http;
  }

  /**
   * Calls a callable Cloud Function.
   * Callable functions wrap data in `{ data: ... }`.
   * @param name - Function name (e.g. "generateImage")
   * @param data - Input data
   * @param region - Cloud region (default: europe-west1)
   * @returns Function result or error
   */
  async callFunction<T = unknown>(
    name: string,
    data: Record<string, unknown> = {},
    region = 'europe-west1',
  ): Promise<FunctionsResponse<T>> {
    const config = getConfig();

    // Emulator: base URL is already <host>:5001/<project>/<region>
    // Production: <region>-<project>.cloudfunctions.net
    const endpoint = config.isEmulator
      ? `${config.functionsEndpoint}/${name}`
      : `https://${region}-${config.projectId}.cloudfunctions.net/${name}`;

    try {
      const result = await this._http.post(endpoint, { data });

      const body = result.body as Record<string, unknown>;
      if (body.error) {
        return { error: String(body.error) };
      }
      return { result: body as T };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Calls an HTTP (onRequest) Cloud Function.
   * Raw body is sent directly without the `{ data: ... }` wrapper.
   * @param name - Function name
   * @param data - Input data (sent as raw JSON body)
   * @param region - Cloud region (default: europe-west1)
   * @returns Function result or error
   */
  async callHttpFunction<T = unknown>(
    name: string,
    data: Record<string, unknown> = {},
    region = 'europe-west1',
  ): Promise<FunctionsResponse<T>> {
    const config = getConfig();

    const endpoint = config.isEmulator
      ? `${config.functionsEndpoint}/${name}`
      : `https://${region}-${config.projectId}.cloudfunctions.net/${name}`;

    try {
      const result = await this._http.post(endpoint, data);

      const body = result.body as Record<string, unknown>;
      if (body.error) {
        return { error: String(body.error) };
      }
      return { result: body as T };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  override async setup(): Promise<void> {}
}

export const getFirebaseFunctions = (
  options: FirebaseFunctionsOptions,
): FirebaseFunctionsInterface => new FirebaseFunctions(options);
