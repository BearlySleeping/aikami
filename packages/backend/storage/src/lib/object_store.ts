// packages/backend/storage/src/lib/object_store.ts
//
// C-454: ObjectStore — a typed R2 object store over two drivers.
//
// The ObjectStore type exposes put/get/delete/list that accept a KeySpec
// plus its typed params, never a bare string key. Two factory functions
// create driver-specific implementations:
//
//   1. createWorkerObjectStore({ saves, catalog }) — for the hub's Cloudflare
//      Worker runtime (uses native R2Bucket bindings).
//   2. createS3ObjectStore({ saves, catalog }) — for publish pipelines
//      (uses Bun.S3Client instances against R2's S3-compatible endpoint).
//
// Both implement the same ObjectStore surface so callers are driver-agnostic.

import type { KeySpec } from '@aikami/schemas';
import type { R2Bucket } from '@cloudflare/workers-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Optional metadata applied when an object is uploaded. */
export type PutOptions = {
  /** MIME type persisted with the object, if known. */
  contentType?: string;
};

/** Driver-neutral typed access to the saves and catalog object stores. */
export type ObjectStore = {
  /**
   * Upload bytes to an object identified by a key spec + params.
   */
  put<Params extends object, PrefixParams extends object>(options: {
    spec: KeySpec<Params, PrefixParams>;
    params: Params;
    body: ArrayBuffer;
    options?: PutOptions;
  }): Promise<void>;

  /**
   * Read bytes from an object. Returns undefined when the object does not exist.
   */
  get<Params extends object, PrefixParams extends object>(options: {
    spec: KeySpec<Params, PrefixParams>;
    params: Params;
  }): Promise<ArrayBuffer | undefined>;

  /**
   * Delete an object by key spec + params.
   */
  delete<Params extends object, PrefixParams extends object>(options: {
    spec: KeySpec<Params, PrefixParams>;
    params: Params;
  }): Promise<void>;

  /**
   * List all object keys under a prefix derived from the key spec and prefix params.
   * Implementations must preserve the list-once-and-diff-in-memory strategy
   * (AC-4 regression gate).
   */
  list<Params extends object, PrefixParams extends object>(options: {
    spec: KeySpec<Params, PrefixParams>;
    prefixParams: PrefixParams;
  }): Promise<string[]>;
};

// ---------------------------------------------------------------------------
// Worker-binding driver (hub runtime)
// ---------------------------------------------------------------------------

/**
 * Create an ObjectStore backed by the Cloudflare Worker R2Bucket bindings.
 */
export const createWorkerObjectStore = (buckets: {
  saves: R2Bucket;
  catalog: R2Bucket;
}): ObjectStore => ({
  put: async ({ spec, params, body, options }) => {
    const bucket = buckets[spec.bucket];
    const key = spec.build(params);
    await bucket.put(key, body, {
      ...(options?.contentType ? { httpMetadata: { contentType: options.contentType } } : {}),
    });
  },

  get: async ({ spec, params }) => {
    const bucket = buckets[spec.bucket];
    const key = spec.build(params);
    const object = await bucket.get(key);
    return object ? object.arrayBuffer() : undefined;
  },

  delete: async ({ spec, params }) => {
    const bucket = buckets[spec.bucket];
    const key = spec.build(params);
    await bucket.delete(key);
  },

  list: async ({ spec, prefixParams }) => {
    const bucket = buckets[spec.bucket];
    const prefix = spec.buildPrefix(prefixParams);
    const keys: string[] = [];
    let cursor: string | undefined;
    while (true) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const obj of page.objects) {
        keys.push(obj.key);
      }
      cursor = page.truncated ? page.cursor : undefined;
      if (!cursor) {
        break;
      }
    }
    return keys;
  },
});

// ---------------------------------------------------------------------------
// S3 driver (catalog publish pipeline)
// ---------------------------------------------------------------------------

const MAX_PUT_ATTEMPTS = 3;
const PUT_TIMEOUT_MS = 30_000;
const RETRY_BASE_DELAY_MS = 250;

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const isTransientFailure = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return error instanceof TypeError;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create an ObjectStore backed by Bun.S3Client against an R2 S3-compatible
 * endpoint. Preserves the existing retry/backoff and list-once-diff-in-memory
 * strategy from upload.ts (AC-4).
 */
export const createS3ObjectStore = (clients: {
  saves: Bun.S3Client;
  catalog: Bun.S3Client;
}): ObjectStore => ({
  put: async ({ spec, params, body, options }) => {
    const s3 = clients[spec.bucket];
    const key = spec.build(params);
    const cacheControl = spec.cacheControl;
    const contentType = options?.contentType ?? 'application/octet-stream';

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
      try {
        const url = s3.file(key).presign({ method: 'PUT', expiresIn: 300 });
        const headers: Record<string, string> = {
          'Content-Type': contentType,
        };
        if (cacheControl) {
          headers['Cache-Control'] = cacheControl;
        }
        const response = await fetch(url, {
          method: 'PUT',
          headers,
          body,
          signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const error = new Error(
            `S3 PUT ${key} failed (${response.status}) ${text.slice(0, 200)}`,
          );
          if (isRetryableStatus(response.status) && attempt < MAX_PUT_ATTEMPTS) {
            lastError = error;
            await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
            continue;
          }
          throw error;
        }
        return;
      } catch (error) {
        if (attempt < MAX_PUT_ATTEMPTS && isTransientFailure(error)) {
          lastError = error;
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  },

  get: async ({ spec, params }) => {
    const s3 = clients[spec.bucket];
    const key = spec.build(params);
    const response = await fetch(s3.file(key).presign({ method: 'GET', expiresIn: 300 }));
    if (!response.ok) {
      if (response.status === 404) {
        return undefined;
      }
      throw new Error(`S3 GET ${key} failed (${response.status})`);
    }
    return response.arrayBuffer();
  },

  delete: async ({ spec, params }) => {
    const s3 = clients[spec.bucket];
    const key = spec.build(params);
    const url = s3.file(key).presign({ method: 'DELETE', expiresIn: 300 });
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE ${key} failed (${response.status})`);
    }
  },

  list: async ({ spec, prefixParams }) => {
    const s3 = clients[spec.bucket];
    const prefix = spec.buildPrefix(prefixParams);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    while (true) {
      const page = await s3.list({
        prefix,
        ...(continuationToken ? { continuationToken } : {}),
      });
      for (const obj of page.contents ?? []) {
        keys.push(obj.key);
      }
      const nextToken = page.nextContinuationToken;
      if (!(page.isTruncated ?? false) || !nextToken) {
        break;
      }
      continuationToken = nextToken;
    }
    return keys;
  },
});
