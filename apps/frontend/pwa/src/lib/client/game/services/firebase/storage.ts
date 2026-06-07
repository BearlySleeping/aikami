// apps/frontend/pwa/src/lib/client/game/services/firebase/storage.ts
/**
 * Firebase Storage REST API client — no Firebase SDK.
 * Supports upload, download, and delete via fetch.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/client/game/core/base_game_class.ts';
import { getConfig } from './config.ts';
import type { FirebaseHttpClientInterface } from './http_client.ts';

export type FirebaseStorageOptions = BaseGameClassOptions & {
  http: FirebaseHttpClientInterface;
};

export type FirebaseStorageInterface = BaseGameClassInterface & {
  uploadFile(path: string, content: string | Blob, contentType: string): Promise<string | null>;
  downloadFile(path: string): Promise<string | null>;
  deleteFile(path: string): Promise<boolean>;
};

/**
 * Service for Firebase Storage operations via REST API.
 */
class FirebaseStorage
  extends BaseGameClass<FirebaseStorageOptions>
  implements FirebaseStorageInterface
{
  private readonly _http: FirebaseHttpClientInterface;

  constructor(options: FirebaseStorageOptions) {
    super(options);
    this._http = options.http;
  }

  /**
   * Uploads a file to Firebase Storage.
   * @param path - Storage path (e.g. "screenshots/score.png")
   * @param content - File content as base64 string or binary blob
   * @param contentType - MIME type (e.g. "image/png")
   * @returns Download URL or null on failure
   */
  async uploadFile(
    path: string,
    content: string | Blob,
    contentType: string,
  ): Promise<string | null> {
    const config = getConfig();
    const encodedPath = encodeURIComponent(path);
    const url = `${config.storageEndpoint}?name=${encodedPath}&uploadType=media`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': contentType,
      };

      if (config.isEmulator) {
        headers.Authorization = 'Bearer owner';
      }

      const body = typeof content === 'string' ? content : content;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        return null;
      }

      // Construct download URL
      const data = (await response.json().catch(() => ({}))) as {
        name?: string;
      };
      const downloadPath = encodedPath;
      return `${config.storageEndpoint.replace('/o', `/${downloadPath}`)}?alt=media&token=${data.name || ''}`;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Downloads a file from Firebase Storage.
   * @param path - Storage path
   * @returns File content as text or null on failure
   */
  async downloadFile(path: string): Promise<string | null> {
    const config = getConfig();
    const encodedPath = encodeURIComponent(path);
    const url = `${config.storageEndpoint}/${encodedPath}?alt=media`;

    try {
      const result = await this._http.get(url);
      if (typeof result.body === 'string') {
        return result.body;
      }
      return JSON.stringify(result.body);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Deletes a file from Firebase Storage.
   * @param path - Storage path
   * @returns Whether the deletion succeeded
   */
  async deleteFile(path: string): Promise<boolean> {
    const config = getConfig();
    const encodedPath = encodeURIComponent(path);
    const url = `${config.storageEndpoint}/${encodedPath}`;

    try {
      const result = await this._http.delete(url);
      return result.status >= 200 && result.status < 300;
    } catch (_err) {
      return false;
    }
  }

  override async setup(): Promise<void> {
    this.debug('setup');
  }
}

export const getFirebaseStorage = (options: FirebaseStorageOptions): FirebaseStorageInterface =>
  new FirebaseStorage(options);
