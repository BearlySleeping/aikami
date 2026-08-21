// apps/frontend/gamejs/src/core/api/providers/text/gemini_provider.ts
/**
 * Gemini text provider stub.
 * Will support Google Gemini chat completions when implemented.
 */
import { logger } from '../../../../utils/logger';
import type {
    TextBasicRequest,
    TextBasicResponse,
    TextFunctionRequest,
    TextFunctionResponse,
    TextChunkCallback,
} from '../../types';

export type GeminiProviderOptions = {
    apiKey: string;
    onTextChunk?: TextChunkCallback;
};

export default class GeminiProvider {
    constructor(_options: GeminiProviderOptions) {
        logger.debug('GeminiProvider.constructor', 'Initialized');
    }

    async callBasic(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('GeminiProvider.callBasic', { useStream: request.useStream });
        logger.warn('GeminiProvider.callBasic', 'Gemini provider not yet implemented');
        return { text: '', error: 'Gemini provider not yet implemented' };
    }

    async callFunction(request: TextFunctionRequest): Promise<TextFunctionResponse> {
        logger.debug('GeminiProvider.callFunction', { name: request.name, useStream: request.useStream });
        logger.warn('GeminiProvider.callFunction', 'Gemini provider not yet implemented');
        return { data: {}, error: 'Gemini provider not yet implemented' };
    }

    dispose(): void {
        logger.debug('GeminiProvider.dispose', 'Cleaning up');
    }
}

export { GeminiProvider };
