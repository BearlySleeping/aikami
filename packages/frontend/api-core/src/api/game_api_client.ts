// packages/frontend/api-core/src/api/game_api_client.ts

import type { GameApiClientInterface } from './game_api_client_interface.ts';
import type { GameApiClientConfig, RequestOptions } from './types.ts';
import { ApiError } from './errors.ts';

/**
 * Default implementation of {@link GameApiClientInterface}.
 *
 * Uses plain `fetch()` for all communication. No Firebase SDK dependencies.
 * Supports auth token injection, configurable timeouts, and retry with
 * exponential backoff for transient failures.
 */
class GameApiClient implements GameApiClientInterface {
  readonly baseUrl: string;

  private authToken: string | null = null;
  private defaultTimeout: number;
  private defaultRetry: { maxRetries: number; initialDelayMs: number };
  private defaultHeaders: Record<string, string>;

  /**
   * @param config - Client configuration.
   */
  constructor(config: GameApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.defaultTimeout = config.defaultTimeout ?? 15000;
    this.defaultRetry = {
      maxRetries: config.defaultRetry?.maxRetries ?? 3,
      initialDelayMs: config.defaultRetry?.initialDelayMs ?? 1000,
    };
    this.defaultHeaders = { ...config.defaultHeaders };
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  // -----------------------------------------------------------------------
  // HTTP Methods
  // -----------------------------------------------------------------------

  async post<TResponse, TRequest = unknown>(
    path: string,
    body: TRequest,
    options?: RequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>('POST', path, body, options);
  }

  async get<TResponse>(path: string, options?: RequestOptions): Promise<TResponse> {
    return this.request<TResponse>('GET', path, undefined, options);
  }

  // -----------------------------------------------------------------------
  // Core Request Logic
  // -----------------------------------------------------------------------

  private async request<TResponse>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<TResponse> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const retryConfig = { ...this.defaultRetry, ...options?.retry };
    const { maxRetries, initialDelayMs } = retryConfig;

    // Merge headers: default headers + auth header + request-specific headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...options?.headers,
    };

    if (this.authToken !== null) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const signal = options?.signal
          ? combineSignals(options.signal, controller.signal)
          : controller.signal;

        const fetchOptions: RequestInit = {
          method,
          headers,
          signal,
        };

        if (body !== undefined && method !== 'GET') {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        // Successful response
        if (response.ok) {
          const text = await response.text();

          if (text.length === 0) {
            return undefined as TResponse;
          }

          return JSON.parse(text) as TResponse;
        }

        // Error response — map to ApiError
        const errorText = await response.text().catch(() => '');
        lastError = ApiError.fromStatus(
          response.status,
          errorText || `HTTP ${response.status}`,
        );

        // Only retry on transient statuses (5xx, 408, 429)
        if (!isRetryable(response.status)) {
          throw lastError;
        }
      } catch (err) {
        if (err instanceof ApiError) {
          // Already mapped — re-throw non-retryable or last attempt
          if (err.status !== null && !isRetryable(err.status)) {
            throw err;
          }
          lastError = err;
        } else if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = ApiError.fromNetworkError(new Error('Request timed out'));
        } else {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // If we've exhausted retries, throw the last error
      if (attempt >= maxRetries) {
        if (lastError instanceof ApiError) {
          throw lastError;
        }
        throw ApiError.fromNetworkError(lastError);
      }

      // Wait before retrying (exponential backoff)
      const delay = initialDelayMs * 2 ** attempt;
      await sleep(delay);
    }

    // Unreachable — loop always throws or returns
    throw lastError ?? new Error('Unexpected error');
  }
}

export { GameApiClient };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether an HTTP status code indicates a transient failure that should be retried.
 */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Promisified setTimeout.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Combines multiple AbortSignals into one — aborts when any parent aborts.
 */
function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);

      return controller.signal;
    }

    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}
