import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  createR2Storage,
  type R2StorageInterface,
} from '@aikami/frontend/services';

export type StorageServiceOptions = BaseFrontendClassOptions & {
  storage: R2StorageInterface;
};

export type StorageServiceInterface = BaseFrontendClassInterface & {
  /**
   * Uploads an avatar for a user.
   * @param options The upload options.
   * @returns A promise that resolves with the full path of the uploaded file, or undefined if the upload fails.
   */
  uploadAvatar(options: { file: Blob | File; uid: string }): Promise<string | undefined>;
};

class StorageService
  extends BaseFrontendClass<StorageServiceOptions>
  implements StorageServiceInterface
{
  private get _storage(): R2StorageInterface {
    return this._options.storage;
  }

  async uploadAvatar(options: { file: Blob | File; uid: string }): Promise<string | undefined> {
    try {
      const { file, uid } = options;
      const extension = file.type.split('/')[1] || 'jpg';
      const fileName = `avatar.${extension}`;
      const path = `users/${uid}/${fileName}`;

      this.log('uploadAvatar', { path });

      // 1. Upload the file to R2 (via the hub's session-gated endpoint).
      const result = await this._storage.upload(path, file);

      // 2. Fetch the download URL.
      const downloadUrl = await this._storage.getDownloadURL(result.ref);

      // Log only the storage path — the download URL must never reach logs.
      this.log('uploadAvatar uploaded', { path });
      return downloadUrl;
    } catch (error) {
      this.error(error);
      return;
    }
  }
}

export const storageService: StorageServiceInterface = StorageService.create({
  storage: createR2Storage('/api'),
  className: 'StorageService',
});
