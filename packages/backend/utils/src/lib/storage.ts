// packages/backend/utils/src/lib/storage.ts

import { getBucket, isEmulatorMode } from '@aikami/backend-configs';
import { v4 } from 'uuid';
import { logger } from '$logger';

/**
 * Uploads the XLSX file to Firebase Storage.
 * @param options - The options for uploading the file.
 * @param options.filePath - The local file path of the XLSX file.
 * @param options.destination - The desired name for the uploaded file in Firebase Storage.
 * @param options.contentType - The content type of the uploaded file.
 * @returns - The URL of the uploaded file.
 */
export const uploadToFirebase = async (options: {
  filePath: string;
  destination: string;
  contentType?: string;
}): Promise<string> => {
  logger.debug('uploadToFirebase', options);
  const { filePath, destination, contentType } = options;
  const bucket = getBucket();
  const firebaseStorageDownloadTokens = v4();
  const metadata = {
    contentType,
    metadata: {
      firebaseStorageDownloadTokens,
    },
  };

  logger.log('uploadToFirebase: Uploading file to Firebase', { destination, metadata });

  const [uploadedFile] = await bucket.upload(filePath, {
    destination,
    metadata,
  });

  const uploadedFileName = uploadedFile.name;

  logger.log('uploadToFirebase: File uploaded successfully', { uploadedFileName });

  // Use emulator URL if running in emulator mode
  if (isEmulatorMode()) {
    return `http://localhost:9199/v0/b/${bucket.name}/o/${encodeURIComponent(uploadedFileName)}?alt=media&token=${firebaseStorageDownloadTokens}`;
  }

  return (
    'https://firebasestorage.googleapis.com/v0/b/' +
    bucket.name +
    '/o/' +
    encodeURIComponent(uploadedFileName) +
    '?alt=media&token=' +
    firebaseStorageDownloadTokens
  );
};
