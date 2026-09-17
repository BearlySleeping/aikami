// apps/frontend/client/src/lib/services/assets/asset_store_transaction.test.ts
//
// C-496 / C-523 AC-5 — the AssetStore's transactional catalog semantics.
//
// Two invariants this file exists to lock down:
//
//   1. Catalog replacement is ATOMIC. A refresh resolves and validates the
//      complete candidate before touching the active state, so a failed attempt
//      at release N+1 rejects N+1 but leaves the previously verified release N
//      fully active — never a mixed or partially replaced snapshot.
//   2. The store RETAINS the verified installed pack lock belonging to the
//      selected release, so audio verification never re-fetches the mutable
//      `index/v1/pack_lock.json` alias.
//
// This file deliberately runs against a COLD store (no successful load in a
// `beforeEach`), so the "failed initial boot" case is observable. Bun's
// `--isolate` gives each test file its own module registry, so the singleton
// starts empty here.
//
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// Contract: C-496, C-523

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { CompactSeedDocument } from '@aikami/types';
import { sha256Hex } from './asset_hasher.ts';

const R2_BASE = 'https://assets.bearlysleeping.com';

// $logger resolves to the SvelteKit sink which pulls $env at import time —
// mock it so the store loads cleanly in Bun.
mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    spam: mock(() => {}),
    write: mock(() => {}),
    setLogLevel: mock(() => {}),
  },
}));

mock.module('@aikami/frontend/configs', () => ({
  publicEnv: { PUBLIC_ASSETS_BASE_URL: R2_BASE },
  getPublicMode: () => 'emulator',
}));

import { assetStore } from './asset_store.svelte';

const PACK_LOCK_ALIAS_KEY = 'index/v1/pack_lock.json';

const sha256 = async (value: string): Promise<string> => sha256Hex(new Blob([value]));

type LockSpec = { releaseId: string; audioHash: string };

const lockJson = (spec: LockSpec): string =>
  JSON.stringify({
    schemaVersion: 'catalog.release.v1',
    releaseId: spec.releaseId,
    assets: [{ id: 'atlas', imageHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64) }],
    audioAssets: [{ id: 'village.music', renditionHash: spec.audioHash }],
  });

/**
 * Builds a complete, self-consistent release graph served from a document map.
 *
 * @param options.releaseId - The release id, so a test can tell N from N+1.
 * @param options.audioHash - The lock's audio pin, so a test can tell the locks
 *   of two releases apart.
 * @param options.aliasLock - Also serve a DIFFERENT lock at the mutable alias.
 * @param options.corrupt - Sabotage one part of the candidate.
 */
const buildRelease = async (options: {
  releaseId: string;
  audioHash: string;
  aliasLock?: LockSpec;
  corrupt?: 'pointer' | 'pack-lock-hash' | 'pack-lock-body' | 'seed-body';
}) => {
  const seedJson = JSON.stringify({
    sv: 1,
    g: '2026-09-16T00:00:00.000Z',
    o: R2_BASE,
    r: [
      {
        t: 'lpc:body:bodies_male:walk',
        h: 'c'.repeat(64),
        s: 2048,
        c: 'lpc',
        e: '.webp',
      },
    ],
  });
  const coreJson = JSON.stringify({ schemaVersion: 1, tags: [], rationale: {} });
  const rootJson = JSON.stringify({ categories: [] });
  const shardJson = JSON.stringify({ id: 'lpc', entries: [] });
  const lock = lockJson({ releaseId: options.releaseId, audioHash: options.audioHash });

  const [seedHash, coreHash, rootHash, shardHash, lockHash] = await Promise.all([
    sha256(seedJson),
    sha256(coreJson),
    sha256(rootJson),
    sha256(shardJson),
    sha256(lock),
  ]);

  const seedKey = `seed/${seedHash}/asset_seed.json`;
  const coreKey = `seed/${coreHash}/offline_core.json`;
  const rootKey = `index/v1/revisions/${rootHash}/catalog.json`;
  const shardKey = `index/v1/revisions/${shardHash}/lpc.json`;
  const lockKey = `index/v1/revisions/${lockHash}/pack_lock.json`;

  const documents = new Map<string, string>([
    [rootKey, rootJson],
    [shardKey, shardJson],
    [seedKey, seedJson],
    [coreKey, coreJson],
    [lockKey, lock],
  ]);

  if (options.corrupt === 'pointer') {
    documents.set('index/v1/release.json', JSON.stringify({ schemaVersion: 'nope' }));
  } else if (options.corrupt === 'pack-lock-hash') {
    documents.set(lockKey, `${lock} `);
    documents.set(
      'index/v1/release.json',
      JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: options.releaseId,
        rootKey,
        rootHash,
        shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
        dependencies: [
          { key: seedKey, hash: seedHash },
          { key: coreKey, hash: coreHash },
          { key: lockKey, hash: lockHash },
        ],
        publishedAt: options.releaseId,
      }),
    );
  } else if (options.corrupt === 'pack-lock-body') {
    // Hash-valid bytes that are NOT a valid InstalledPackLock.
    const invalid = JSON.stringify({ schemaVersion: 'catalog.release.v1' });
    const invalidHash = await sha256(invalid);
    const invalidKey = `index/v1/revisions/${invalidHash}/pack_lock.json`;
    documents.set(invalidKey, invalid);
    documents.set(
      'index/v1/release.json',
      JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: options.releaseId,
        rootKey,
        rootHash,
        shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
        dependencies: [
          { key: seedKey, hash: seedHash },
          { key: coreKey, hash: coreHash },
          { key: invalidKey, hash: invalidHash },
        ],
        publishedAt: options.releaseId,
      }),
    );
  } else if (options.corrupt === 'seed-body') {
    // A seed that hashes correctly but is not a compact seed document.
    const invalidSeed = JSON.stringify({ sv: 99, r: 'nope' });
    const invalidHash = await sha256(invalidSeed);
    const invalidKey = `seed/${invalidHash}/asset_seed.json`;
    documents.set(invalidKey, invalidSeed);
    documents.set(
      'index/v1/release.json',
      JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: options.releaseId,
        rootKey,
        rootHash,
        shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
        dependencies: [
          { key: invalidKey, hash: invalidHash },
          { key: coreKey, hash: coreHash },
          { key: lockKey, hash: lockHash },
        ],
        publishedAt: options.releaseId,
      }),
    );
  } else {
    documents.set(
      'index/v1/release.json',
      JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: options.releaseId,
        rootKey,
        rootHash,
        shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
        dependencies: [
          { key: seedKey, hash: seedHash },
          { key: coreKey, hash: coreHash },
          { key: lockKey, hash: lockHash },
        ],
        publishedAt: options.releaseId,
      }),
    );
  }

  if (options.aliasLock) {
    documents.set(
      PACK_LOCK_ALIAS_KEY,
      lockJson({ releaseId: options.aliasLock.releaseId, audioHash: options.aliasLock.audioHash }),
    );
  }

  return documents;
};

/** Serves a document map, recording every requested URL. */
const serve = (
  documents: Map<string, string>,
): { requested: string[]; fetchMock: ReturnType<typeof mock> } => {
  const requested: string[] = [];
  const fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const base = R2_BASE.replace(/\/$/, '');
    if (!url.startsWith(`${base}/`)) {
      return new Response('not found', { status: 404 });
    }
    const key = url.slice(base.length + 1);
    const body = documents.get(key);
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(body, { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { requested, fetchMock };
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('AssetStore — failed initial boot fails closed', () => {
  test('a 500 on the pointer leaves no catalog at all', async () => {
    globalThis.fetch = mock(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;

    await assetStore.fetchManifest();

    expect(assetStore.error).toBeTruthy();
    expect(assetStore.manifest).toBeNull();
    expect(assetStore.seed).toBeNull();
    expect(assetStore.releaseId).toBeNull();
    expect(assetStore.releaseSource).toBeNull();
    expect(assetStore.packLock).toBeNull();
    expect(assetStore.packLockSource).toBeNull();
    expect(assetStore.resolveUrl('lpc:body:bodies_male:walk')).toBeNull();
  });

  test('a corrupt pointer on a cold boot leaves no catalog', async () => {
    serve(await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64), corrupt: 'pointer' }));

    await assetStore.fetchManifest();

    expect(assetStore.error).toContain('corrupt-release');
    expect(assetStore.seed).toBeNull();
    expect(assetStore.releaseId).toBeNull();
  });
});

describe('AssetStore — one update attempt per refresh (C-496)', () => {
  test('concurrent fetches on a cold store share one attempt', async () => {
    const { requested } = serve(await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64) }));

    await Promise.all([assetStore.fetchManifest(), assetStore.fetchManifest()]);

    const pointerReads = requested.filter((url) => url.endsWith('index/v1/release.json'));
    expect(pointerReads).toHaveLength(1);
    expect(assetStore.releaseId).toBe('n1');
  });

  test('concurrent rescans share one fresh attempt', async () => {
    const { requested } = serve(await buildRelease({ releaseId: 'n2', audioHash: '2'.repeat(64) }));

    await Promise.all([assetStore.rescanAssets(), assetStore.rescanAssets()]);

    const pointerReads = requested.filter((url) => url.endsWith('index/v1/release.json'));
    expect(pointerReads).toHaveLength(1);
    expect(assetStore.releaseId).toBe('n2');
  });
});

describe('AssetStore — atomic refresh (C-496)', () => {
  test('a successful release N is retained when the N+1 refresh fails', async () => {
    serve(await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64) }));
    await assetStore.rescanAssets();

    expect(assetStore.releaseId).toBe('n1');
    expect(assetStore.releaseSource).toBe('release');
    const seedN = assetStore.seed;
    const manifestN = assetStore.manifest;
    const coreTagsN = assetStore.coreTags;
    const lockN = assetStore.packLock;

    // N+1 fails at every stage a refresh can fail at.
    for (const corrupt of ['pointer', 'pack-lock-hash', 'pack-lock-body', 'seed-body'] as const) {
      serve(await buildRelease({ releaseId: 'n2', audioHash: '2'.repeat(64), corrupt }));
      await assetStore.rescanAssets();

      expect(assetStore.error).toBeTruthy();
      // Release N is still the complete, active snapshot — byte-for-byte.
      expect(assetStore.releaseId).toBe('n1');
      expect(assetStore.releaseSource).toBe('release');
      expect(assetStore.seed).toBe(seedN);
      expect(assetStore.manifest).toBe(manifestN);
      expect(assetStore.coreTags).toBe(coreTagsN);
      expect(assetStore.packLock).toBe(lockN);
      expect(assetStore.packLockSource).toBe('release');
      expect(assetStore.resolveUrl('lpc:body:bodies_male:walk')).toBe(
        `${R2_BASE}/assets/cc/${'c'.repeat(64)}.webp`,
      );
    }
  });

  test('a successful N+2 replaces N atomically', async () => {
    serve(await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64) }));
    await assetStore.rescanAssets();
    const seedN = assetStore.seed;

    serve(await buildRelease({ releaseId: 'n2', audioHash: '2'.repeat(64), corrupt: 'pointer' }));
    await assetStore.rescanAssets();
    expect(assetStore.releaseId).toBe('n1');

    serve(await buildRelease({ releaseId: 'n3', audioHash: '3'.repeat(64) }));
    await assetStore.rescanAssets();

    expect(assetStore.error).toBeNull();
    expect(assetStore.releaseId).toBe('n3');
    expect(assetStore.seed).not.toBe(seedN);
    expect(assetStore.packLock?.audioAssets?.[0]?.renditionHash).toBe('3'.repeat(64));
  });
});

describe('AssetStore — the selected release owns the pack lock (C-523 AC-5)', () => {
  test('retains the lock pinned by the resolved release, not the mutable alias', async () => {
    const { requested } = serve(
      await buildRelease({
        releaseId: 'n1',
        audioHash: '1'.repeat(64),
        aliasLock: { releaseId: 'other-release', audioHash: '9'.repeat(64) },
      }),
    );

    await assetStore.rescanAssets();

    expect(assetStore.packLockSource).toBe('release');
    expect(assetStore.packLock?.releaseId).toBe('n1');
    expect(assetStore.packLock?.audioAssets?.[0]?.renditionHash).toBe('1'.repeat(64));
    // The mutable alias is never even requested on the release path.
    expect(requested.some((url) => url.endsWith(PACK_LOCK_ALIAS_KEY))).toBe(false);
  });

  test('rewriting the alias after resolution cannot change the retained lock', async () => {
    const documents = await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64) });
    serve(documents);
    await assetStore.rescanAssets();

    const retained = assetStore.packLock;

    // A publication window / a stale client rewrites the alias afterwards.
    documents.set(PACK_LOCK_ALIAS_KEY, lockJson({ releaseId: 'n2', audioHash: '2'.repeat(64) }));
    // Reading the catalog again from the same verified graph yields the same lock.
    expect(assetStore.packLock).toBe(retained);
    expect(assetStore.packLock?.releaseId).toBe('n1');
  });

  test('a release that pins no lock reports absent and reads no alias', async () => {
    const documents = await buildRelease({ releaseId: 'n1', audioHash: '1'.repeat(64) });
    const pointer = JSON.parse(documents.get('index/v1/release.json') ?? '{}') as {
      dependencies: { key: string; hash: string }[];
    };
    pointer.dependencies = pointer.dependencies.filter(
      (dependency) => !dependency.key.endsWith('/pack_lock.json'),
    );
    documents.set('index/v1/release.json', JSON.stringify(pointer));
    documents.set(PACK_LOCK_ALIAS_KEY, lockJson({ releaseId: 'other', audioHash: '9'.repeat(64) }));
    const { requested } = serve(documents);

    await assetStore.rescanAssets();

    expect(assetStore.releaseSource).toBe('release');
    expect(assetStore.packLock).toBeNull();
    expect(assetStore.packLockSource).toBe('absent');
    expect(requested.some((url) => url.endsWith(PACK_LOCK_ALIAS_KEY))).toBe(false);
  });

  test('a genuinely legacy install reads the alias and reports the downgrade', async () => {
    const seed = JSON.stringify({
      sv: 1,
      g: '2026-09-16T00:00:00.000Z',
      o: R2_BASE,
      r: [],
    } satisfies CompactSeedDocument);
    const documents = new Map<string, string>([
      ['seed/asset_seed.json', seed],
      [PACK_LOCK_ALIAS_KEY, lockJson({ releaseId: 'legacy-release', audioHash: '7'.repeat(64) })],
    ]);
    serve(documents);

    await assetStore.rescanAssets();

    expect(assetStore.releaseSource).toBe('legacy-compat');
    expect(assetStore.releaseId).toBe('legacy');
    expect(assetStore.packLockSource).toBe('legacy-alias');
    expect(assetStore.packLock?.releaseId).toBe('legacy-release');
  });
});
