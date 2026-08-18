// apps/frontend/client/src/lib/services/assets/cache_backend.test.ts
//
// C-373 AC-2: Cache backend tests — OPFS + Tauri FS backends,
// hash-verify-before-write, mismatch discard.
//
// The OPFS backend is tested against an in-memory OPFS mock (Bun has no
// navigator.storage); the Tauri backend is tested for graceful
// unavailability in non-Tauri environments (dynamic import fails → safe
// no-op backend).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sha256Hex } from './asset_hasher.ts';
import { AssetHashMismatchError } from './cache_backend.ts';
import { OpfsCacheBackend } from './opfs_cache_backend.ts';
import { TauriFSCacheBackend } from './tauri_fs_cache_backend.ts';

// ---------------------------------------------------------------------------
// In-memory OPFS mock
// ---------------------------------------------------------------------------

type MemoryDir = {
  dirs: Map<string, MemoryDir>;
  files: Map<string, Blob>;
  /** Total write() calls across all writables — dedupe/atomicity assertions. */
  writeCount: number;
};

const makeMemoryFileHandle = (name: string, dir: MemoryDir): FileSystemFileHandle => {
  return {
    getFile: async (): Promise<File> => {
      const blob = dir.files.get(name);
      if (!blob) {
        throw new Error(`Memory OPFS: file not found: ${name}`);
      }
      return blob as File;
    },
    createWritable: async (): Promise<FileSystemWritableFileStream> => {
      // Accumulate every chunk written — never replace the previous one.
      const parts: Blob[] = [];
      return {
        write: async (data: Blob): Promise<void> => {
          parts.push(data);
          dir.writeCount += 1;
        },
        close: async (): Promise<void> => {
          dir.files.set(name, new Blob(parts));
        },
      } as unknown as FileSystemWritableFileStream;
    },
    move: async (newName: string): Promise<void> => {
      // Atomic rename: swap the entry under the final name.
      const blob = dir.files.get(name);
      if (blob !== undefined) {
        dir.files.set(newName, blob);
        dir.files.delete(name);
      }
    },
  } as unknown as FileSystemFileHandle;
};

const makeMemoryDirHandle = (dir: MemoryDir): FileSystemDirectoryHandle =>
  ({
    getDirectoryHandle: async (
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemDirectoryHandle> => {
      let child = dir.dirs.get(name);
      if (!child && options?.create) {
        child = { dirs: new Map(), files: new Map(), writeCount: 0 };
        dir.dirs.set(name, child);
      }
      if (!child) {
        throw new Error(`Memory OPFS: dir not found: ${name}`);
      }
      return makeMemoryDirHandle(child);
    },
    getFileHandle: async (
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemFileHandle> => {
      if (options?.create && !dir.files.has(name)) {
        dir.files.set(name, new Blob([]));
      }
      if (!dir.files.has(name)) {
        throw new Error(`Memory OPFS: file not found: ${name}`);
      }
      return makeMemoryFileHandle(name, dir);
    },
    removeEntry: async (name: string): Promise<void> => {
      dir.dirs.delete(name);
      dir.files.delete(name);
    },
    async *entries(): AsyncIterableIterator<[string, unknown]> {
      for (const [name, file] of dir.files) {
        yield [name, file];
      }
      for (const [name, sub] of dir.dirs) {
        yield [name, sub];
      }
    },
  }) as unknown as FileSystemDirectoryHandle;

/** Installs the in-memory OPFS root and returns it for assertions. */
const installMemoryOpfs = (): MemoryDir => {
  const root: MemoryDir = { dirs: new Map(), files: new Map(), writeCount: 0 };
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: {
      getDirectory: async (): Promise<FileSystemDirectoryHandle> => makeMemoryDirHandle(root),
      persist: async (): Promise<boolean> => true,
    },
    configurable: true,
    writable: true,
  });
  return root;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeBlob = (text: string): Blob => new Blob([text], { type: 'application/octet-stream' });

// ---------------------------------------------------------------------------
// OpfsCacheBackend
// ---------------------------------------------------------------------------

describe('OpfsCacheBackend', () => {
  let backend: OpfsCacheBackend;
  let root: MemoryDir;

  beforeEach(async () => {
    root = installMemoryOpfs();
    backend = new OpfsCacheBackend();
    await backend.init();
  });

  afterEach(() => {
    // restore a storage-less navigator for other suites
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: undefined,
      configurable: true,
    });
  });

  test('init opens the aikami-assets root and marks available', () => {
    expect(backend.isAvailable).toBe(true);
    expect(root.dirs.has('aikami-assets')).toBe(true);
  });

  test('put stores a blob under its content hash; get/has/remove work', async () => {
    const blob = makeBlob('hello world');
    const hash = await sha256Hex(blob);

    await backend.put({ hash, blob });

    expect(await backend.has(hash)).toBe(true);
    const stored = await backend.get(hash);
    expect(stored).toBeDefined();
    if (stored) {
      expect(await stored.text()).toBe('hello world');
    }

    await backend.remove(hash);
    expect(await backend.has(hash)).toBe(false);
    expect(await backend.get(hash)).toBeUndefined();
  });

  test('put verifies the hash BEFORE writing — mismatch is discarded', async () => {
    const blob = makeBlob('actual bytes');
    const wrongHash = 'f'.repeat(64);

    await expect(backend.put({ hash: wrongHash, blob })).rejects.toBeInstanceOf(
      AssetHashMismatchError,
    );

    // Nothing was written — the corrupt blob is discarded.
    expect(await backend.has(wrongHash)).toBe(false);
    expect(await backend.get(wrongHash)).toBeUndefined();
  });

  test('clear removes every cached blob', async () => {
    const blobA = makeBlob('a');
    const blobB = makeBlob('b');
    await backend.put({ hash: await sha256Hex(blobA), blob: blobA });
    await backend.put({ hash: await sha256Hex(blobB), blob: blobB });

    await backend.clear();

    expect(await backend.has(await sha256Hex(blobA))).toBe(false);
    expect(await backend.has(await sha256Hex(blobB))).toBe(false);
  });

  test('listHashes enumerates every cached content hash', async () => {
    const blobA = makeBlob('aaa');
    const blobB = makeBlob('bbb');
    const hashA = await sha256Hex(blobA);
    const hashB = await sha256Hex(blobB);
    await backend.put({ hash: hashA, blob: blobA });
    await backend.put({ hash: hashB, blob: blobB });

    const hashes = (await backend.listHashes()).sort();
    expect(hashes).toEqual([hashA, hashB].sort());
  });

  test('concurrent put for the same hash is deduplicated without error', async () => {
    const blob = makeBlob('same bytes');
    const hash = await sha256Hex(blob);

    await Promise.all([
      backend.put({ hash, blob }),
      backend.put({ hash, blob }),
      backend.put({ hash, blob }),
    ]);

    expect(await backend.has(hash)).toBe(true);
    const stored = await backend.get(hash);
    expect(stored).toBeDefined();
    if (stored) {
      // Accumulated content survived the atomic write (no partial entry).
      expect(await stored.text()).toBe('same bytes');
    }
    // Exactly one physical write — the in-flight dedupe collapsed the three
    // concurrent puts into a single write.
    const assetsDir = root.dirs.get('aikami-assets');
    expect(assetsDir?.writeCount).toBe(1);
  });

  test('uninitialised backend is a safe no-op for read paths', async () => {
    const uninit = new OpfsCacheBackend();
    expect(uninit.isAvailable).toBe(false);
    expect(await uninit.has('abc')).toBe(false);
    expect(await uninit.get('abc')).toBeUndefined();
    await expect(uninit.put({ hash: 'abc', blob: makeBlob('x') })).rejects.toThrow(
      'not initialised',
    );
  });
});

// ---------------------------------------------------------------------------
// TauriFSCacheBackend
// ---------------------------------------------------------------------------

describe('TauriFSCacheBackend (non-Tauri env)', () => {
  test('init fails gracefully — backend is unavailable and read ops no-op', async () => {
    // No __TAURI__ in window → dynamic import of @tauri-apps/plugin-fs throws.
    const backend = new TauriFSCacheBackend();
    await backend.init();

    expect(backend.isAvailable).toBe(false);
    expect(await backend.requestPersistence()).toBe(false);
    expect(await backend.has('abc')).toBe(false);
    expect(await backend.get('abc')).toBeUndefined();
    await backend.remove('abc'); // no-op, does not throw
    await backend.clear(); // no-op, does not throw
  });

  test('put throws when the backend was never initialised', async () => {
    const backend = new TauriFSCacheBackend();
    await expect(backend.put({ hash: 'abc', blob: makeBlob('x') })).rejects.toThrow(
      'not initialised',
    );
  });
});
