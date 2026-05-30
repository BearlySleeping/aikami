// apps/frontend/gamejs/src/core/api/providers/image/dalle_provider.ts
/**
 * DALL-E image provider stub.
 * Will support OpenAI DALL-E image generation when implemented.
 */
import { logger } from '../../../../utils/logger';
import type { ImageRequest, ImageResponse } from '../../types';

export type DalleProviderOptions = {
    apiKey: string;
};

export default class DalleProvider {
    constructor(_options: DalleProviderOptions) {
        logger.debug('DalleProvider.constructor', 'Initialized');
    }

    async generateImage(request: ImageRequest): Promise<ImageResponse> {
        logger.debug('DalleProvider.generateImage', { prompt: request.prompt });
        logger.warn('DalleProvider.generateImage', 'DALL-E provider not yet implemented');
        return { error: 'DALL-E provider not yet implemented' };
    }

    dispose(): void {
        logger.debug('DalleProvider.dispose', 'Cleaning up');
    }
}

export { DalleProvider };
