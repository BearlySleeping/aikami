// apps/frontend/gamejs/src/core/api/providers/text/openrouter_provider.ts
/**
 * OpenRouter text provider using pure callbacks.
 *
 * Uses only Godot signals and callbacks, no Promises,
 * to avoid GodotJS type conversion issues.
 */
import { Node } from 'godot';
import { HttpRequestClient } from '../../http/http_request_client';
import type { HttpResponse } from '../../http/http_request_client';
import { StreamClient } from '../../http/stream_client';
import { logger } from '../../../../utils/logger';
import { parseOpenAiStreamData, buildOpenAiMessages } from './openai_parsing';
import type { TextBasicRequest, TextBasicResponse, TextFunctionResponse, TextChunkCallback } from '../../types';

const DOMAIN = 'https://openrouter.ai';
const PATH = '/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-3.5-turbo';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.5;

export type OpenRouterProviderOptions = {
    apiKey: string;
    parentNode?: Node;
    model?: string;
    onTextChunk?: TextChunkCallback;
};

export default class OpenRouterProvider {
    private _apiKey: string;
    private _model: string;
    private _httpClient: HttpRequestClient;
    private _streamClient: StreamClient;
    private _onTextChunk?: TextChunkCallback;

    constructor(options: OpenRouterProviderOptions) {
        logger.debug('OpenRouterProvider.constructor', { model: options.model ?? DEFAULT_MODEL });
        this._apiKey = options.apiKey;
        this._model = options.model ?? DEFAULT_MODEL;
        this._onTextChunk = options.onTextChunk;
        
        this._httpClient = new HttpRequestClient();
        this._streamClient = new StreamClient();
        if (options.parentNode) {
            this._httpClient.initWithParent(options.parentNode);
            this._streamClient.initWithParent(options.parentNode);
        }
    }

    async callBasic(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('OpenRouterProvider.callBasic', { useStream: request.useStream });
        
        const messages = buildOpenAiMessages(request.messages);
        const options = this._buildOptions(messages, request.useStream);

        if (request.useStream) {
            return this._callBasicStream(options);
        }
        return this._callBasicAsync(options);
    }

    async callFunction(_request: unknown): Promise<TextFunctionResponse> {
        return { data: {}, error: 'callFunction not implemented for OpenRouterProvider' };
    }

    dispose(): void {
        logger.debug('OpenRouterProvider.dispose', 'Cleaning up');
        this._httpClient.dispose();
        this._streamClient.dispose();
    }

    private _getAuthHeaders(contentType: boolean = true): string[] {
        const headers = [
            `Authorization: Bearer ${this._apiKey}`,
            'HTTP-Referer: https://aikami.app',
            'X-Title: Aikami',
        ];
        if (contentType) {
            headers.push('Content-Type: application/json');
        }
        return headers;
    }

    private _buildOptions(messages: Array<{ role: string; content: string }>, useStream = false): Record<string, unknown> {
        return {
            model: this._model,
            messages,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: useStream,
        };
    }

    private _callBasicAsync(options: Record<string, unknown>): Promise<TextBasicResponse> {
        const httpClient = this._httpClient;
        const headers = this._getAuthHeaders();
        const url = `${DOMAIN}${PATH}`;

        return new Promise<TextBasicResponse>((resolve) => {
            httpClient.request({
                url,
                headers,
                body: JSON.stringify(options),
            }, (response: HttpResponse) => {
                if (response.error) {
                    logger.error('OpenRouterProvider._callBasicAsync', response.error);
                    resolve({ text: '', error: response.error });
                    return;
                }

                const data = response.data as Record<string, unknown>;
                if (data.error) {
                    const errorMsg = (data.error as Record<string, unknown>).message as string | undefined;
                    logger.error('OpenRouterProvider._callBasicAsync', errorMsg ?? JSON.stringify(data.error));
                    resolve({ text: '', error: errorMsg ?? JSON.stringify(data.error) });
                    return;
                }
                const choices = data.choices as Array<Record<string, unknown>> | undefined;
                if (!choices || choices.length === 0) {
                    logger.error('OpenRouterProvider._callBasicAsync', 'No choices in response');
                    resolve({ text: '', error: 'No choices in response' });
                    return;
                }
                const message = choices[0].message as Record<string, unknown> | undefined;
                const content = message?.content as string | undefined;
                if (!content) {
                    logger.error('OpenRouterProvider._callBasicAsync', 'No content in response');
                    resolve({ text: '', error: 'No content in response' });
                    return;
                }
                logger.info('OpenRouterProvider._callBasicAsync', content);
                resolve({ text: content });
            });
        });
    }

    private _callBasicStream(options: Record<string, unknown>): Promise<TextBasicResponse> {
        const streamClient = this._streamClient;
        const headers = this._getAuthHeaders();
        const onTextChunk = this._onTextChunk;

        return new Promise<TextBasicResponse>((resolve) => {
            let streamText = '';

            const onChunk = (data: string): void => {
                const result = parseOpenAiStreamData(data);
                if (result.error) {
                    logger.error('OpenRouterProvider._callBasicStream', result.error);
                    return;
                }
                if (result.done) {
                    resolve({ text: streamText });
                    return;
                }
                if (result.text) {
                    streamText += result.text;
                    onTextChunk?.(result.text);
                }
            };

            const onComplete = (): void => {
                resolve({ text: streamText });
            };

            const onError = (error: string): void => {
                resolve({ text: streamText, error });
            };

            streamClient.connectToHost({
                domain: DOMAIN,
                path: PATH,
                headers,
                body: JSON.stringify(options),
                port: 443,
                onChunk,
                onComplete,
                onError,
            });
        });
    }
}

export { OpenRouterProvider };