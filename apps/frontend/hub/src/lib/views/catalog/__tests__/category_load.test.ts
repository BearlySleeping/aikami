// apps/frontend/hub/src/lib/views/catalog/__tests__/category_load.test.ts
//
// C-396 AC-2: category pages render from the static index without touching
// Postgres.
//
// The load fetches the small root index (to discover split-shard ids) plus
// ONLY the requested category's shards — never another category's shards,
// and never the 7 MB client manifest. This is asserted against a local
// fixture origin that records every requested path.
//
// I-8 enforcement (AC-2 watch point): with no D1 binding, the
// awaited part of the load completes and the streamed stats promise resolves
// to null — the page still renders completely, with stats absent.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { CatalogAssetEntry, CatalogIndexRoot, CatalogIndexShard } from '@aikami/schemas';

// ---------------------------------------------------------------------------
// Fixture origin — a tiny local HTTP server that records requested paths
// ---------------------------------------------------------------------------

const requestedPaths: string[] = [];
let origin: { url: string; stop: () => void } | undefined;

const makeEntry = (tag: string, category: string, subcategory: string, extra?: object) =>
  ({
    tag,
    hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    sizeBytes: 1024,
    category,
    subcategory,
    ext: '.webp',
    licenses: ['CC-BY-SA 3.0', 'GPL 3.0'],
    authors: ['Fixture Author'],
    sourceUrls: ['https://example.com/credits'],
    ...extra,
  }) as CatalogAssetEntry;

const buildRoot = (originUrl: string): CatalogIndexRoot => ({
  schemaVersion: 1,
  publishedAt: '2026-08-15T00:00:00.000Z',
  originUrl,
  totalCount: 3,
  categories: [
    { id: 'lpc', count: 2 },
    { id: 'music', count: 1 },
  ],
});

const buildLpcShard = (originUrl: string): CatalogIndexShard => ({
  schemaVersion: 1,
  publishedAt: '2026-08-15T00:00:00.000Z',
  originUrl,
  id: 'lpc',
  category: 'lpc',
  entries: [
    makeEntry('lpc:hat:magic:celestial_adult:thrust', 'lpc', 'hat/magic', {
      thumbnailHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
    makeEntry('lpc:hat:magic:celestial_adult:idle', 'lpc', 'hat/magic'),
  ],
});

const buildMusicShard = (originUrl: string): CatalogIndexShard => ({
  schemaVersion: 1,
  publishedAt: '2026-08-15T00:00:00.000Z',
  originUrl,
  id: 'music',
  category: 'music',
  entries: [
    {
      tag: 'music:exploration:bgm_explore',
      hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      sizeBytes: 2048,
      category: 'music',
      ext: '.webm',
      licenses: ['MIT'],
      authors: ['Aikami Studio'],
      sourceUrls: [],
    },
  ],
});

beforeAll(async () => {
  const server: { url: URL; port: number | undefined; stop: (hard?: boolean) => void } = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requestedPaths.push(url.pathname);
      const originUrl = `http://127.0.0.1:${server.port}`;
      if (url.pathname === '/index/v1/catalog.json') {
        return Response.json(buildRoot(originUrl));
      }
      if (url.pathname === '/index/v1/lpc.json') {
        return Response.json(buildLpcShard(originUrl));
      }
      if (url.pathname === '/index/v1/music.json') {
        return Response.json(buildMusicShard(originUrl));
      }
      if (url.pathname === '/manifest.json') {
        // The 7 MB client boot manifest must NEVER be fetched by a category load.
        return Response.json({ huge: true });
      }
      return new Response('not found', { status: 404 });
    },
  });
  origin = { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
});

afterAll(() => {
  origin?.stop();
});

// ---------------------------------------------------------------------------
// Env mocking — CATALOG_ORIGIN_URL → fixture origin
// ---------------------------------------------------------------------------

const setEnv = (options: { catalogOrigin?: string }): void => {
  mock.module('$app/env/private', () => ({
    // biome-ignore lint/style/useNamingConvention: env keys are SCREAMING_SNAKE_CASE literals by platform convention
    CATALOG_ORIGIN_URL: options.catalogOrigin,
    __esModule: true,
  }));
};

describe('category load — C-396 AC-2 (static index, no Postgres)', () => {
  beforeEach(async () => {
    requestedPaths.length = 0;
    setEnv({ catalogOrigin: origin?.url });
    // Each test starts with an empty document cache — a stale cached
    // root/shard from a previous test (or its fixture server) must never
    // leak into the next one.
    const { clearCatalogIndexCache } = await import('$lib/server/catalog/catalog_index.ts');
    clearCatalogIndexCache();
  });

  test('fetches the root index plus ONLY the requested category shards', async () => {
    const { getCategoryEntries } = await import('$lib/server/catalog/catalog_index.ts');

    const result = await getCategoryEntries('lpc');

    expect(result).toBeDefined();
    expect(result?.entries).toHaveLength(2);
    expect(result?.entries.map((entry) => entry.tag).sort()).toEqual([
      'lpc:hat:magic:celestial_adult:idle',
      'lpc:hat:magic:celestial_adult:thrust',
    ]);
    // AC-2 watch point: the release pointer (absent here → legacy path), the
    // root (to discover shard ids) + only that category's shards. Never
    // music.json, never another category, never manifest.json.
    expect(requestedPaths.sort()).toEqual([
      '/index/v1/catalog.json',
      '/index/v1/lpc.json',
      '/index/v1/release.json',
    ]);
    expect(requestedPaths).not.toContain('/index/v1/music.json');
    expect(requestedPaths).not.toContain('/manifest.json');
  });

  test('split-shard categories merge every `<category>__*` shard', async () => {
    // Add a split shard to the fixture and assert the discovery logic merges it.
    const server: { url: URL; port: number | undefined; stop: (hard?: boolean) => void } =
      Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          requestedPaths.push(url.pathname);
          const originUrl = `http://127.0.0.1:${server.port}`;
          if (url.pathname === '/index/v1/catalog.json') {
            return Response.json({
              schemaVersion: 1,
              publishedAt: '2026-08-15T00:00:00.000Z',
              originUrl,
              totalCount: 3,
              categories: [
                { id: 'lpc__hat-magic', count: 1 },
                { id: 'lpc__body', count: 1 },
                { id: 'lpcx', count: 1 },
                { id: 'music', count: 1 },
              ],
            });
          }
          if (url.pathname === '/index/v1/lpc__hat-magic.json') {
            return Response.json({
              schemaVersion: 1,
              publishedAt: '2026-08-15T00:00:00.000Z',
              originUrl,
              id: 'lpc__hat-magic',
              category: 'lpc',
              entries: [makeEntry('lpc:hat:magic:celestial_adult:thrust', 'lpc', 'hat/magic')],
            });
          }
          if (url.pathname === '/index/v1/lpc__body.json') {
            return Response.json({
              schemaVersion: 1,
              publishedAt: '2026-08-15T00:00:00.000Z',
              originUrl,
              id: 'lpc__body',
              category: 'lpc',
              entries: [makeEntry('lpc:body:body:male_adult:walk', 'lpc', 'body/body')],
            });
          }
          if (url.pathname === '/index/v1/lpcx.json') {
            return Response.json({
              schemaVersion: 1,
              publishedAt: '2026-08-15T00:00:00.000Z',
              originUrl,
              id: 'lpcx',
              category: 'lpc',
              entries: [makeEntry('lpcx:test:asset', 'lpc', 'test')],
            });
          }
          return new Response('not found', { status: 404 });
        },
      });

    try {
      setEnv({ catalogOrigin: `http://127.0.0.1:${server.port}` });
      const { getCategoryEntries } = await import('$lib/server/catalog/catalog_index.ts');
      const result = await getCategoryEntries('lpc');
      expect(result?.entries).toHaveLength(2);
      expect(requestedPaths.sort()).toEqual([
        '/index/v1/catalog.json',
        '/index/v1/lpc__body.json',
        '/index/v1/lpc__hat-magic.json',
        '/index/v1/release.json',
      ]);
      // Negative assertion: the lpcx sibling shard is NEVER fetched when
      // loading lpc — prefix-similar ids must not match `<category>__`.
      expect(requestedPaths).not.toContain('/index/v1/lpcx.json');
    } finally {
      server.stop(true);
      requestedPaths.length = 0;
      setEnv({ catalogOrigin: origin?.url });
    }
  });

  test('unknown category → getCategoryEntries returns undefined (load 404s)', async () => {
    const { getCategoryEntries } = await import('$lib/server/catalog/catalog_index.ts');
    const result = await getCategoryEntries('backgrounds');
    expect(result).toBeUndefined();
  });

  test('catalog index unreachable → typed error, load maps to explicit error state (never a 500)', async () => {
    setEnv({ catalogOrigin: 'http://127.0.0.1:1' });
    const { CatalogIndexUnavailableError, fetchRootIndex } = await import(
      '$lib/server/catalog/catalog_index.ts'
    );
    await expect(fetchRootIndex()).rejects.toBeInstanceOf(CatalogIndexUnavailableError);
  });

  test('no D1 binding → the page data still carries entries and stats resolves to null', async () => {
    const { load } = await import('../../../../routes/(public)/catalog/[category]/+page.server.ts');
    const setHeaders = mock(() => {});
    const depends = mock(() => {});
    const data = await load({
      params: { category: 'lpc' },
      setHeaders,
      depends,
    } as never);

    expect(data).toBeDefined();
    const pageData = data as { category: string; entries: unknown[]; stats: Promise<unknown> };
    expect(pageData.category).toBe('lpc');
    expect(pageData.entries).toHaveLength(2);
    expect(setHeaders).toHaveBeenCalled();
    // The stats promise is STREAMED — resolving it must yield null with the
    // database unconfigured, and it must never reject (AC-4 watch point).
    await expect(pageData.stats).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Release-pointer resolution (C-496) — the canonical path
// ---------------------------------------------------------------------------

/** SHA-256 hex of a UTF-8 string, matching the publisher's content address. */
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const jsonResponse = (body: string): Response =>
  new Response(body, { headers: { 'content-type': 'application/json' } });

/**
 * Fixture origin serving a release pointer plus its immutable root/shard
 * revisions, with every mutable alias deliberately 404. `corruptRootHash`
 * flips the pointer's `rootHash` so an integrity failure is observable.
 */
const startPointedOrigin = (
  options: { corruptRootHash?: boolean } = {},
): {
  url: string;
  stop: () => void;
} => {
  const server: { port: number | undefined; stop: (hard?: boolean) => void } = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requestedPaths.push(url.pathname);
      const originUrl = `http://127.0.0.1:${server.port}`;
      const rootJson = JSON.stringify(buildRoot(originUrl));
      const lpcJson = JSON.stringify(buildLpcShard(originUrl));
      const rootHash = sha256(rootJson);
      const lpcHash = sha256(lpcJson);
      const pointerJson = JSON.stringify({
        schemaVersion: 'catalog.release.v1',
        releaseId: '2026-09-22T23:58:14.101Z',
        rootKey: `index/v1/revisions/${rootHash}/catalog.json`,
        rootHash: options.corruptRootHash ? sha256('not-the-root') : rootHash,
        shards: [{ category: 'lpc', key: `index/v1/revisions/${lpcHash}/lpc.json`, hash: lpcHash }],
        dependencies: [{ key: `seed/${sha256('seed')}/asset_seed.json`, hash: sha256('seed') }],
        publishedAt: '2026-09-22T23:58:14.101Z',
      });

      if (url.pathname === '/index/v1/release.json') {
        return jsonResponse(pointerJson);
      }
      if (url.pathname === `/index/v1/revisions/${rootHash}/catalog.json`) {
        return jsonResponse(rootJson);
      }
      if (url.pathname === `/index/v1/revisions/${lpcHash}/lpc.json`) {
        return jsonResponse(lpcJson);
      }
      return new Response('not found', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
};

describe('release-pointer resolution — C-496 (canonical, alias-free)', () => {
  beforeEach(async () => {
    requestedPaths.length = 0;
    const { clearCatalogIndexCache } = await import('$lib/server/catalog/catalog_index.ts');
    clearCatalogIndexCache();
  });

  test('category load fetches the pinned shard revision and never a mutable alias', async () => {
    const pointed = startPointedOrigin();
    try {
      setEnv({ catalogOrigin: pointed.url });
      const { getCategoryEntries } = await import('$lib/server/catalog/catalog_index.ts');

      const result = await getCategoryEntries('lpc');

      expect(result?.entries).toHaveLength(2);
      // The pointer + exactly this category's pinned shard revision. Nothing else.
      expect(requestedPaths).toHaveLength(2);
      expect(requestedPaths[0]).toBe('/index/v1/release.json');
      expect(requestedPaths[1]).toStartWith('/index/v1/revisions/');
      expect(requestedPaths[1]).toEndWith('/lpc.json');
      // The mutable aliases MUST NOT be read when a pointer exists.
      expect(requestedPaths).not.toContain('/index/v1/catalog.json');
      expect(requestedPaths).not.toContain('/index/v1/lpc.json');
    } finally {
      pointed.stop();
      requestedPaths.length = 0;
    }
  });

  test('root load fetches the pinned root revision, never the catalog.json alias', async () => {
    const pointed = startPointedOrigin();
    try {
      setEnv({ catalogOrigin: pointed.url });
      const { fetchRootIndex } = await import('$lib/server/catalog/catalog_index.ts');

      const root = await fetchRootIndex();

      expect(root.totalCount).toBe(3);
      expect(requestedPaths).toHaveLength(2);
      expect(requestedPaths[0]).toBe('/index/v1/release.json');
      expect(requestedPaths[1]).toStartWith('/index/v1/revisions/');
      expect(requestedPaths[1]).toEndWith('/catalog.json');
      expect(requestedPaths).not.toContain('/index/v1/catalog.json');
    } finally {
      pointed.stop();
      requestedPaths.length = 0;
    }
  });

  test('a pinned revision whose bytes do not match the pointer hash → typed error', async () => {
    const pointed = startPointedOrigin({ corruptRootHash: true });
    try {
      setEnv({ catalogOrigin: pointed.url });
      const { CatalogIndexUnavailableError, fetchRootIndex } = await import(
        '$lib/server/catalog/catalog_index.ts'
      );

      await expect(fetchRootIndex()).rejects.toBeInstanceOf(CatalogIndexUnavailableError);
    } finally {
      pointed.stop();
      requestedPaths.length = 0;
    }
  });
});
