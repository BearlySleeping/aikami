import type { CommonError } from '@aikami/types';
import axios from 'axios';
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
  // eslint-disable-next-line import/no-named-as-default-member
  const cancelSource = axios.CancelToken.source();
  const future = async () => {
    try {
      const response = await axios.get<BlobPart>(url, {
        cancelToken: cancelSource.token,
        onDownloadProgress: (event: { loaded: number; total?: number }) => {
          if (onDownloadProgress) {
            onDownloadProgress({
              bytesTransferred: event.loaded,
              totalBytes: event.total ?? -1,
            });
          }
        },
        responseType: 'blob',
      });

      const fileURL = URL.createObjectURL(new Blob([response.data]));
      await downloadFile(fileURL, fileName);
    } catch (error_) {
      const error = error_ as CommonError;
      logger.error('downloadVideoFile', error);
      if (error.code === 'canceled') {
        return;
        // something else we
      }
    }
  };
  return {
    cancel: () => {
      try {
        cancelSource.cancel('canceled');
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
