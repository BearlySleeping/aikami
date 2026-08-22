import type { CommonError } from '@aikami/types';
import { logger } from '$logger';

export const downloadVideoFile = ({
  fileName,
  onDownloadProgress,
  url,
}: {
  fileName: string;
  url: string;
  onDownloadProgress?: (progress: {
    /** The amount of byte transferred. */
    bytesTransferred: number;
    /** The total amount of bytes to be transferred. */
    totalBytes: number;
  }) => void;
}): {
  future: () => Promise<void>;
  cancel: () => Promise<boolean> | boolean;
} => {
  const abortController = new AbortController();
  const future = async () => {
    try {
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) {
        throw new Error(`Download failed (HTTP ${response.status})`);
      }
      const totalBytes = Number(response.headers.get('content-length') ?? -1);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Download failed: no response body');
      }

      const chunks: BlobPart[] = [];
      let bytesTransferred = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        bytesTransferred += value.byteLength;
        if (onDownloadProgress) {
          onDownloadProgress({ bytesTransferred, totalBytes });
        }
      }

      const fileURL = URL.createObjectURL(new Blob(chunks));
      await downloadFile(fileURL, fileName);
    } catch (error_) {
      const error = error_ as CommonError;
      logger.error('downloadVideoFile', error);
      // AbortController cancellation surfaces as an AbortError — treat it as a
      // clean cancel, not a failure.
      if (
        typeof DOMException !== 'undefined' &&
        error_ instanceof DOMException &&
        error_.name === 'AbortError'
      ) {
        return;
      }
    }
  };
  return {
    cancel: () => {
      try {
        abortController.abort();
        return true;
      } catch (error) {
        logger.error('downloadVideoFile', error);
        return false;
      }
    },
    future,
  };
};

/**
 * Downloads a file from the specified URL with the specified filename.
 *
 * @param downloadURL - The URL of the file to download.
 * @param fileName - The desired filename for the downloaded file.
 * @returns A promise that resolves when the download completes successfully, or
 *   rejects with an error if the download fails.
 */
export const downloadFile = async (downloadURL: string, fileName: string): Promise<void> => {
  const fileLink = document.createElement('a');
  fileLink.href = downloadURL;
  fileLink.setAttribute('download', fileName);
  document.body.append(fileLink);
  try {
    await new Promise<void>((resolve) => {
      // fileLink.addEventListener('readystatechange', () => {
      // 	if (fileLink.readyState === 4) {
      // 		if (fileLink.status === 200) {
      // 			resolve();
      // 		} else {
      // 			reject(new Error('Failed to download file'));
      // 		}
      // 	}
      // });
      fileLink.click();
      resolve();
    });
  } finally {
    fileLink.remove();
  }
};
