// apps/frontend/gamejs/src/core/firebase/http_client.ts
/**
 * @fileoverview Firebase HTTP client for REST API calls
 * @module firebase_http_client
 * @description Manages HTTP requests to Firebase services using HTTPRequest node
 */
import { Callable, HTTPRequest, Node } from 'godot';
import { logger } from '../../utils/logger';

/**
 * @interface HttpResponse
 * @description HTTP response from Firebase API
 */
interface HttpResponse {
    body: string;
    response_code: number;
    headers: string[];
}

/**
 * @type HttpCallback
 * @description Callback for HTTP request completion
 */
type HttpCallback = (success: boolean, response: HttpResponse | null) => void;

/**
 * @class FirebaseHttpClient
 * @extends Node
 * @description Singleton service for HTTP requests
 */
export default class FirebaseHttpClient extends Node {
    private static _instance: FirebaseHttpClient | null = null;
    private _httpRequest: HTTPRequest | null = null;
    private _callback: HttpCallback | null = null;

    /**
     * @static
     * @get instance
     * @returns {FirebaseHttpClient | null}
     */
    static get instance(): FirebaseHttpClient | null {
        return FirebaseHttpClient._instance;
    }

    /** @method _ready */
    _ready(): void {
        FirebaseHttpClient._instance = this;
        (globalThis as Record<string, unknown>).firebaseHttpInstance = this;
        logger.debug('FirebaseHttpClient: _ready');

        // Create HTTPRequest node
        this._httpRequest = new HTTPRequest();
        this.add_child(this._httpRequest);
        this._httpRequest.request_completed.connect(Callable.create(this, this._on_request_completed));
    }

    /**
     * @method _on_request_completed
     * @private
     * @param {number} result - Request result
     * @param {number} responseCode - HTTP response code
     * @param {string[]} headers - Response headers
     * @param {Uint8Array} body - Response body
     */
    private _on_request_completed(result: number, responseCode: number, headers: string[], body: Uint8Array): void {
        logger.debug('FirebaseHttpClient: request_completed', result, responseCode);

        if (!this._callback) {
            return;
        }

        if (result !== 0) {
            logger.error('FirebaseHttpClient: request failed with result', result);
            this._callback(false, null);
            this._callback = null;
            return;
        }

        // GodotJS passes PackedByteArray (not Uint8Array) which has get_string_from_utf8()
        const godotBody = body as unknown as { get_string_from_utf8: () => string };
        let bodyText = '';
        if (typeof godotBody.get_string_from_utf8 === 'function') {
            bodyText = godotBody.get_string_from_utf8();
        } else if (body?.length) {
            for (let i = 0; i < body.length; i++) {
                bodyText += String.fromCharCode(body[i]);
            }
        }
        logger.debug('FirebaseHttpClient: response body length', bodyText.length, 'content:', bodyText.slice(0, 500));

        const response: HttpResponse = {
            body: bodyText,
            response_code: responseCode,
            headers,
        };

        const isSuccess = responseCode >= 200 && responseCode < 400;
        this._callback(isSuccess, response);
        this._callback = null;
    }

    /**
     * @method get
     * @param {string} _apiKey - Firebase API key (unused in emulator)
     * @param {string} url - Full URL
     * @param {HttpCallback} callback - Callback
     */
    get(_apiKey: string, url: string, callback: HttpCallback): void {
        this.request(url, [], 0, '', callback);
    }

    /**
     * @method post
     * @param {string} _apiKey - Firebase API key (unused in emulator)
     * @param {string} url - Full URL
     * @param {string} body - Body
     * @param {HttpCallback} callback - Callback
     */
    post(_apiKey: string, url: string, body: string, callback: HttpCallback): void {
        const headers = ['Content-Type: application/json'];
        this.request(url, headers, 2, body, callback);
    }

    /**
     * @method patch
     * @param {string} _apiKey - Firebase API key (unused in emulator)
     * @param {string} url - Full URL
     * @param {string} body - Body
     * @param {HttpCallback} callback - Callback
     */
    patch(_apiKey: string, url: string, body: string, callback: HttpCallback): void {
        const headers = ['Content-Type: application/json'];
        this.request(url, headers, 8, body, callback);
    }

    /**
     * @method post_with_content_type
     * @param {string} _apiKey - Firebase API key (unused in emulator)
     * @param {string} url - Full URL
     * @param {string} body - Body
     * @param {string} contentType - Content type header
     * @param {HttpCallback} callback - Callback
     */
    post_with_content_type(
        _apiKey: string,
        url: string,
        body: string,
        contentType: string,
        callback: HttpCallback,
    ): void {
        const headers = [`Content-Type: ${contentType}`];
        this.request(url, headers, 2, body, callback);
    }

    /**
     * @method request
     * @private
     * @param {string} url - Full URL
     * @param {string[]} headers - Request headers
     * @param {number} method - HTTP method
     * @param {string} body - Body
     * @param {HttpCallback} callback - Callback
     */
    private request(url: string, headers: string[], method: number, body: string, callback: HttpCallback): void {
        if (this._callback) {
            logger.debug('FirebaseHttpClient: busy');
            callback(false, null);
            return;
        }

        const methodName = method === 0 ? 'GET' : method === 2 ? 'POST' : method === 8 ? 'PATCH' : String(method);
        logger.debug(
            'FirebaseHttpClient: request',
            url,
            'method:',
            methodName,
            'value:',
            method,
            'body:',
            body.slice(0, 100),
        );
        this._callback = callback;

        // Add emulator bypass header for local endpoints
        const allHeaders = [...headers];
        if (url.includes('127.0.0.1') || url.includes('localhost')) {
            allHeaders.push('Authorization: Bearer owner');
        }

        if (!this._httpRequest) {
            logger.error('FirebaseHttpClient: HTTPRequest not initialized');
            callback(false, null);
            this._callback = null;
            return;
        }

        const error = this._httpRequest.request(url, allHeaders, method, body);
        if (error) {
            logger.error('FirebaseHttpClient: request error', error);
            callback(false, null);
            this._callback = null;
        }
    }
}
