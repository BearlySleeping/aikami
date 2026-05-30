// apps/frontend/gamejs/src/core/api/providers/tts/elevenlabs_provider.ts
/**
 * ElevenLabs text-to-speech provider supporting both HTTP and WebSocket streaming.
 */
import { Node } from 'godot';
import { HttpRequestClient } from '../../http/http_request_client';
import { StreamClient } from '../../http/stream_client';
import { WebSocketClient } from '../../http/websocket_client';
import { logger } from '../../../../utils/logger';
import type { TtsRequest, TtsResponse, AudioChunkCallback } from '../../types';
import { VoiceType } from '../../types';
import { parseElevenLabsWebSocketMessage, buildElevenLabsOptions } from './elevenlabs_parsing';

const DOMAIN = 'https://api.elevenlabs.io';
const PATH = '/v1/text-to-speech';

const VOICES: Record<string, string> = {
    Rachel: '21m00Tcm4TlvDq8ikWAM',
    Drew: '29vD33N1CtxCmqQRPOHJ',
    Clyde: '2EiwWnXFnvU5JabPnv8n',
    Paul: '5Q0t7uMcjvnagumLfvZi',
    Domi: 'AZnzlk1XvdvUeBnXmlld',
    Dave: 'CYw3kZ02Hs0563khs1Fj',
    Fin: 'D38z5RcWu1voky8WS1ja',
    Sarah: 'EXAVITQu4vr4xnSDxMaL',
    Antoni: 'ErXwobaYiN019PkySvjV',
    Thomas: 'GBv7mTt0atIp3Br8iCZE',
    Charlie: 'IKne3meq5aSn9XLyUdCD',
    George: 'JBFqnCBsd6RMkjVDRZzb',
    Emily: 'LcfcDJNUP1GQjkzn1xUU',
    Elli: 'MF3mGyEYCl7XYWbV9V6O',
    Callum: 'N2lVS1w4EtoT3dr4eOWO',
    Patrick: 'ODq5zmih8GrVes37Dizd',
    Harry: 'SOYHLrjzK2X1ezoPC6cr',
    Liam: 'TX3LPaxmHKxFdv7VOQHJ',
    Dorothy: 'ThT5KcBeYPX3keUQqHPh',
    Josh: 'TxGEqnHWrfWFTfGW9XjX',
    Arnold: 'VR6AewLTigWG4xSOukaG',
    Charlotte: 'XB0fDUnXU5powFXDhCwa',
    Alice: 'Xb7hH8MSUJpSbSDYk0k2',
    Matilda: 'XrExE9yKIg1WjnnlVkGX',
    Matthew: 'Yko7PKHZNXotIFUBG7I9',
    James: 'ZQe5CZNOzWyzPSCn5a3c',
    Joseph: 'Zlb1dXrM653N07WRdFW3',
    Jeremy: 'bVMeCyTHy58xNoL34h3p',
    Michael: 'flq6f7yk4E4fJM5XTYuZ',
    Ethan: 'g5CIjZEefAph4nQFvHAz',
    Chris: 'iP95p4xoKVk53GoZ742B',
    Gigi: 'jBpfuIE2acCO8z3wKNLl',
    Freya: 'jsCqWAovK2LkecY7zXl4',
    Brian: 'nPczCjzI2devNBz1zQrb',
    Grace: 'oWAxZDx7w5VEj9dCyTzz',
    Daniel: 'onwK4e9ZLuTAKqWW03F9',
    Lily: 'pFZP5JQG7iQjIQuC4Bku',
    Serena: 'pMsXgVXv3BLzUgSXRplE',
    Adam: 'pNInz6obpgDQGcFmaJgB',
    Nicole: 'piTKgcLEGmPE4e6mEKli',
    Bill: 'pqHfZKP75CvOlQylNhV4',
    Jessie: 't0jbNlBVZ17f02VDIeMI',
    Sam: 'yoZ06aMxZJJ28mfd3POQ',
    Glinda: 'z9fAnlkpzviPz146aGWa',
    Giovanni: 'zcAOhNBS3c14rBihAFp1',
    Mimi: 'zrHiDhphv9ZnVXBqCLjz',
};

const VOICE_TYPE_MAP: Record<VoiceType, string> = {
    [VoiceType.MALE_OLD]: VOICES.Drew,
    [VoiceType.MALE_DEFAULT]: VOICES.Ethan,
    [VoiceType.MALE_CHILD]: VOICES.Adam,
    [VoiceType.FEMALE_OLD]: VOICES.Glinda,
    [VoiceType.FEMALE_DEFAULT]: VOICES.Lily,
    [VoiceType.FEMALE_CHILD]: VOICES.Mimi,
};

export type ElevenLabsProviderOptions = {
    apiKey: string;
    parentNode: Node;
    useStreamMode?: boolean;
    onAudioChunk?: AudioChunkCallback;
};

export default class ElevenLabsProvider {
    private _apiKey: string;
    private _httpClient: HttpRequestClient;
    private _streamClient: StreamClient;
    private _webSocketClient: WebSocketClient;
    private _useStreamMode: boolean;
    private _onAudioChunk?: AudioChunkCallback;
    private _currentVoiceType: VoiceType = VoiceType.MALE_DEFAULT;
    private _socketIsConnected: boolean = false;
    private _textBuffer: string[] = [];

    constructor(options: ElevenLabsProviderOptions) {
        this._apiKey = options.apiKey;
        this._useStreamMode = options.useStreamMode ?? true;
        this._onAudioChunk = options.onAudioChunk;
        this._httpClient = new HttpRequestClient();
        this._httpClient.initWithParent(options.parentNode);
        this._streamClient = new StreamClient();
        this._webSocketClient = new WebSocketClient();
        logger.debug('ElevenLabsProvider.constructor', 'Initialized');
    }

    /**
     * Set the active voice type.
     */
    setVoiceType(voiceType: VoiceType): void {
        logger.debug('ElevenLabsProvider.setVoiceType', voiceType);
        this._currentVoiceType = voiceType;
    }

    /**
     * Convert text to speech.
     * Uses WebSocket streaming in stream mode, HTTP otherwise.
     */
    async textToSpeech(request: TtsRequest): Promise<TtsResponse> {
        logger.debug('ElevenLabsProvider.textToSpeech', { text: request.text, voiceType: request.voiceType });
        this._currentVoiceType = request.voiceType as VoiceType ?? this._currentVoiceType;

        const options = buildElevenLabsOptions(request.text);
        const path = this._getPath(this._useStreamMode);

        if (this._useStreamMode) {
            await this._makeStreamRequest(path, options);
            return {};
        }

        const response = await this._makeRequest(path, options);
        return response;
    }

    /**
     * Handle a text chunk for real-time streaming TTS.
     * Pass empty string to initialize the WebSocket connection.
     * Pass empty string after text to close the connection.
     */
    handleTextChunk(chunk: string): void {
        logger.debug('ElevenLabsProvider.handleTextChunk', chunk);

        if (!chunk && !this._socketIsConnected) {
            this._setupSocket();
            return;
        }

        this._textBuffer.push(chunk);

        if (!this._socketIsConnected) {
            return;
        }

        for (const bufferedText of this._textBuffer) {
            const message = JSON.stringify({
                text: bufferedText,
                try_trigger_generation: !!bufferedText,
            });
            this._webSocketClient.sendText(message);
        }

        if (!chunk) {
            this._socketIsConnected = false;
        }

        this._textBuffer = [];
    }

    dispose(): void {
        logger.debug('ElevenLabsProvider.dispose', 'Cleaning up');
        this._httpClient.dispose();
        this._streamClient.dispose();
        this._webSocketClient.dispose();
    }

    private _getVoiceId(): string {
        return VOICE_TYPE_MAP[this._currentVoiceType] ?? VOICES.Alice;
    }

    private _getHeaders(): string[] {
        return [`xi-api-key: ${this._apiKey}`, 'Content-Type: application/json'];
    }

    private _getPath(useStream: boolean): string {
        let path = `${PATH}/${this._getVoiceId()}`;
        if (useStream) {
            path += '/stream';
        }
        return path;
    }

    private async _makeStreamRequest(path: string, options: Record<string, unknown>): Promise<void> {
        const streamClient = this._streamClient;
        const headers = this._getHeaders();

        return new Promise<void>((resolve) => {
            const onComplete = (): void => {
                resolve();
            };

            const onError = (): void => {
                resolve();
            };

            const onChunk = (chunk: string): void => {
                logger.debug('ElevenLabsProvider._makeStreamRequest.chunk', chunk.length);
            };

            streamClient.connectToHost({
                domain: DOMAIN,
                path,
                headers,
                body: JSON.stringify(options),
                port: 443,
                onChunk,
                onComplete,
                onError,
            });
        });
    }

    private _makeRequest(path: string, options: Record<string, unknown>): Promise<TtsResponse> {
        const httpClient = this._httpClient;
        const headers = this._getHeaders();
        const url = DOMAIN + path;

        return new Promise<TtsResponse>((resolve) => {
            httpClient.request({
                url,
                headers,
                body: JSON.stringify(options),
            }, (response) => {
                if (response.error) {
                    logger.error('ElevenLabsProvider._makeRequest', response.error);
                    resolve({ error: response.error });
                    return;
                }

                resolve({});
            });
        });
    }

    private _setupSocket(): void {
        const voiceId = this._getVoiceId();
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_monolingual_v1`;
        const webSocketClient = this._webSocketClient;
        const apiKey = this._apiKey;
        const onAudioChunk = this._onAudioChunk;

        webSocketClient.connectToUrl({
            url,
            onMessage: (message: string): void => {
                const result = parseElevenLabsWebSocketMessage(message);
                if (result.error) {
                    logger.error('ElevenLabsProvider._setupSocket.onMessage', result.error);
                    return;
                }
                if (result.audio) {
                    onAudioChunk?.(result.audio);
                }
            },
            onConnected: (): void => {
                logger.info('ElevenLabsProvider._setupSocket', 'WebSocket connected');
                webSocketClient.sendText(
                    JSON.stringify({
                        text: ' ',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.8,
                            style: 0,
                            use_speaker_boost: true,
                        },
                        xi_api_key: apiKey,
                    }),
                );
                this._socketIsConnected = true;
            },
            onDisconnected: (): void => {
                logger.info('ElevenLabsProvider._setupSocket', 'WebSocket disconnected');
                this._socketIsConnected = false;
            },
            onError: (error: string): void => {
                logger.error('ElevenLabsProvider._setupSocket', error);
            },
        });
    }
}

export { ElevenLabsProvider };
