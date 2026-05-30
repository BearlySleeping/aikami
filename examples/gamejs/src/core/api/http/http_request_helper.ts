// apps/frontend/gamejs/src/core/api/http/http_request_helper.ts
/**
 * Makes an HTTP request and returns a Promise.
 * This is a standalone function to avoid GodotJS Promise conversion issues.
 */
import type { HttpRequestClient } from './http_request_client';
import type { HttpRequestOptions, HttpResponse } from './http_request_client';

export function makeHttpRequestPromise(
    httpClient: HttpRequestClient,
    options: HttpRequestOptions,
): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve) => {
        httpClient.request(options, (response) => {
            resolve(response);
        });
    });
}