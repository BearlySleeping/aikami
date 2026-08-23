// scripts/src/lib/catalog/upload.ts
//
// Content-addressed uploader for the catalog origin (C-395 AC-1).
//
// R2 speaks the S3 API — this module uses Bun's built-in S3 client
// (Bun.s3) configured against R2's endpoint, NOT a Cloudflare-specific SDK,
// so the origin stays swappable (same portability argument as I-9).
//
// Idempotency + resumability (AC-1):
//   - The bucket is listed ONCE by prefix and the existing keys are diffed in
//     memory — never one HEAD per object (12,707 sequential round trips would
//     dominate the runtime, and 12,707 re-writes each run would burn the R2
//     free tier's Class A operations).
//   - Objects are content-addressed, so a skipped key is guaranteed identical
//     to the local bytes (same sha256 → same key). An interrupted run simply
//     leaves partial objects; the next run skips them. The index is written
//     LAST by the publish orchestrator, so a partial publish never produces
//     an index pointing at missing bytes.

import type { CatalogConfig } from './config.ts';
import { ASSET_CACHE_CONTROL, contentTypeForExt } from './config.ts';

// ---------------------------------------------------------------------------
// Client abstraction (test seam)
// ---------------------------------------------------------------------------

/** Minimal S3 surface the uploader needs. Tests inject an in-memory fake. */
export type R2ClientLike = {
  /** List object keys under a prefix (paged internally). */
  listKeys(prefix: string): Promise<string[]>;
  /** Upload one object with content metadata. */
  putObject(options: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl: string;
  }): Promise<void>;
};

/** Real client backed by Bun's S3 client against the R2 endpoint. */
export const createR2Client = (config: CatalogConfig): R2ClientLike => {
  const s3 = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: 'auto',
  });

  return {
    async listKeys(prefix) {
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
        // Stop when the page is not truncated, OR when it claims truncation
        // but offers no continuation token — continuing with the same
        // continuation state would re-request the same page forever.
        const nextToken = page.nextContinuationToken;
        if (!(page.isTruncated ?? false) || !nextToken) {
          break;
        }
        continuationToken = nextToken;
      }
      return keys;
    },
    async putObject({ key, body, contentType, cacheControl }) {
      // Bun's S3 client does not expose per-object Cache-Control, so the PUT
      // goes through a presigned URL with explicit headers. Verified against
      // the live bucket: the custom domain serves exactly these headers.
      // Retries are bounded with backoff for timeouts, network failures and
      // transient 5xx/429 responses; the final failure is propagated.
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
        try {
          const url = s3.file(key).presign({ method: 'PUT', expiresIn: 300 });
          const response = await fetch(url, {
            method: 'PUT',
            headers: {
              'Cache-Control': cacheControl,
              'Content-Type': contentType,
            },
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
  };
};

// ---------------------------------------------------------------------------
// Upload plan
// ---------------------------------------------------------------------------

/** One local file to consider for upload. */
export type CatalogUploadItem = {
  /** Content-addressed object key. */
  key: string;
  /** Absolute local path. */
  localPath: string;
  /** File extension including the dot (MIME lookup). */
  ext: string;
};

export type UploadReport = {
  uploaded: number;
  skipped: number;
  failed: number;
  /** Total bytes of successfully uploaded objects. */
  bytesTransferred: number;
  /** Keys that failed (non-zero failed ⇒ exit non-zero). */
  failedKeys: readonly string[];
};

const CONCURRENCY = 16;

/** Max attempts per presigned PUT (original + retries). */
const MAX_PUT_ATTEMPTS = 3;

/** Per-attempt timeout for the presigned PUT fetch. */
const PUT_TIMEOUT_MS = 30_000;

/** Base backoff for PUT retries (doubles per attempt: 250ms, 500ms). */
const RETRY_BASE_DELAY_MS = 250;

/** Transient HTTP statuses worth retrying — 429 (rate limit) and 5xx. */
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * Timeouts (AbortSignal.timeout → DOMException TimeoutError/AbortError) and
 * network-level fetch failures (TypeError) are transient; everything else
 * (including the non-retryable HTTP error thrown in putObject) propagates.
 */
const isTransientFailure = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return error instanceof TypeError;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload catalog assets, skipping objects whose content-addressed key already
 * exists in the bucket.
 */
export const uploadAssets = async (options: {
  client: R2ClientLike;
  items: readonly CatalogUploadItem[];
  assetKeyPrefix: string;
  concurrency?: number;
}): Promise<UploadReport> => {
  const { client, items, assetKeyPrefix, concurrency = CONCURRENCY } = options;

  const existing = new Set(await client.listKeys(assetKeyPrefix));

  // Dedupe by key: objects are content-addressed, so every item sharing a key
  // is byte-identical and one upload serves them all. Without this, duplicate
  // keys (e.g. many LPC sheets whose first frame is identical → same thumbnail
  // hash) would be PUT concurrently, tripping R2's per-object rate limit
  // ("Reduce your concurrent request rate for the same object").
  const missing = [...new Map(items.map((item) => [item.key, item])).values()].filter(
    (item) => !existing.has(item.key),
  );
  const skipped = items.length - missing.length;

  let uploaded = 0;
  let failed = 0;
  let bytesTransferred = 0;
  const failedKeys: string[] = [];

  const readBody = async (localPath: string): Promise<Uint8Array> => {
    const file = Bun.file(localPath);
    return new Uint8Array(await file.arrayBuffer());
  };

  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const body = await readBody(item.localPath);
          await client.putObject({
            key: item.key,
            body,
            contentType: contentTypeForExt(item.ext),
            cacheControl: ASSET_CACHE_CONTROL,
          });
          return { ok: true as const, size: body.byteLength };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`  ❌ Upload failed: ${item.key} — ${message}`);
          return { ok: false as const, key: item.key };
        }
      }),
    );

    for (const result of results) {
      if (result.ok) {
        uploaded++;
        bytesTransferred += result.size;
      } else {
        failed++;
        failedKeys.push(result.key);
      }
    }
  }

  return { uploaded, skipped, failed, bytesTransferred, failedKeys };
};
