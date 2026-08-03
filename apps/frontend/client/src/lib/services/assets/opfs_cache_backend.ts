// apps/frontend/client/src/lib/services/assets/opfs_cache_backend.ts
//
// C-373: OpfsCacheBackend — content-hash-keyed binary cache over the
// Origin Private File System (Web/PWA). Replaces C-203's URL/djb2-keyed
// OpfsAssetCache: files are named by their SHA-256 digest, every write is
// hash-verified, and concurrent puts for the same hash are deduplicated.
//
// OPFS handle lifecycle (watch point): every FileSystemWritableFileStream
// is closed in a `finally`; a handle is never held across retries.

import { logger } from '$logger';
import { sha256Hex } from './asset_hasher.ts';
import {
  type AssetCacheBackend,
  type AssetCacheBackendKind,
  AssetHashMismatchError,
} from './cache_backend.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OPFS root directory name for cached asset binaries. */
const CACHE_ROOT = 'aikami-assets';

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

/**
 * OPFS-backed content-hash cache for Web/PWA asset binaries.
 *
 * Hash-named files live directly under the `aikami-assets` OPFS root (a
 * content-hash is self-describing — no category subdirectories needed).
 * `put` verifies SHA-256 before writing and throws
 * {@link AssetHashMismatchError} on mismatch without storing anything.
 */
export class OpfsCacheBackend implements AssetCacheBackend {
  /** Platform identifier. */
  readonly kind: AssetCacheBackendKind = 'opfs';

  /** True once the OPFS root is open. */
  isAvailable = false;

  /** OPFS root directory handle for cached binaries. */
  private _root: FileSystemDirectoryHandle | null = null;

  /** In-flight writes keyed by hash — dedupes concurrent put() calls. */
  private readonly _inFlightPuts = new Map<string, Promise<void>>();

  /** Whether persistence has been requested. */
  private _persistenceRequested = false;

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** @inheritdoc */
  async init(): Promise<void> {
    if (this._root) {
      return;
    }
    try {
      const root = await navigator.storage.getDirectory();
      this._root = await root.getDirectoryHandle(CACHE_ROOT, { create: true });
      this.isAvailable = true;
      logger.debug('OpfsCacheBackend.init:ready');
    } catch (error) {
      logger.warn('OpfsCacheBackend.init:failed', { error: String(error) });
      this.isAvailable = false;
    }
  }

  /** @inheritdoc */
  async requestPersistence(): Promise<boolean> {
    if (this._persistenceRequested) {
      return this.isAvailable;
    }
    this._persistenceRequested = true;

    try {
      if ('storage' in navigator && 'persist' in navigator.storage) {
        const granted = await navigator.storage.persist();
        if (!granted) {
          logger.warn('OpfsCacheBackend.requestPersistence:denied', {
            message: 'Browser denied persistent storage — cached assets may be evicted.',
          });
        }
        return granted;
      }
      return true;
    } catch (error) {
      logger.warn('OpfsCacheBackend.requestPersistence:error', { error: String(error) });
      return false;
    }
  }

  // ── Cache operations ─────────────────────────────────────────────────

  /** @inheritdoc */
  async has(hash: string): Promise<boolean> {
    if (!this._root) {
      return false;
    }
    try {
      await this._root.getFileHandle(hash);
      return true;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async get(hash: string): Promise<Blob | undefined> {
    if (!this._root) {
      return undefined;
    }
    try {
      const handle = await this._root.getFileHandle(hash);
      return await handle.getFile();
    } catch {
      return undefined;
    }
  }

  /** @inheritdoc */
  async put(options: { hash: string; blob: Blob }): Promise<void> {
    if (!this._root) {
      throw new Error('OpfsCacheBackend: not initialised — call init() first');
    }

    // Verify BEFORE write — discard corrupt/mismatched downloads.
    const actualHash = await sha256Hex(options.blob);
    if (actualHash !== options.hash) {
      logger.warn('OpfsCacheBackend.put:hash-mismatch', {
        expected: options.hash,
        actual: actualHash,
      });
      throw new AssetHashMismatchError({ expectedHash: options.hash, actualHash });
    }

    // Dedupe concurrent writes for the same hash (InvalidStateError guard).
    const inFlight = this._inFlightPuts.get(options.hash);
    if (inFlight) {
      return inFlight;
    }

    const promise = this._write(options.hash, options.blob);
    this._inFlightPuts.set(options.hash, promise);
    try {
      await promise;
    } finally {
      this._inFlightPuts.delete(options.hash);
    }
  }

  /** @inheritdoc */
  async remove(hash: string): Promise<void> {
    if (!this._root) {
      return;
    }
    try {
      await this._root.removeEntry(hash);
    } catch {
      // Already gone — no-op
    }
  }

  /** @inheritdoc */
  async clear(): Promise<void> {
    if (!this._root) {
      return;
    }
    for await (const [name] of this._root.entries()) {
      try {
        await this._root.removeEntry(name);
      } catch {
        // File in use or already removed — skip
      }
    }
  }

  /** @inheritdoc */
  async listHashes(): Promise<string[]> {
    if (!this._root) {
      return [];
    }
    const hashes: string[] = [];
    for await (const [name] of this._root.entries()) {
      hashes.push(name);
    }
    return hashes;
  }

  // ── Private ──────────────────────────────────────────────────────────

  /** Writes a verified blob to a hash-named OPFS file. */
  private async _write(hash: string, blob: Blob): Promise<void> {
    const root = this._root;
    if (!root) {
      throw new Error('OpfsCacheBackend: not initialised');
    }
    const handle = await root.getFileHandle(hash, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      // Close in finally — never hold a handle across retries (watch point).
      await writable.close();
    }
  }
}
