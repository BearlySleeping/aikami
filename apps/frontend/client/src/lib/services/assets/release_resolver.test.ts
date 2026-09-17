// apps/frontend/client/src/lib/services/assets/release_resolver.test.ts
//
// C-496 / C-523 — the client release-resolution path.
//
// The resolver must read the immutable release graph when a pointer exists,
// verify every pinned object by SHA-256, and FAIL CLOSED on corrupt/missing
// release metadata. Only a genuinely absent pointer (HTTP 404) takes the
// explicit legacy compatibility path.
//
// Contract: C-496, C-523

import { afterEach, describe, expect, mock, test } from 'bun:test';

// $logger resolves to the SvelteKit sink which pulls $env at import time —
// mock it so the module loads cleanly in Bun.
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

import { sha256Hex } from './asset_hasher.ts';
import { ReleaseResolutionError, resolveCatalogRelease } from './release_resolver.ts';

const ORIGIN = 'https://release-test.example.test';

const sha256 = (value: string): Promise<string> => sha256Hex(new Blob([value]));

/** Compact seed with a single LPC row. */
const SEED_JSON = JSON.stringify({
  sv: 1,
  g: '2026-09-16T00:00:00.000Z',
  o: ORIGIN,
  r: [{ t: 'lpc:body:bodies_male:walk', h: 'a'.repeat(64), s: 2048, c: 'lpc', e: '.webp' }],
});

const CORE_JSON = JSON.stringify({
  schemaVersion: 1,
  tags: ['lpc:body:bodies_male:walk'],
  rationale: { 'lpc:body:bodies_male': 'Default player body' },
});

/**
 * Serves a complete release graph: pointer + root + one shard + seed + core.
 * Every object's published hash is the real SHA-256 of its bytes, so a
 * correct resolver accepts it and any mutation makes it fail verification.
 */
const buildGraph = async (options?: {
  /** Mutate the pointer or a document before serving. */
  corrupt?: 'pointer' | 'root' | 'shard' | 'seed' | 'pack-lock';
}) => {
  const rootJson = JSON.stringify({ categories: [] });
  const shardJson = JSON.stringify({ id: 'lpc', entries: [] });
  const [seedHash, coreHash, rootHash, shardHash] = await Promise.all([
    sha256(SEED_JSON),
    sha256(CORE_JSON),
    sha256(rootJson),
    sha256(shardJson),
  ]);
  const packLockJson = JSON.stringify({ schemaVersion: 'catalog.release.v1' });
  const packLockHash = await sha256(packLockJson);
  const seedKey = `seed/${seedHash}/asset_seed.json`;
  const coreKey = `seed/${coreHash}/offline_core.json`;
  const rootKey = `index/v1/revisions/${rootHash}/catalog.json`;
  const shardKey = `index/v1/revisions/${shardHash}/lpc.json`;
  const packLockKey = `index/v1/revisions/${packLockHash}/pack_lock.json`;

  const pointer = {
    schemaVersion: 'catalog.release.v1',
    releaseId: '2026-09-16T00:00:00.000Z',
    rootKey,
    rootHash,
    shards: [{ category: 'lpc', key: shardKey, hash: shardHash }],
    dependencies: [
      { key: seedKey, hash: seedHash },
      { key: coreKey, hash: coreHash },
      { key: packLockKey, hash: packLockHash },
    ],
    publishedAt: '2026-09-16T00:00:00.000Z',
  };

  const documents = new Map<string, string>([
    ['index/v1/release.json', JSON.stringify(pointer)],
    [rootKey, rootJson],
    [shardKey, shardJson],
    [seedKey, SEED_JSON],
    [coreKey, CORE_JSON],
    [packLockKey, packLockJson],
  ]);

  if (options?.corrupt === 'pointer') {
    documents.set('index/v1/release.json', JSON.stringify({ schemaVersion: 'nope' }));
  }
  if (options?.corrupt === 'root') {
    documents.set(rootKey, `${rootJson} `);
  }
  if (options?.corrupt === 'shard') {
    documents.set(shardKey, `${shardJson} `);
  }
  if (options?.corrupt === 'seed') {
    documents.set(seedKey, `${SEED_JSON} `);
  }
  if (options?.corrupt === 'pack-lock') {
    documents.set(packLockKey, `${packLockJson} `);
  }
  return documents;
};

/** Installs a fetch stub that serves the given document map. */
const serveDocuments = (
  documents: Map<string, string>,
  overrides?: { missing?: readonly string[] },
): ReturnType<typeof mock> => {
  const fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    const base = ORIGIN.replace(/\/$/, '');
    if (!url.startsWith(`${base}/`)) {
      return new Response('not found', { status: 404 });
    }
    const key = url.slice(base.length + 1);
    if (overrides?.missing?.includes(key)) {
      return new Response('not found', { status: 404 });
    }
    const body = documents.get(key);
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(body, { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe('resolveCatalogRelease', () => {
  test('resolves the release graph and verifies every pinned object', async () => {
    serveDocuments(await buildGraph());

    const resolved = await resolveCatalogRelease({ originUrl: ORIGIN });

    expect(resolved.source).toBe('release');
    expect(resolved.releaseId).toBe('2026-09-16T00:00:00.000Z');
    expect(resolved.seed.rows).toHaveLength(1);
    expect(resolved.coreTags).toEqual(['lpc:body:bodies_male:walk']);
  });

  test('fails closed on a malformed pointer instead of using the legacy alias', async () => {
    const documents = await buildGraph({ corrupt: 'pointer' });
    // A legacy seed exists; a corrupt pointer must NOT be misread as "no release".
    documents.set('seed/asset_seed.json', SEED_JSON);
    serveDocuments(documents);

    await expect(resolveCatalogRelease({ originUrl: ORIGIN })).rejects.toBeInstanceOf(
      ReleaseResolutionError,
    );
  });

  test('fails closed when the root index hash does not match the pointer', async () => {
    const documents = await buildGraph({ corrupt: 'root' });
    documents.set('seed/asset_seed.json', SEED_JSON);
    serveDocuments(documents);

    const error = await resolveCatalogRelease({ originUrl: ORIGIN }).catch((e) => e);
    expect(error).toBeInstanceOf(ReleaseResolutionError);
    expect((error as ReleaseResolutionError).code).toBe('integrity-failure');
  });

  test('fails closed when a pinned shard hash does not match', async () => {
    serveDocuments(await buildGraph({ corrupt: 'shard' }));

    const error = await resolveCatalogRelease({ originUrl: ORIGIN }).catch((e) => e);
    expect((error as ReleaseResolutionError).code).toBe('integrity-failure');
  });

  test('fails closed when the pinned seed bytes do not match their hash', async () => {
    serveDocuments(await buildGraph({ corrupt: 'seed' }));

    const error = await resolveCatalogRelease({ originUrl: ORIGIN }).catch((e) => e);
    expect((error as ReleaseResolutionError).code).toBe('integrity-failure');
  });

  test('fails closed when any other pinned dependency does not match', async () => {
    serveDocuments(await buildGraph({ corrupt: 'pack-lock' }));

    const error = await resolveCatalogRelease({ originUrl: ORIGIN }).catch((e) => e);
    expect((error as ReleaseResolutionError).code).toBe('integrity-failure');
  });

  test('reports a missing pinned dependency rather than silently serving', async () => {
    const documents = await buildGraph();
    const seedKey = [...documents.keys()].find((key) => key.endsWith('/asset_seed.json'));
    serveDocuments(documents, { missing: seedKey ? [seedKey] : [] });

    const error = await resolveCatalogRelease({ originUrl: ORIGIN }).catch((e) => e);
    expect((error as ReleaseResolutionError).code).toBe('missing-dependency');
  });

  test('falls back to the legacy alias only when the pointer is genuinely absent (404)', async () => {
    const documents = new Map<string, string>([['seed/asset_seed.json', SEED_JSON]]);
    documents.set(
      'seed/offline_core.json',
      JSON.stringify({ schemaVersion: 1, tags: ['lpc:body:bodies_male:walk'], rationale: {} }),
    );
    serveDocuments(documents);

    const resolved = await resolveCatalogRelease({ originUrl: ORIGIN });

    expect(resolved.source).toBe('legacy-compat');
    expect(resolved.releaseId).toBe('legacy');
    expect(resolved.seed.rows).toHaveLength(1);
  });

  test('a transport failure on the pointer does not fall back to legacy', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;

    await expect(resolveCatalogRelease({ originUrl: ORIGIN })).rejects.toBeInstanceOf(
      ReleaseResolutionError,
    );
  });
});
