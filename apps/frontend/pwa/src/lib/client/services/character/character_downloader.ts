// apps/frontend/pwa/src/lib/client/services/character/character-downloader.ts
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';

const _USER_AGENT = 'AiKami';

const getHostFromUrl = (options: { url: string }): string | undefined => {
  try {
    return new URL(options.url).hostname;
  } catch {
    return undefined;
  }
};

const downloadRisu = async (options: { url: string }): Promise<File> => {
  const match = options.url.match(/\/character\/([a-f0-9-]+)\/?$/i);
  const uuid = match ? match[1] : undefined;

  if (!uuid) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Invalid Risu URL format.',
    });
  }

  const response = await fetch(
    `https://realm.risuai.net/api/v1/download/png-v3/${uuid}?non_commercial=true`,
  );

  if (!response.ok) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Risu API returned an error.',
    });
  }

  const blob = await response.blob();
  return new File([blob], `${uuid}.png`, { type: 'image/png' });
};

const downloadChub = async (options: { url: string }): Promise<File> => {
  const urlParts = options.url.split('/');
  const idIndex = urlParts.indexOf('characters');

  if (idIndex === -1 || !urlParts[idIndex + 1] || !urlParts[idIndex + 2]) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Invalid Chub URL format.',
    });
  }

  const creatorName = urlParts[idIndex + 1];
  const projectName = urlParts[idIndex + 2];

  const response = await fetch(
    `https://api.chub.ai/api/characters/${creatorName}/${projectName}?full=true`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Chub API returned an error.',
    });
  }

  const metadata = await response.json();
  const imageUrl = metadata.node?.max_res_url;

  if (!imageUrl) {
    const jsonBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
    return new File([jsonBlob], `${projectName}.json`, { type: 'application/json' });
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Failed to fetch Chub avatar image.',
    });
  }

  const blob = await imageResponse.blob();
  return new File([blob], `${projectName}.png`, { type: 'image/png' });
};

const downloadGeneric = async (options: { url: string }): Promise<File> => {
  const response = await fetch(options.url);
  if (!response.ok) {
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Failed to fetch generic URL.',
    });
  }

  const blob = await response.blob();
  let fileName = options.url.split('?')[0].split('/').pop() || 'downloaded_character';

  if (blob.type === 'image/png' && !fileName.endsWith('.png')) {
    fileName += '.png';
  }

  return new File([blob], fileName, { type: blob.type });
};

/**
 * Downloads a character card from a supported external URL.
 * @param options - The options object containing the URL
 * @returns A File object containing the downloaded PNG or JSON
 */
export const downloadFromUrl = async (options: { url: string }): Promise<File> => {
  const { url } = options;
  const host = getHostFromUrl({ url });

  if (!host) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Invalid URL provided.',
    });
  }

  try {
    if (host.includes('realm.risuai.net')) {
      return await downloadRisu({ url });
    }

    if (host.includes('chub.ai') || host.includes('characterhub.org')) {
      return await downloadChub({ url });
    }

    return await downloadGeneric({ url });
  } catch (error) {
    logger.error('character-downloader', { url, error });
    throw toAppError({
      errorType: 'internal',
      errorMessage: 'Failed to download character card from the provided URL.',
    });
  }
};
