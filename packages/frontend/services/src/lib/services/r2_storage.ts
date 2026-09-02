// packages/frontend/services/src/lib/services/r2_storage.ts
//
// Cloudflare R2 frontend wrapper (C-426). R2 is a Worker binding
// (server-side), so the client never touches R2 credentials directly.
// Instead this wrapper calls hub API endpoints (`/api/storage/upload`,
// `/api/storage/url`) that the hub mediates against `env.SAVES_BUCKET` —
// exactly like `save_backup.ts` does. Every request is session-verified by
// the hub (Better Auth cookie), so objects are never public or guessable.
//
// The interface exposes `upload(path, file)` and `getDownloadURL(...)` so
// the existing `StorageService.uploadAvatar` works unchanged.
//
// C-454: key construction is delegated to callers who import the shared
// userObjectKey spec — this driver accepts the already-built path string
// and does not build keys itself.

import { toAppError } from '@aikami/utils';

/** Result of an upload — carries the object path for getDownloadURL. */
export type R2UploadResult = {
  ref: string;
};

export type R2StorageInterface = {
  /**
   * Uploads a file to the R2 saves bucket at the given path.
   * @param path The object key. Should be built from the shared
   *   `userObjectKey` spec (from @aikami/schemas) — e.g.
   *   `userObjectKey.build({ uid, filename: 'avatar.png' })`.
   * @param file The file/blob bytes.
   * @returns The object path (for getDownloadURL).
   */
  upload(path: string, file: Blob | File | ArrayBuffer): Promise<R2UploadResult>;

  /**
   * Resolves a public download URL for an object path.
   * @param ref The object path (from upload()).
   * @returns The download URL.
   */
  getDownloadURL(ref: string): Promise<string>;
};

const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return toAppError({
    errorType: 'internal',
    errorMessage: body.message ?? body.error ?? `Storage request failed (HTTP ${response.status})`,
  });
};

/**
 * R2 storage wrapper backed by the hub's session-gated storage endpoints.
 *
 * @param hubBase The hub base URL (same-origin `/api/hub` in emulator/testing,
 *                or the deployed hub origin in staging/production).
 */
export const createR2Storage = (hubBase: string): R2StorageInterface => {
  const upload = async (path: string, file: Blob | File | ArrayBuffer): Promise<R2UploadResult> => {
    const response = await fetch(`${hubBase}/storage/upload?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      credentials: 'include',
      body: file,
    });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    return { ref: path };
  };

  const getDownloadURL = async (ref: string): Promise<string> => {
    const response = await fetch(`${hubBase}/storage/url?path=${encodeURIComponent(ref)}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    const body = (await response.json()) as { url?: string };
    if (!body.url) {
      throw toAppError({ errorType: 'internal', errorMessage: 'Storage URL resolution failed' });
    }
    return body.url;
  };

  return { upload, getDownloadURL };
};
