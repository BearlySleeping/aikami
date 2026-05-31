// apps/frontend/game/src/core/firebase/http_client.ts
/**
 * Lightweight HTTP client for Firebase REST API calls using browser fetch.
 * Replaces the Godot HTTPRequest node with async/await Promise-based API.
 */

/**
 * Result of an HTTP request to a Firebase REST API.
 */
export type HttpResult = {
  /** Parsed response body if JSON, raw text otherwise. */
  body: unknown;
  /** HTTP status code. */
  status: number;
  /** Response headers. */
  headers: Record<string, string>;
};

/**
 * Lightweight HTTP client using browser `fetch` API.
 * Supports GET, POST, PATCH, and DELETE with JSON handling.
 */
export class FirebaseHttpClient {
  /** Base config: API key for request auth. */
  private readonly _apiKey: string;

  constructor(options: { apiKey: string }) {
    this._apiKey = options.apiKey;
  }

  /**
   * Sends a GET request to a Firebase REST endpoint.
   * @param url - Full endpoint URL
   * @returns Parsed HTTP result
   */
  async get(url: string): Promise<HttpResult> {
    return this._request('GET', url);
  }

  /**
   * Sends a POST request with a JSON body.
   * @param url - Full endpoint URL
   * @param body - JSON-serializable payload
   * @returns Parsed HTTP result
   */
  async post(url: string, body: unknown = {}): Promise<HttpResult> {
    return this._request('POST', url, body);
  }

  /**
   * Sends a PATCH request with a JSON body.
   * @param url - Full endpoint URL
   * @param body - JSON-serializable payload
   * @returns Parsed HTTP result
   */
  async patch(url: string, body: unknown = {}): Promise<HttpResult> {
    return this._request('PATCH', url, body);
  }

  /**
   * Sends a DELETE request.
   * @param url - Full endpoint URL
   * @returns Parsed HTTP result
   */
  async delete(url: string): Promise<HttpResult> {
    return this._request('DELETE', url);
  }

  /**
   * Core request method — builds headers and parses the response.
   * @param method - HTTP method
   * @param url - Full endpoint URL
   * @param body - Optional JSON payload
   * @returns Parsed HTTP result
   */
  private async _request(method: string, url: string, body?: unknown): Promise<HttpResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Emulator bypass: add Authorization header for local endpoints
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      headers.Authorization = 'Bearer owner';
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    const headerMap: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerMap[key] = value;
    });

    const text = await response.text();
    let parsedBody: unknown = text;

    if (text && text.trim().length > 0) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        // Keep as raw text if not valid JSON
      }
    }

    return {
      body: parsedBody,
      status: response.status,
      headers: headerMap,
    };
  }

  /** Emulator-local API key for auth bypass. */
  get apiKey(): string {
    return this._apiKey;
  }
}
