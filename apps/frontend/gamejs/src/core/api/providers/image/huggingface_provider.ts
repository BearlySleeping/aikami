// apps/frontend/gamejs/src/core/api/providers/image/huggingface_provider.ts
/**
 * HuggingFace provider stub.
 * Will support HuggingFace inference for STT and image generation when implemented.
 */
import { logger } from '../../../../utils/logger';
import type {
    ImageRequest,
    ImageResponse,
    SttRequest,
    SttResponse,
} from '../../types';

export type HuggingFaceProviderOptions = {
    apiKey: string;
};

export default class HuggingFaceProvider {
    constructor(_options: HuggingFaceProviderOptions) {
        logger.debug('HuggingFaceProvider.constructor', 'Initialized');
    }

    async generateImage(request: ImageRequest): Promise<ImageResponse> {
        logger.debug('HuggingFaceProvider.generateImage', { prompt: request.prompt });
        logger.warn('HuggingFaceProvider.generateImage', 'HuggingFace image provider not yet implemented');
        return { error: 'HuggingFace image provider not yet implemented' };
    }

    async speechToText(request: SttRequest): Promise<SttResponse> {
        logger.debug('HuggingFaceProvider.speechToText', { mimeType: request.mimeType });
        logger.warn('HuggingFaceProvider.speechToText', 'HuggingFace STT provider not yet implemented');
        return { text: '', error: 'HuggingFace STT provider not yet implemented' };
    }

    dispose(): void {
        logger.debug('HuggingFaceProvider.dispose', 'Cleaning up');
    }
}

export { HuggingFaceProvider };
