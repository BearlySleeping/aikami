// apps/frontend/gamejs/src/core/api/http/websocket_client.ts
/**
 * WebSocket client wrapper around Godot's WebSocketPeer.
 * Designed to be polled from a node's _process loop.
 */
import { WebSocketPeer } from 'godot';
import { logger } from '../../../utils/logger';

export type WebSocketMessageCallback = (message: string) => void;
export type WebSocketConnectedCallback = () => void;
export type WebSocketDisconnectedCallback = () => void;
export type WebSocketErrorCallback = (error: string) => void;

export type WebSocketClientOptions = {
    url: string;
    onMessage: WebSocketMessageCallback;
    onConnected?: WebSocketConnectedCallback;
    onDisconnected?: WebSocketDisconnectedCallback;
    onError?: WebSocketErrorCallback;
};

/**
 * Manages a WebSocket connection.
 * Must have `poll()` called regularly (e.g. from `_process`).
 */
export default class WebSocketClient {
    private _peer: WebSocketPeer;
    private _onMessage: WebSocketMessageCallback = () => {};
    private _onConnected?: WebSocketConnectedCallback;
    private _onDisconnected?: WebSocketDisconnectedCallback;
    private _onError?: WebSocketErrorCallback;
    private _isConnected: boolean = false;

    constructor() {
        this._peer = new WebSocketPeer();
    }

    /**
     * Connect to a WebSocket URL.
     */
    connectToUrl(options: WebSocketClientOptions): void {
        logger.info('WebSocketClient.connectToUrl', options.url);
        this._onMessage = options.onMessage;
        this._onConnected = options.onConnected;
        this._onDisconnected = options.onDisconnected;
        this._onError = options.onError;

        const error = this._peer.connect_to_url(options.url);
        if (error.valueOf() !== 0) {
            this._handleError(`Failed to connect: ${error}`);
        }
    }

    /**
     * Send a text message over the WebSocket.
     */
    sendText(message: string): void {
        if (!this._isConnected) {
            logger.warn('WebSocketClient.sendText', 'Not connected, buffering message');
            return;
        }
        this._peer.send_text(message);
    }

    /**
     * Poll the WebSocket peer. Call this every frame from `_process`.
     */
    poll(): void {
        this._peer.poll();

        const state = this._peer.get_ready_state();

        if (state === 1 /* WebSocketPeer.STATE_OPEN */ && !this._isConnected) {
            this._isConnected = true;
            logger.info('WebSocketClient.poll', 'Connected');
            this._onConnected?.();
        }

        if (state === 3 /* WebSocketPeer.STATE_CLOSED */ && this._isConnected) {
            this._isConnected = false;
            logger.info('WebSocketClient.poll', 'Disconnected');
            this._onDisconnected?.();
        }

        if (state !== 1 /* WebSocketPeer.STATE_OPEN */) {
            return;
        }

        while (this._peer.get_available_packet_count() > 0) {
            const packet = this._peer.get_packet();
            const array = new Uint8Array(packet.to_array_buffer());
            const text = new TextDecoder().decode(array);
            if (this._peer.was_string_packet()) {
                this._onMessage(text);
            }
        }
    }

    /**
     * Close the WebSocket connection.
     */
    close(): void {
        this._peer.close();
        this._isConnected = false;
    }

    dispose(): void {
        this.close();
    }

    private _handleError(error: string): void {
        logger.error('WebSocketClient', error);
        this._onError?.(error);
    }
}

export { WebSocketClient };
