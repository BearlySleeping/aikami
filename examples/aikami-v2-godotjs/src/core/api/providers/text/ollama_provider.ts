// apps/frontend/gamejs/src/core/api/providers/text/ollama_provider.ts
/**
 * Ollama text provider stub.
 * Will support local Ollama LLM inference when implemented.
 */
import { logger } from '../../../../utils/logger';
import type {
    TextBasicRequest,
    TextBasicResponse,
    TextFunctionRequest,
    TextFunctionResponse,
    TextChunkCallback,
} from '../../types';

export type OllamaProviderOptions = {
    baseUrl: string;
    onTextChunk?: TextChunkCallback;
};

export default class OllamaProvider {
    constructor(_options: OllamaProviderOptions) {
        logger.debug('OllamaProvider.constructor', 'Initialized');
    }

    async callBasic(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('OllamaProvider.callBasic', { useStream: request.useStream });
        logger.warn('OllamaProvider.callBasic', 'Ollama provider not yet implemented');
        return { text: '', error: 'Ollama provider not yet implemented' };
    }

    async callFunction(request: TextFunctionRequest): Promise<TextFunctionResponse> {
        logger.debug('OllamaProvider.callFunction', { name: request.name, useStream: request.useStream });
        logger.warn('OllamaProvider.callFunction', 'Ollama provider not yet implemented');
        return { data: {}, error: 'Ollama provider not yet implemented' };
    }

    dispose(): void {
        logger.debug('OllamaProvider.dispose', 'Cleaning up');
    }
}

export { OllamaProvider };
