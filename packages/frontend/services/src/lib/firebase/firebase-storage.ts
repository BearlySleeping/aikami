import type { StorageReference, UploadMetadata, UploadResult } from 'firebase/storage'

import { BaseClass, type BaseClassInterface } from '@aikami/utils' // Using your BaseClass

export type FirebaseStorageServiceInterface = BaseClassInterface & {
  /**
   * Gets a reference to a file path in Firebase Storage.
   *
   * @param path The full path to the file in your bucket.
   * @returns A promise that resolves with the StorageReference.
   */
  getRef(path: string): Promise<StorageReference>

  /**
   * Uploads a file, Blob, or byte array to a specified path in Firebase
   * Storage.
   *
   * @param path The full path in your bucket (e.g.,
   *   'user_uploads/avatar.png').
   * @param data The file, Blob, or byte array to upload.
   * @param metadata Optional metadata for the object.
   * @returns A promise that resolves with the upload result.
   */
  upload(
    path: string,
    data: ArrayBuffer | Blob | File | Uint8Array,
    metadata?: UploadMetadata,
  ): Promise<UploadResult>
}

// This type represents the module we are dynamically importing ('./storage')
type StorageModule = typeof import('./configs/storage.ts')

class FirebaseStorageService extends BaseClass implements FirebaseStorageServiceInterface {
  // Private static property to cache the dynamically imported module
  private static _storageModule?: StorageModule

  constructor() {
    super({
      className: 'FirebaseStorageService',
    })
  }

  public async getRef(path: string): Promise<StorageReference> {
    const { ref, storage } = await this._getStorageModule()
    return ref(storage, path)
  }

  public async upload(
    path: string,
    data: ArrayBuffer | Blob | File | Uint8Array,
    metadata?: UploadMetadata,
  ): Promise<UploadResult> {
    // Dynamically get the uploadBytes function and a storage reference
    const { uploadBytes } = await this._getStorageModule()
    const storageRef = await this.getRef(path)

    this.log(`Uploading to: ${storageRef.fullPath}`)
    return uploadBytes(storageRef, data, metadata)
  }

  /**
   * Dynamically imports the storage module, preventing SSR execution. The
   * module is cached in a static property for subsequent calls.
   */
  private async _getStorageModule(): Promise<StorageModule> {
    if (FirebaseStorageService._storageModule) {
      return FirebaseStorageService._storageModule
    }

    if (
      import.meta.env.SSR ||
      typeof window === 'undefined' ||
      import.meta.env['STORYBOOK']
    ) {
      throw new Error(
        `${this._className} is not available on the server.`,
      )
    }

    // Dynamically import and cache the module
    FirebaseStorageService._storageModule = await import('./configs/storage.ts')
    return FirebaseStorageService._storageModule
  }
}

// Export a singleton instance of the service
export const firebaseStorageService = new FirebaseStorageService()
