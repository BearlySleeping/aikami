import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
  type FirebaseStorageServiceInterface,
  firebaseStorageService,
} from '@aikami/frontend/services';

export type StorageServiceOptions = BaseFrontendClassOptions & {
  storage: FirebaseStorageServiceInterface;
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
  private get _storage(): FirebaseStorageServiceInterface {
    return this._options.storage;
  }

  async uploadAvatar(options: { file: Blob | File; uid: string }): Promise<string | undefined> {
    try {
      const { file, uid } = options;
      const extension = file.type.split('/')[1] || 'jpg';
      const fileName = `avatar.${extension}`;
      const path = `users/${uid}/${fileName}`;

      this.log('uploadAvatar', { path });

      const result = await this._storage.upload(path, file);
      return result.ref.fullPath;
    } catch (error) {
      this.error(error);
      return;
    }
  }
}

export const storageService: StorageServiceInterface = new StorageService({
  storage: firebaseStorageService,
  className: 'StorageService',
});
