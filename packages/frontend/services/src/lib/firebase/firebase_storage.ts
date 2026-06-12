import { BaseClass, type BaseClassInterface } from '@aikami/utils'; // Using your BaseClass
import type { StorageReference, UploadMetadata, UploadResult } from 'firebase/storage';

export type FirebaseStorageServiceInterface = BaseClassInterface & {
  /**
   * Gets a reference to a file path in Firebase Storage.
   *
   * @param path The full path to the file in your bucket.
   * @returns A promise that resolves with the StorageReference.
   */
  getRef(path: string): Promise<StorageReference>;

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
  ): Promise<UploadResult>;

  /**
   * Uploads a string as a UTF-8 JSON blob to Firebase Storage.
   *
   * @param path The full path in your bucket.
   * @param data The string content to upload.
   * @returns A promise that resolves with the upload result.
   */
  uploadString(path: string, data: string): Promise<UploadResult>;

  /**
   * Downloads a file from Firebase Storage and returns its contents as a
   * string (UTF-8).
   *
   * @param path The full path to the file in your bucket.
   * @returns A promise that resolves with the file contents as a string.
   */
  downloadString(path: string): Promise<string>;

  /**
   * Gets the download URL for a file in Firebase Storage.
   *
   * @param path The full path to the file in your bucket.
   * @returns A promise that resolves with the download URL string.
   */
  getDownloadURL(ref: string | StorageReference): Promise<string>;

  /**
   * Deletes a file from Firebase Storage.
   *
   * @param path The full path to the file in your bucket.
   * @returns A promise that resolves when the deletion completes.
   */
  deleteObject(path: string): Promise<void>;
};

// This type represents the module we are dynamically importing ('./storage')
type StorageModule = typeof import('@aikami/frontend/configs/storage.ts');

class FirebaseStorageService extends BaseClass implements FirebaseStorageServiceInterface {
  // Private static property to cache the dynamically imported module
  private static _storageModule?: StorageModule;

  public async getRef(path: string): Promise<StorageReference> {
    const { ref, storage } = await this._getStorageModule();
    return ref(storage, path);
  }

  public async getDownloadURL(ref: string | StorageReference): Promise<string> {
    // Dynamically get the getDownloadURL function
    const { getDownloadURL } = await this._getStorageModule();
    if (typeof ref === 'string') {
      const storageRef = await this.getRef(ref);
      return getDownloadURL(storageRef);
    }
    return getDownloadURL(ref);
  }

  public async upload(
    path: string,
    data: ArrayBuffer | Blob | File | Uint8Array,
    metadata?: UploadMetadata,
  ): Promise<UploadResult> {
    // Dynamically get the uploadBytes function and a storage reference
    const { uploadBytes } = await this._getStorageModule();
    const storageRef = await this.getRef(path);

    this.log(`Uploading to: ${storageRef.fullPath}`);
    return uploadBytes(storageRef, data, metadata);
  }

  public async uploadString(path: string, data: string): Promise<UploadResult> {
    const blob = new Blob([data], { type: 'application/json' });
    return this.upload(path, blob);
  }

  public async downloadString(path: string): Promise<string> {
    const url = await this.getDownloadURL(path);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${this._className}: failed to download "${path}" — HTTP ${response.status}`);
    }
    return response.text();
  }

  public async deleteObject(path: string): Promise<void> {
    const { deleteObject } = await this._getStorageModule();
    const storageRef = await this.getRef(path);
    return deleteObject(storageRef);
  }

  /**
   * Dynamically imports the storage module, preventing SSR execution. The
   * module is cached in a static property for subsequent calls.
   */
  private async _getStorageModule(): Promise<StorageModule> {
    if (FirebaseStorageService._storageModule) {
      return FirebaseStorageService._storageModule;
    }

    if (import.meta.env.SSR || typeof window === 'undefined' || import.meta.env.STORYBOOK) {
      throw new Error(`${this._className} is not available on the server.`);
    }

    // Dynamically import and cache the module
    FirebaseStorageService._storageModule = await import('@aikami/frontend/configs/storage.ts');
    return FirebaseStorageService._storageModule;
  }
}

// Export a singleton instance of the service
export const firebaseStorageService: FirebaseStorageServiceInterface =
  FirebaseStorageService.create({
    className: 'FirebaseStorageService',
  });
