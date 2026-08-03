// apps/frontend/client/src/lib/services/assets/tauri_fs_cache_backend.ts
//
// C-373: TauriFSCacheBackend — native disk cache for the Tauri desktop
// build, backed by @tauri-apps/plugin-fs. Hash-named files live under
// `appDataDir()/aikami-assets`. Platform-guarded: the Tauri modules are
// dynamically imported (platform-specific code — justified), and in a
// plain browser init() fails gracefully leaving a safe no-op backend.
//
// The DB on Tauri still goes through the WASM/OPFS adapter (C-321 watch
// point) — this backend only handles binary blobs, never SQLite rows.

import { logger } from '$logger';
import { sha256Hex } from './asset_hasher.ts';
import {
  type AssetCacheBackend,
  type AssetCacheBackendKind,
  AssetHashMismatchError,
} from './cache_backend.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of @tauri-apps/plugin-fs used by this backend. */
type TauriFsModule = {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readDir(
    path: string,
  ): Promise<
    readonly { name: string; isFile?: boolean; isDirectory?: boolean; isSymlink?: boolean }[]
  >;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
};

/** Matches a lowercase hex SHA-256 digest (content-hash file name). */
const _SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

/**
 * Tauri-native disk cache for desktop asset binaries.
 *
 * Files are named by SHA-256 digest under `appDataDir()/aikami-assets`.
 * `put` verifies the hash before writing; mismatched blobs are discarded.
 */
export class TauriFSCacheBackend implements AssetCacheBackend {
  /** Platform identifier. */
  readonly kind: AssetCacheBackendKind = 'tauri-fs';

  /** True once the cache directory is writable. */
  isAvailable = false;

  /** The plugin-fs module (set during init on Tauri). */
  private _fs: TauriFsModule | null = null;

  /** Path join helper from @tauri-apps/api/path (set during init). */
  private _join: ((...paths: string[]) => Promise<string>) | null = null;

  /** Cache directory path under appDataDir(). */
  private _dir = '';

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** @inheritdoc */
  async init(): Promise<void> {
    if (this._fs) {
      return;
    }
    try {
      // Platform-specific code — dynamic import is justified here.
      const [{ appDataDir, join }, fs] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-fs'),
      ]);
      const base = await appDataDir();
      this._join = join as (...paths: string[]) => Promise<string>;
      this._dir = await join(base, 'aikami-assets');
      await fs.mkdir(this._dir, { recursive: true });
      this._fs = fs as unknown as TauriFsModule;
      this.isAvailable = true;
      logger.debug('TauriFSCacheBackend.init:ready', { dir: this._dir });
    } catch (error) {
      logger.warn('TauriFSCacheBackend.init:unavailable', {
        error: String(error),
        message: 'Falling back to OPFS cache (or online mode) in non-Tauri environments.',
      });
      this.isAvailable = false;
    }
  }

  /** @inheritdoc */
  async requestPersistence(): Promise<boolean> {
    // Native disk cache is inherently persistent.
    return this.isAvailable;
  }

  // ── Cache operations ─────────────────────────────────────────────────

  /** @inheritdoc */
  async has(hash: string): Promise<boolean> {
    if (!this._fs) {
      return false;
    }
    try {
      return await this._fs.exists(await this._path(hash));
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async get(hash: string): Promise<Blob | undefined> {
    if (!this._fs) {
      return undefined;
    }
    try {
      const bytes = await this._fs.readFile(await this._path(hash));
      return new Blob([bytes as unknown as ArrayBuffer]);
    } catch {
      return undefined;
    }
  }

  /** @inheritdoc */
  async put(options: { hash: string; blob: Blob }): Promise<void> {
    if (!this._fs) {
      throw new Error('TauriFSCacheBackend: not initialised');
    }

    // Verify BEFORE write — discard corrupt/mismatched downloads.
    const actualHash = await sha256Hex(options.blob);
    if (actualHash !== options.hash) {
      logger.warn('TauriFSCacheBackend.put:hash-mismatch', {
        expected: options.hash,
        actual: actualHash,
      });
      throw new AssetHashMismatchError({ expectedHash: options.hash, actualHash });
    }

    const bytes = new Uint8Array(await options.blob.arrayBuffer());
    await this._fs.writeFile(await this._path(options.hash), bytes);
  }

  /** @inheritdoc */
  async remove(hash: string): Promise<void> {
    if (!this._fs) {
      return;
    }
    try {
      await this._fs.remove(await this._path(hash));
    } catch {
      // Already gone — no-op
    }
  }

  /** @inheritdoc */
  async clear(): Promise<void> {
    if (!this._fs) {
      return;
    }
    try {
      await this._fs.remove(this._dir, { recursive: true });
      await this._fs.mkdir(this._dir, { recursive: true });
    } catch (error) {
      logger.warn('TauriFSCacheBackend.clear:failed', { error: String(error) });
    }
  }

  /** @inheritdoc */
  async listHashes(): Promise<string[]> {
    if (!this._fs) {
      return [];
    }
    try {
      const entries = await this._fs.readDir(this._dir);
      // Only regular files whose name is a 64-char SHA-256 hex digest count
      // as cached binaries — exclude directories and symlinks before applying
      // the hash-name filter so cache enumeration stays accurate.
      return entries
        .filter((entry) => !entry.isDirectory && !entry.isSymlink)
        .map((entry) => entry.name)
        .filter((name) => _SHA256_HEX_RE.test(name));
    } catch {
      return [];
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /** Joins the cache dir with a hash file name. */
  private async _path(hash: string): Promise<string> {
    if (this._join) {
      try {
        return await this._join(this._dir, hash);
      } catch {
        // Fall back to manual join if the platform helper fails.
      }
    }
    return `${this._dir}/${hash}`;
  }
}
