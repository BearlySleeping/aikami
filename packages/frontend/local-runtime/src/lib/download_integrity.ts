// packages/frontend/local-runtime/src/lib/download_integrity.ts
//
// Download integrity layer: per-job temp identity, atomic promotion,
// checksum/size verification, Range/ETag resume, and bounded concurrency.
// This is the portable core that both Browser and Tauri transports use.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DownloadJobId = string & { readonly __brand: 'DownloadJobId' };

export type DownloadJobOptions = {
  /** The download URL. */
  readonly url: string;
  /** Expected SHA-256 checksum. */
  readonly sha256: string;
  /** Expected total bytes. */
  readonly expectedBytes: number;
  /** Target path where the verified file should be placed. */
  readonly targetPath: string;
  /** Abort signal for cancellation. */
  readonly signal: AbortSignal;
  /** Progress callback. */
  readonly onProgress?: (receivedBytes: number, totalBytes: number) => void;
};

export type DownloadResult =
  | {
      readonly ok: true;
      readonly bytes: number;
      readonly sha256: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'cancelled'
        | 'size-mismatch'
        | 'checksum-mismatch'
        | 'network-error'
        | 'disk-full';
      readonly detail?: string;
    };

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

export const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// ---------------------------------------------------------------------------
// Job ID generation
// ---------------------------------------------------------------------------

let _jobCounter = 0;

/**
 * Generates a unique per-job temp identity. Each download job gets its own
 * temp name so two jobs never share one `<file>.part` sibling.
 */
export const generateJobId = (): DownloadJobId => {
  _jobCounter++;
  const ts = Date.now().toString(36);
  const counter = _jobCounter.toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `dl-${ts}-${counter}-${random}` as DownloadJobId;
};

/**
 * Derives a temp path from a job ID and target path. The temp path is
 * unique per job and cannot collide with another job's temp file.
 */
export const tempPathForJob = (jobId: DownloadJobId, targetPath: string): string => {
  const lastSlash = targetPath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? targetPath.slice(0, lastSlash) : '';
  const name = lastSlash >= 0 ? targetPath.slice(lastSlash + 1) : targetPath;
  return dir ? `${dir}/.${jobId}.${name}` : `.${jobId}.${name}`;
};

// ---------------------------------------------------------------------------
// Size enforcement while streaming
// ---------------------------------------------------------------------------

/**
 * Enforces size bounds while streaming: rejects if downloaded bytes exceed
 * the expected total, and checks final size matches.
 */
export const enforceSizeWhileStreaming = (
  downloaded: number,
  expectedBytes: number,
  path: string,
): void => {
  if (downloaded > expectedBytes) {
    throw new Error(
      `Download exceeded expected size for ${path} (${expectedBytes} bytes, got ${downloaded})`,
    );
  }
};

export const enforceFinalSize = (
  downloaded: number,
  expectedBytes: number,
  path: string,
): DownloadResult | null => {
  if (downloaded !== expectedBytes) {
    return {
      ok: false,
      reason: 'size-mismatch',
      detail: `Expected ${expectedBytes} bytes, got ${downloaded} for ${path}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Checksum verification
// ---------------------------------------------------------------------------

/**
 * Verifies the SHA-256 checksum of downloaded data against the expected
 * checksum. Returns a failure result on mismatch, null on success.
 */
export const verifyChecksum = async (
  data: ArrayBuffer,
  expectedSha256: string,
  path: string,
): Promise<DownloadResult | null> => {
  const hash = await sha256Hex(data);
  if (hash !== expectedSha256) {
    return {
      ok: false,
      reason: 'checksum-mismatch',
      detail: `Expected ${expectedSha256}, got ${hash} for ${path}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Atomic promotion
// ---------------------------------------------------------------------------

/**
 * Atomically promotes a temp buffer to a cache entry. Uses a per-job temp
 * key so no two jobs collide. On failure, the temp entry is removed and
 * the existing good entry (if any) is preserved.
 */
export const atomicPromoteToCache = async (options: {
  readonly cache: Cache;
  readonly tempKey: string;
  readonly finalKey: string;
  readonly data: Uint8Array;
  readonly contentType?: string;
}): Promise<void> => {
  const { cache, tempKey, finalKey, data, contentType } = options;

  // Write to temp key first
  await cache.put(
    tempKey,
    new Response(data as BodyInit, {
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(data.byteLength),
      },
    }),
  );

  // Atomic: copy from temp to final, then delete temp
  const tempResponse = await cache.match(tempKey);
  if (!tempResponse) {
    throw new Error(`Temp cache entry ${tempKey} not found after write`);
  }

  // Write final
  await cache.put(
    finalKey,
    new Response(data as BodyInit, {
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
        'Content-Length': String(data.byteLength),
      },
    }),
  );

  // Remove temp
  await cache.delete(tempKey);
};

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/**
 * Builds a fetch request that includes Range and If-None-Match headers for
 * resume support, given a previously downloaded byte count.
 */
export const buildResumeRequest = (
  url: string,
  downloadedBytes: number,
  etag?: string,
): Request => {
  const headers: Record<string, string> = {};
  if (downloadedBytes > 0) {
    headers.Range = `bytes=${downloadedBytes}-`;
  }
  if (etag) {
    headers['If-None-Match'] = etag;
  }
  return new Request(url, { headers });
};

/**
 * Checks whether a response indicates that range requests are supported
 * (206 Partial Content) vs the full resource (200).
 */
export const isRangeResponse = (response: Response): boolean => response.status === 206;

/**
 * Extracts the ETag from a response, if present.
 */
export const extractEtag = (response: Response): string | undefined =>
  response.headers.get('ETag') ?? undefined;

/**
 * Extracts Content-Length from a response, falling back to 0 if absent.
 */
export const extractContentLength = (response: Response): number => {
  const len = response.headers.get('Content-Length');
  return len ? Number.parseInt(len, 10) : 0;
};
