// apps/frontend/client/src/lib/services/assets/cache_backend.ts
//
// C-373: AssetCacheBackend — the content-hash-keyed binary cache contract.
// Implementations:
//   - OpfsCacheBackend    (Web/PWA — Origin Private File System)
//   - TauriFSCacheBackend (Desktop — @tauri-apps/plugin-fs native disk)
//
// Files are keyed by their SHA-256 digest (never by URL), so a binary's
// identity is its content hash. Every `put` verifies the hash BEFORE
// writing — a corrupt/mismatched download is discarded, never stored.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifies the platform backend implementation. */
export type AssetCacheBackendKind = 'opfs' | 'tauri-fs';

/**
 * Content-hash-keyed binary cache.
 *
 * All hashes are lowercase hex SHA-256 digests. Implementations must be
 * idempotent under concurrent `put` calls for the same hash (single
 * in-flight write) and must close every file handle/writable stream.
 */
export type AssetCacheBackend = {
  /** Platform identifier. */
  readonly kind: AssetCacheBackendKind;
  /** True when the backend successfully initialised (else all ops no-op). */
  readonly isAvailable: boolean;
  /** Opens the backing store. Safe to call multiple times. */
  init(): Promise<void>;
  /** Whether a blob with the given hash exists in the store. */
  has(hash: string): Promise<boolean>;
  /** Returns the stored blob, or undefined on a miss. */
  get(hash: string): Promise<Blob | undefined>;
  /**
   * Stores a blob under its content hash.
   *
   * Verifies `sha256(blob) === hash` BEFORE writing; on mismatch the blob
   * is discarded and an {@link AssetHashMismatchError} is thrown.
   */
  put(options: { hash: string; blob: Blob }): Promise<void>;
  /** Deletes the blob with the given hash. Missing entries are a no-op. */
  remove(hash: string): Promise<void>;
  /** Deletes every cached blob. */
  clear(): Promise<void>;
  /** Lists every cached content hash (cache enumeration for boot rehydration). */
  listHashes(): Promise<string[]>;
  /**
   * Requests persistent storage (OPFS). Non-fatal on denial.
   *
   * @returns Whether persistence was granted (Tauri FS is always persistent).
   */
  requestPersistence(): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a binary's computed SHA-256 does not match its registry hash.
 * The offending blob is discarded — never written to cache or served.
 */
export class AssetHashMismatchError extends Error {
  /** The authoritative hash from the registry. */
  readonly expectedHash: string;
  /** The hash actually computed from the downloaded bytes. */
  readonly actualHash: string;

  constructor(options: { expectedHash: string; actualHash: string }) {
    super(`Asset hash mismatch: expected ${options.expectedHash}, got ${options.actualHash}`);
    this.name = 'AssetHashMismatchError';
    this.expectedHash = options.expectedHash;
    this.actualHash = options.actualHash;
  }
}
