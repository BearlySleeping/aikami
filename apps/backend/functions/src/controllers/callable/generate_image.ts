import type { CallableFunctions } from '@aikami/types';
import { onCall } from '@snorreks/firestack';
import logger from '$logger';

export default onCall<CallableFunctions, 'generateImage'>(
  async (request) => {
    const { prompt, npcId, characterId } = request.data;
    logger.log('generateImage called', { prompt, npcId, characterId });

    return {
      imageUrl: 'https://placeholder.example.com/image.png',
    };
  },
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
);
