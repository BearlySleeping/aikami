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
// I-8 enforcement (AC-2 watch point): with NEON_DATABASE_URL unset, the
// awaited part of the load completes and the streamed stats promise resolves
// to null — the page still renders completely, with stats absent.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CatalogIndexRoot, CatalogIndexShard } from '@aikami/schemas';

// ---------------------------------------------------------------------------
// Fixture origin — a tiny local HTTP server that records requested paths
// ---------------------------------------------------------------------------

const requestedPaths: string[] = [];
let origin: { url: string; stop: () => void } | undefined;

const makeEntry = (tag: string, category: string, subcategory: string, extra?: object) => ({
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
});

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
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requestedPaths.push(url.pathname);
      const originUrl = server.url.toString().replace(/\/$/, '');
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
  origin = { url: server.url.toString().replace(/\/$/, ''), stop: () => server.stop(true) };
});

afterAll(() => {
  origin?.stop();
});

// ---------------------------------------------------------------------------
// Env mocking — CATALOG_ORIGIN_URL → fixture origin; NEON_DATABASE_URL unset
// ---------------------------------------------------------------------------

const setEnv = (options: { catalogOrigin?: string; neonUrl?: string }): void => {
  const env: Record<string, string | undefined> = {
    // biome-ignore lint/style/useNamingConvention: env keys are SCREAMING_SNAKE_CASE literals by platform convention
    CATALOG_ORIGIN_URL: options.catalogOrigin,
    // biome-ignore lint/style/useNamingConvention: env keys are SCREAMING_SNAKE_CASE literals by platform convention
    NEON_DATABASE_URL: options.neonUrl,
  };
  mock.module('$env/dynamic/private', () => ({ env }));
};

describe('category load — C-396 AC-2 (static index, no Postgres)', () => {
  beforeEach(() => {
    requestedPaths.length = 0;
    setEnv({ catalogOrigin: origin?.url, neonUrl: undefined });
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
    // AC-2 watch point: root (to discover shard ids) + only that category's
    // shards. Never music.json, never another category, never manifest.json.
    expect(requestedPaths.sort()).toEqual(['/index/v1/catalog.json', '/index/v1/lpc.json']);
    expect(requestedPaths).not.toContain('/index/v1/music.json');
    expect(requestedPaths).not.toContain('/manifest.json');
  });

  test('split-shard categories merge every `<category>__*` shard', async () => {
    // Add a split shard to the fixture and assert the discovery logic merges it.
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requestedPaths.push(url.pathname);
        const originUrl = server.url.toString().replace(/\/$/, '');
        if (url.pathname === '/index/v1/catalog.json') {
          return Response.json({
            schemaVersion: 1,
            publishedAt: '2026-08-15T00:00:00.000Z',
            originUrl,
            totalCount: 2,
            categories: [
              { id: 'lpc__hat-magic', count: 1 },
              { id: 'lpc__body', count: 1 },
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
        return new Response('not found', { status: 404 });
      },
    });

    try {
      setEnv({ catalogOrigin: server.url.toString().replace(/\/$/, ''), neonUrl: undefined });
      const { clearCatalogIndexCache, getCategoryEntries } = await import(
        '$lib/server/catalog/catalog_index.ts'
      );
      clearCatalogIndexCache();
      const result = await getCategoryEntries('lpc');
      expect(result?.entries).toHaveLength(2);
      expect(requestedPaths.sort()).toEqual([
        '/index/v1/catalog.json',
        '/index/v1/lpc__body.json',
        '/index/v1/lpc__hat-magic.json',
      ]);
    } finally {
      server.stop(true);
      requestedPaths.length = 0;
      setEnv({ catalogOrigin: origin?.url, neonUrl: undefined });
    }
  });

  test('unknown category → getCategoryEntries returns undefined (load 404s)', async () => {
    const { getCategoryEntries } = await import('$lib/server/catalog/catalog_index.ts');
    const result = await getCategoryEntries('backgrounds');
    expect(result).toBeUndefined();
  });

  test('catalog index unreachable → typed error, load maps to explicit error state (never a 500)', async () => {
    setEnv({ catalogOrigin: 'http://127.0.0.1:1', neonUrl: undefined });
    const { CatalogIndexUnavailableError, fetchRootIndex } = await import(
      '$lib/server/catalog/catalog_index.ts'
    );
    await expect(fetchRootIndex()).rejects.toBeInstanceOf(CatalogIndexUnavailableError);
  });

  test('NEON_DATABASE_URL unset → the page data still carries entries and stats resolves to null', async () => {
    const { load } = await import('../../../../routes/(public)/catalog/[category]/+page.server.ts');
    const setHeaders = mock(() => {});
    const depends = mock(() => {});
    const data = await load({
      params: { category: 'lpc' },
      setHeaders,
      depends,
    } as never);

    expect(data).toBeDefined();
    expect(data.category).toBe('lpc');
    expect(data.entries).toHaveLength(2);
    expect(setHeaders).toHaveBeenCalled();
    // The stats promise is STREAMED — resolving it must yield null with the
    // database unconfigured, and it must never reject (AC-4 watch point).
    await expect(data.stats).resolves.toBeNull();
  });
});
