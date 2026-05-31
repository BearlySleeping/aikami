// apps/frontend/game/src/core/firebase/functions.ts
/**
 * Firebase Cloud Functions REST client — no Firebase SDK.
 * Calls HTTP and callable functions via fetch.
 */

import { getConfig } from './config.ts';
import type { FirebaseHttpClient } from './http_client.ts';

/**
 * Response from a Cloud Function call.
 */
export type FunctionsResponse<T = unknown> = {
  result?: T;
  error?: string;
};

/**
 * Service for calling Firebase Cloud Functions via REST API.
 */
export class FirebaseFunctions {
  private readonly _http: FirebaseHttpClient;

  constructor(http: FirebaseHttpClient) {
    this._http = http;
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
}
