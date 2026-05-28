// apps/frontend/gamejs/src/core/api/http/stream_client.ts
/**
 * SSE (Server-Sent Events) streaming client using Godot's low-level HTTPClient.
 * Designed to be polled from a node's _process loop.
 */
import { HTTPClient, Node } from 'godot';
import { logger } from '../../../utils/logger';

export type StreamChunkCallback = (chunk: string) => void;
export type StreamCompleteCallback = () => void;
export type StreamErrorCallback = (error: string) => void;

export type StreamClientOptions = {
    domain: string;
    path: string;
    headers: string[];
    body: string;
    port?: number;
    onChunk: StreamChunkCallback;
    onComplete: StreamCompleteCallback;
    onError: StreamErrorCallback;
};

/**
 * Manages a persistent HTTP connection for SSE streaming.
 * Extends Node so `_process()` can poll the HTTP client automatically.
 */
export default class StreamClient extends Node {
    private _client: HTTPClient;
    private _isStreamActive: boolean = false;
    private _isRequested: boolean = false;
    private _isConnected: boolean = false;
    private _domain: string = '';
    private _path: string = '';
    private _port: number = -1;
    private _headers: string[] = [];
    private _body: string = '';
    private _onChunk: StreamChunkCallback = () => {};
    private _onComplete: StreamCompleteCallback = () => {};
    private _onError: StreamErrorCallback = () => {};
    private _buffer: string = '';
    private _requestStartTime: number = 0;
    private static readonly _REQUEST_TIMEOUT_MS = 20000;

    constructor() {
        super();
        this._client = new HTTPClient();
    }

    _process(_delta: number): void {
        this.poll();
        this._checkTimeout();
    }

    initWithParent(parentNode: Node): void {
        parentNode.add_child(this);
    }

    /**
     * Connect to a host and begin an SSE stream.
     */
    connectToHost(options: StreamClientOptions): void {
        logger.info('StreamClient.connectToHost', { domain: options.domain, path: options.path });

        this._body = options.body;
        this._isRequested = false;
        this._onChunk = options.onChunk;
        this._onComplete = options.onComplete;
        this._onError = options.onError;
        this._buffer = '';

        const hasSameConnection =
            this._domain === options.domain &&
            this._path === options.path &&
            this._port === (options.port ?? 443) &&
            JSON.stringify(this._headers) === JSON.stringify(options.headers);

        if (hasSameConnection && this._isConnected) {
            this._isStreamActive = true;
            return;
        }

        this._domain = options.domain;
        this._path = options.path;
        this._headers = options.headers;
        this._port = options.port ?? 443;

        if (this._attemptToConnect()) {
            this._isStreamActive = true;
        }
    }

    /**
     * Poll the HTTP client. Call this every frame from `_process`.
     */
    poll(): void {
        if (!this._isStreamActive) {
            this._handleStatusWhenNotRunning();
            return;
        }

        const httpStatus = this._getHttpStatus();

        if (!this._isRequested) {
            this._attemptToRequest(httpStatus);
            return;
        }

        if (!this._client.has_response()) {
            return;
        }

        // Check response code as soon as headers arrive
        if (this._client.get_response_code() >= 400) {
            const errorBody = this._readErrorBody();
            this.handleStreamError(`HTTP ${this._client.get_response_code()}: ${errorBody}`);
            return;
        }

        if (httpStatus !== 7 /* HTTPClient.STATUS_BODY */) {
            return;
        }

        this._handleResponse();
    }

    private _readErrorBody(): string {
        const chunk = this._client.read_response_body_chunk();
        const godotBody = chunk as unknown as { get_string_from_utf8: () => string; length: number };
        if (godotBody.length === 0) {
            return '';
        }
        return godotBody.get_string_from_utf8();
    }

    /**
     * Signal that the stream should stop after the current request finishes,
     * but keep the connection open.
     */
    finishRequest(): void {
        this._isStreamActive = false;
        this._onComplete();
    }

    /**
     * Close the connection entirely.
     */
    closeConnection(): void {
        this._client.close();
        this._isConnected = false;
        this._isStreamActive = false;
        this._isRequested = false;
    }

    /**
     * Handle a fatal stream error.
     */
    handleStreamError(error: string): void {
        logger.error('StreamClient.handleStreamError', error);
        this._onError(error);
        this.closeConnection();
    }

    dispose(): void {
        this.closeConnection();
        this.queue_free();
    }

    private _checkTimeout(): void {
        if (!this._isStreamActive || !this._isRequested || this._requestStartTime === 0) {
            return;
        }
        const elapsed = Date.now() - this._requestStartTime;
        if (elapsed > StreamClient._REQUEST_TIMEOUT_MS) {
            this.handleStreamError(`Request timed out after ${StreamClient._REQUEST_TIMEOUT_MS}ms`);
        }
    }

    private _handleResponse(): void {
        const chunk = this._client.read_response_body_chunk();
        const godotBody = chunk as unknown as { get_string_from_utf8: () => string; length: number };
        if (godotBody.length === 0) {
            return;
        }

        const text = godotBody.get_string_from_utf8();
        this._buffer += text;
        this._processBuffer();
    }

    private _processBuffer(): void {
        const lines = this._buffer.split('\n');
        this._buffer = this._buffer.endsWith('\n') ? '' : lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) {
                continue;
            }
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
                this.finishRequest();
                return;
            }
            this._onChunk(data);
        }
    }

    private _getHttpStatus(): number {
        this._client.poll();
        return this._client.get_status();
    }

    private _handleStatusWhenNotRunning(): void {
        if (!this._isConnected) {
            return;
        }
        const httpStatus = this._getHttpStatus();
        if (httpStatus === 7 /* HTTPClient.STATUS_BODY */) {
            this._client.read_response_body_chunk();
        }
    }

    private _attemptToConnect(): boolean {
        const error = this._client.connect_to_host(this._domain, this._port);
        if (error.valueOf() !== 0) {
            this.handleStreamError(`Failed to connect: ${error}`);
            return false;
        }
        logger.info('StreamClient._attemptToConnect', 'OK');
        this._isConnected = true;
        return true;
    }

    private _attemptToRequest(httpClientStatus: number): void {
        if (httpClientStatus !== 5 /* HTTPClient.STATUS_CONNECTED */) {
            return;
        }
        this._isRequested = true;
        this._requestStartTime = Date.now();
        const error = this._client.request(
            2 /* HTTPClient.METHOD_POST */,
            this._path,
            this._headers,
            this._body,
        );
        if (error.valueOf() !== 0) {
            this.handleStreamError(`Failed to send request: ${error}`);
            return;
        }
        logger.info('StreamClient._attemptToRequest', 'OK');
    }
}

export { StreamClient };
