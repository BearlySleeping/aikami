// apps/frontend/gamejs/src/core/api/http/http_request_client.ts
/**
 * Wrapper around Godot's HTTPRequest node for simple non-streaming HTTP calls.
 * Extends Node so GodotJS can properly bridge instances.
 */
import { Callable, HTTPRequest, Node } from 'godot';
import { logger } from '../../../utils/logger';

export type HttpRequestOptions = {
    url: string;
    headers?: string[];
    method?: number;
    body?: string;
};

export type HttpResponse = {
    data: unknown;
    error?: string;
    statusCode?: number;
};

type HttpCallback = (response: HttpResponse) => void;

export default class HttpRequestClient extends Node {
    private _httpRequest: HTTPRequest | null = null;
    private _currentCallback: HttpCallback | null = null;

    constructor() {
        super();
        this._initHttpRequest();
    }

    initWithParent(parentNode: Node): void {
        parentNode.add_child(this);
    }

    request(options: HttpRequestOptions, callback: HttpCallback): void {
        logger.debug('HttpRequestClient.request', { url: options.url, method: options.method });

        if (!this._httpRequest) {
            callback({ data: null, error: 'HttpRequestClient not initialized' });
            return;
        }

        this._currentCallback = callback;
        const error = this._httpRequest.request(
            options.url,
            options.headers ?? [],
            options.method ?? 2,
            options.body ?? '',
        );

        if (error !== 0) {
            this._currentCallback = null;
            this._on_error(`Failed to start request: ${error}`);
        }
    }

    dispose(): void {
        if (this._httpRequest) {
            this._httpRequest.queue_free();
            this._httpRequest = null;
        }
        this.queue_free();
    }

    private _initHttpRequest(): void {
        this._httpRequest = new HTTPRequest();
        this.add_child(this._httpRequest);
        this._httpRequest.request_completed.connect(Callable.create(this, this._on_request_completed));
    }

    private _on_request_completed(
        result: number,
        responseCode: number,
        _headers: string[],
        body: unknown,
    ): void {
        logger.debug('HttpRequestClient._on_request_completed', { result, responseCode });

        const callback = this._currentCallback;
        this._currentCallback = null;

        if (!callback) {
            return;
        }

        if (result !== 0) {
            callback({ data: null, error: `HTTP request failed with result: ${result}`, statusCode: responseCode });
            return;
        }

        if (responseCode < 200 || responseCode >= 300) {
            callback({ data: null, error: `HTTP request failed with status: ${responseCode}`, statusCode: responseCode });
            return;
        }

        // GodotJS passes PackedByteArray which has get_string_from_utf8()
        const godotBody = body as { get_string_from_utf8: () => string };
        let text = '';
        if (typeof godotBody.get_string_from_utf8 === 'function') {
            text = godotBody.get_string_from_utf8();
        } else if (body && typeof body === 'object' && 'length' in body) {
            const arr = body as ArrayLike<number>;
            for (let i = 0; i < arr.length; i++) {
                text += String.fromCharCode(arr[i]);
            }
        }

        if (!text) {
            callback({ data: null, statusCode: responseCode });
            return;
        }

        try {
            const json = JSON.parse(text) as unknown;
            callback({ data: json, statusCode: responseCode });
        } catch {
            callback({ data: text, statusCode: responseCode });
        }
    }

    private _on_error(error: string): void {
        if (this._currentCallback) {
            this._currentCallback({ data: null, error });
            this._currentCallback = null;
        }
    }
}

export { HttpRequestClient };