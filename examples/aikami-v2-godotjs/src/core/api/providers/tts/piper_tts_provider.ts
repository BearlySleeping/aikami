// apps/frontend/gamejs/src/core/api/providers/tts/piper_tts_provider.ts
/**
 * Piper local text-to-speech provider.
 *
 * Streams text sentence-by-sentence to a local Piper HTTP server.
 * Buffers incoming text chunks, detects sentence boundaries, and
 * fires synthesis requests as soon as a complete sentence is available.
 *
 * Expected Piper HTTP API:
 *   POST {baseUrl}/tts
 *   Body: { "text": string, "speaker_id": number }
 *   Response: { "audio": "<base64-wav>" }
 */
import { Node } from 'godot';
import { HttpRequestClient } from '../../http/http_request_client';
import { logger } from '../../../../utils/logger';
import type { TtsRequest, TtsResponse, AudioChunkCallback } from '../../types';
import { VoiceType } from '../../types';

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

const VOICE_TYPE_MAP: Record<VoiceType, number> = {
    [VoiceType.MALE_OLD]: 0,
    [VoiceType.MALE_DEFAULT]: 0,
    [VoiceType.MALE_CHILD]: 0,
    [VoiceType.FEMALE_OLD]: 1,
    [VoiceType.FEMALE_DEFAULT]: 1,
    [VoiceType.FEMALE_CHILD]: 1,
};

export type PiperTTSProviderOptions = {
    baseUrl: string;
    parentNode: Node;
    onAudioChunk?: AudioChunkCallback;
};

export default class PiperTTSProvider {
    private _baseUrl: string;
    private _parentNode: Node;
    private _onAudioChunk?: AudioChunkCallback;
    private _currentVoiceType: VoiceType = VoiceType.MALE_DEFAULT;
    private _textBuffer: string = '';
    private _synthesisQueue: Array<string> = [];
    private _isProcessing: boolean = false;

    constructor(options: PiperTTSProviderOptions) {
        logger.debug('PiperTTSProvider.constructor', { baseUrl: options.baseUrl });
        this._baseUrl = options.baseUrl.replace(/\/$/, '');
        this._parentNode = options.parentNode;
        this._onAudioChunk = options.onAudioChunk;
    }

    /**
     * Set the active voice type.
     * Maps to a Piper speaker_id.
     */
    setVoiceType(voiceType: VoiceType): void {
        logger.debug('PiperTTSProvider.setVoiceType', voiceType);
        this._currentVoiceType = voiceType;
    }

    /**
     * Convert text to speech (non-streaming).
     */
    async textToSpeech(request: TtsRequest): Promise<TtsResponse> {
        logger.debug('PiperTTSProvider.textToSpeech', { text: request.text });
        return this._synthesize(request.text);
    }

    /**
     * Handle a text chunk for real-time streaming TTS.
     * Buffers text and synthesizes complete sentences immediately.
     * Pass empty string to initialize (no-op for Piper).
     */
    handleTextChunk(chunk: string): void {
        logger.debug('PiperTTSProvider.handleTextChunk', chunk);

        if (!chunk) {
            this.flush();
            return;
        }

        this._textBuffer += chunk;
        const sentences = this._extractSentences();

        for (const sentence of sentences) {
            this._enqueueSynthesis(sentence);
        }
    }

    /**
     * Flush any remaining buffered text as a final synthesis request.
     */
    flush(): void {
        logger.debug('PiperTTSProvider.flush', this._textBuffer);
        const remaining = this._textBuffer.trim();
        if (remaining) {
            this._textBuffer = '';
            this._enqueueSynthesis(remaining);
        }
    }

    dispose(): void {
        logger.debug('PiperTTSProvider.dispose', 'Cleaning up');
        this._textBuffer = '';
        this._synthesisQueue = [];
    }

    private _getSpeakerId(): number {
        return VOICE_TYPE_MAP[this._currentVoiceType] ?? 0;
    }

    private _extractSentences(): string[] {
        const sentences: string[] = [];
        let text = this._textBuffer;

        while (true) {
            const dotIndex = text.indexOf('.');
            const bangIndex = text.indexOf('!');
            const questionIndex = text.indexOf('?');
            const newlineIndex = text.indexOf('\n');

            const indices = [dotIndex, bangIndex, questionIndex, newlineIndex].filter((i) => i !== -1);
            if (indices.length === 0) {
                break;
            }

            const boundaryIndex = Math.min(...indices);
            const sentence = text.slice(0, boundaryIndex + 1).trim();
            if (sentence) {
                sentences.push(sentence);
            }
            text = text.slice(boundaryIndex + 1).trimStart();
        }

        this._textBuffer = text;
        return sentences;
    }

    private _enqueueSynthesis(text: string): void {
        this._synthesisQueue.push(text);
        this._processQueue();
    }

    private async _processQueue(): Promise<void> {
        if (this._isProcessing || this._synthesisQueue.length === 0) {
            return;
        }

        this._isProcessing = true;
        const text = this._synthesisQueue.shift();

        if (text) {
            await this._synthesize(text);
        }

        this._isProcessing = false;
        this._processQueue();
    }

    private _synthesize(text: string): Promise<TtsResponse> {
        return new Promise<TtsResponse>((resolve) => {
            const client = new HttpRequestClient();
            client.initWithParent(this._parentNode);

            const url = `${this._baseUrl}/tts`;
            const body = JSON.stringify({
                text,
                speaker_id: this._getSpeakerId(),
            });

            logger.debug('PiperTTSProvider._synthesize', { url, textLength: text.length });

            client.request(
                {
                    url,
                    headers: ['Content-Type: application/json'],
                    body,
                },
                (response) => {
                    client.dispose();

                    if (response.error) {
                        logger.error('PiperTTSProvider._synthesize', response.error);
                        resolve({ error: response.error });
                        return;
                    }

                    const data = response.data as Record<string, unknown> | undefined;
                    if (!data) {
                        resolve({ error: 'Empty response from Piper' });
                        return;
                    }

                    if (data.error) {
                        const errorMsg = (data.error as Record<string, unknown>).message as string | undefined;
                        logger.error('PiperTTSProvider._synthesize', errorMsg ?? JSON.stringify(data.error));
                        resolve({ error: errorMsg ?? JSON.stringify(data.error) });
                        return;
                    }

                    const audioBase64 = data.audio as string | undefined;
                    if (!audioBase64) {
                        resolve({ error: 'No audio data in Piper response' });
                        return;
                    }

                    const audioData = this._base64ToArrayBuffer(audioBase64);
                    logger.info('PiperTTSProvider._synthesize', `Audio: ${audioData.byteLength} bytes`);
                    this._onAudioChunk?.(audioData);
                    resolve({ audioData });
                },
            );
        });
    }

    private _base64ToArrayBuffer(base64: string): ArrayBuffer {
        const normalized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
        const len = normalized.length;
        const byteValues: number[] = [];

        for (let i = 0; i < len; i += 4) {
            const a = BASE64_CHARS.indexOf(normalized[i]);
            const b = BASE64_CHARS.indexOf(normalized[i + 1]);
            const c = BASE64_CHARS.indexOf(normalized[i + 2]);
            const d = BASE64_CHARS.indexOf(normalized[i + 3]);

            byteValues.push((a << 2) | (b >> 4));
            if (normalized[i + 2] !== '=') {
                byteValues.push(((b & 15) << 4) | (c >> 2));
            }
            if (normalized[i + 3] !== '=') {
                byteValues.push(((c & 3) << 6) | d);
            }
        }

        const bytes = new Uint8Array(byteValues.length);
        for (let i = 0; i < byteValues.length; i++) {
            bytes[i] = byteValues[i];
        }
        return bytes.buffer;
    }
}

export { PiperTTSProvider };
