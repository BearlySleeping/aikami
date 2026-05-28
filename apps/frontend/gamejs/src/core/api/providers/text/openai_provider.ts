// apps/frontend/gamejs/src/core/api/providers/text/openai_provider.ts
/**
 * OpenAI text provider supporting chat completions with optional SSE streaming.
 */
import { Node } from 'godot';
import { HttpRequestClient } from '../../http/http_request_client';
import { StreamClient } from '../../http/stream_client';
import { logger } from '../../../../utils/logger';
import type {
    TextBasicRequest,
    TextBasicResponse,
    TextFunctionRequest,
    TextFunctionResponse,
    TextChunkCallback,
} from '../../types';
import {
    parseOpenAiStreamData,
    buildOpenAiMessages,
    buildOpenAiFunctionTool,
    cleanTextResponse,
    tryParseFunctionArgs,
    extractTextResponseFromArgs,
} from './openai_parsing';

const DOMAIN = 'https://api.openai.com';
const PATH = '/v1/chat/completions';
const URL = DOMAIN + PATH;
const MODEL = 'gpt-3.5-turbo';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.5;

export type OpenAiProviderOptions = {
    apiKey: string;
    parentNode: Node;
    onTextChunk?: TextChunkCallback;
};

export default class OpenAiProvider {
    private _apiKey: string;
    private _httpClient: HttpRequestClient;
    private _streamClient: StreamClient;
    private _onTextChunk?: TextChunkCallback;

    constructor(options: OpenAiProviderOptions) {
        this._apiKey = options.apiKey;
        this._onTextChunk = options.onTextChunk;
        this._httpClient = new HttpRequestClient();
        this._streamClient = new StreamClient();
        this._httpClient.initWithParent(options.parentNode);
        this._streamClient.initWithParent(options.parentNode);
        logger.debug('OpenAiProvider.constructor', 'Initialized');
    }

    async callBasic(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('OpenAiProvider.callBasic', { useStream: request.useStream });

        const messages = buildOpenAiMessages(request.messages);
        const options = this._buildOptions(messages, request.useStream);

        if (request.useStream) {
            return this._callBasicStream(options);
        }
        return this._callBasicAsync(options);
    }

    async callFunction(request: TextFunctionRequest): Promise<TextFunctionResponse> {
        logger.debug('OpenAiProvider.callFunction', { name: request.name, useStream: request.useStream });

        const messages = buildOpenAiMessages(request.messages);
        const options = this._buildOptions(messages, request.useStream);
        const tool = buildOpenAiFunctionTool(request);
        (options as Record<string, unknown>).tools = [tool];
        (options as Record<string, unknown>).tool_choice = {
            type: 'function',
            function: { name: request.name },
        };

        if (request.useStream) {
            return this._callFunctionStream(options);
        }
        return this._callFunctionAsync(options);
    }

    dispose(): void {
        logger.debug('OpenAiProvider.dispose', 'Cleaning up');
        this._httpClient.dispose();
        this._streamClient.dispose();
    }

    private _getAuthHeaders(contentType: boolean = true): string[] {
        const headers: string[] = [`Authorization: Bearer ${this._apiKey}`];
        if (contentType) {
            headers.push('Content-Type: application/json');
        }
        return headers;
    }

    private _buildOptions(messages: Array<{ role: string; content: string }>, useStream = false): Record<string, unknown> {
        return {
            model: MODEL,
            messages,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            stream: useStream,
        };
    }

    private _callBasicAsync(options: Record<string, unknown>): Promise<TextBasicResponse> {
        const httpClient = this._httpClient;
        const headers = this._getAuthHeaders();

        return new Promise<TextBasicResponse>((resolve) => {
            httpClient.request({
                url: URL,
                headers,
                body: JSON.stringify(options),
            }, (response) => {
                if (response.error) {
                    logger.error('OpenAiProvider._callBasicAsync', response.error);
                    resolve({ text: '', error: response.error });
                    return;
                }

                const data = response.data as Record<string, unknown>;
                if (data.error) {
                    const errorMsg = (data.error as Record<string, unknown>).message as string | undefined;
                    logger.error('OpenAiProvider._callBasicAsync', errorMsg ?? JSON.stringify(data.error));
                    resolve({ text: '', error: errorMsg ?? JSON.stringify(data.error) });
                    return;
                }
                const choices = data.choices as Array<Record<string, unknown>> | undefined;
                if (!choices || choices.length === 0) {
                    logger.error('OpenAiProvider._callBasicAsync', 'No choices in response');
                    resolve({ text: '', error: 'No choices in response' });
                    return;
                }
                const message = choices[0].message as Record<string, unknown> | undefined;
                const content = message?.content as string | undefined;
                if (!content) {
                    logger.error('OpenAiProvider._callBasicAsync', 'No content in response');
                    resolve({ text: '', error: 'No content in response' });
                    return;
                }
                logger.info('OpenAiProvider._callBasicAsync', content);
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
                    logger.error('OpenAiProvider._callBasicStream', result.error);
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

    private _callFunctionAsync(options: Record<string, unknown>): Promise<TextFunctionResponse> {
        const httpClient = this._httpClient;
        const headers = this._getAuthHeaders();

        return new Promise<TextFunctionResponse>((resolve) => {
            httpClient.request({
                url: URL,
                headers,
                body: JSON.stringify(options),
            }, (response) => {
                if (response.error) {
                    logger.error('OpenAiProvider._callFunctionAsync', response.error);
                    resolve({ data: {}, error: response.error });
                    return;
                }

                const data = response.data as Record<string, unknown>;
                const choices = data.choices as Array<Record<string, unknown>>;
                const message = choices[0].message as Record<string, unknown>;
                const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
                const firstFunction = toolCalls[0].function as Record<string, unknown>;
                const args = JSON.parse(firstFunction.arguments as string) as Record<string, unknown>;
                logger.info('OpenAiProvider._callFunctionAsync', args);
                resolve({ data: args });
            });
        });
    }

    private _callFunctionStream(options: Record<string, unknown>): Promise<TextFunctionResponse> {
        const streamClient = this._streamClient;
        const headers = this._getAuthHeaders();
        const onTextChunk = this._onTextChunk;

        return new Promise<TextFunctionResponse>((resolve) => {
            let streamText = '';
            let functionCall: { name: string; arguments: string } = { name: '', arguments: '' };
            let completedStreamText = false;

            const onChunk = (data: string): void => {
                const result = parseOpenAiStreamData(data);
                if (result.error) {
                    logger.error('OpenAiProvider._callFunctionStream', result.error);
                    return;
                }
                if (result.done) {
                    const args = tryParseFunctionArgs(functionCall.arguments);
                    resolve({ data: args });
                    return;
                }
                if (result.functionCall) {
                    if (result.functionCall.name) {
                        functionCall.name = result.functionCall.name;
                    }
                    if (result.functionCall.arguments) {
                        functionCall.arguments += result.functionCall.arguments;
                        if (completedStreamText) {
                            return;
                        }
                        const text = extractTextResponseFromArgs(functionCall.arguments);
                        if (text) {
                            const cleaned = cleanTextResponse(text);
                            const delta = cleaned.replace(streamText, '');
                            if (delta) {
                                streamText += delta;
                                onTextChunk?.(delta);
                                if (!text.endsWith('"')) {
                                    completedStreamText = true;
                                }
                            }
                        }
                    }
                }
                if (result.text) {
                    streamText += result.text;
                    onTextChunk?.(result.text);
                }
            };

            const onComplete = (): void => {
                const args = tryParseFunctionArgs(functionCall.arguments);
                resolve({ data: args });
            };

            const onError = (error: string): void => {
                resolve({ data: {}, error });
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

export { OpenAiProvider };