// apps/frontend/hub/src/lib/views/catalog/__tests__/streamed_stats.test.ts
//
// C-396 AC-4: Postgres-backed stats stream in and never block first paint.
//
// The catalog loads return the stats as a STREAMED promise — resolving it
// must populate (zero counts are a valid populate — C-394's tables are empty
// until C-398/C-399 write rows) or degrade to null with a warn log. It must
// NEVER reject: an unhandled rejection in a streamed promise breaks the
// response after headers are sent (AC-4 watch point).

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { closePool } from '@aikami/backend-database';

const LOCAL_URL = 'postgresql://localhost:5433/aikami_dev?sslmode=disable';
const DEAD_URL = 'postgresql://localhost:59999/aikami_dev?sslmode=disable';

/**
 * True when local PostgreSQL answers on 5433 — the reachable-database test
 * SKIPS when it is not running (same convention as the C-394 suites), so a
 * machine without postgres still gets a green suite.
 */
const isDbReachable = async (): Promise<boolean> => {
  const { connect } = await import('node:net');
  return await new Promise((resolve) => {
    const socket = connect(5433, 'localhost');
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
};

const dbReachable = await isDbReachable();

// Minimal fixture origin so the category load has an index to read.
let origin: { url: string; stop: () => void } | undefined;

const setEnv = (options: { neonUrl: string | undefined; catalogOrigin?: string }): void => {
  mock.module('$env/dynamic/private', () => ({
    env: {
      // biome-ignore lint/complexity/useLiteralKeys: env keys are SCREAMING_SNAKE_CASE literals by platform convention
      ['NEON_DATABASE_URL']: options.neonUrl,
      // biome-ignore lint/complexity/useLiteralKeys: env keys are SCREAMING_SNAKE_CASE literals by platform convention
      ['CATALOG_ORIGIN_URL']: options.catalogOrigin ?? origin?.url,
    } as Record<string, string | undefined>,
  }));
};

beforeAll(async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const originUrl = server.url.toString().replace(/\/$/, '');
      if (url.pathname === '/index/v1/catalog.json') {
        return Response.json({
          schemaVersion: 1,
          publishedAt: '2026-08-15T00:00:00.000Z',
          originUrl,
          totalCount: 1,
          categories: [{ id: 'lpc', count: 1 }],
        });
      }
      if (url.pathname === '/index/v1/lpc.json') {
        return Response.json({
          schemaVersion: 1,
          publishedAt: '2026-08-15T00:00:00.000Z',
          originUrl,
          id: 'lpc',
          category: 'lpc',
          entries: [
            {
              tag: 'lpc:hat:magic:celestial_adult:thrust',
              hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
              sizeBytes: 1024,
              category: 'lpc',
              subcategory: 'hat/magic',
              ext: '.webp',
              licenses: ['CC-BY-SA 3.0'],
              authors: ['Fixture Author'],
              sourceUrls: [],
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  origin = { url: server.url.toString().replace(/\/$/, ''), stop: () => server.stop(true) };
});

afterAll(() => {
  origin?.stop();
});

describe('streamed stats — C-396 AC-4 (never blocks first paint)', () => {
  beforeEach(async () => {
    await closePool();
    setEnv({ neonUrl: undefined });
    // Drop the cached repository layer so each test rebuilds it over the
    // freshly-created pool (closePool() resets the pool module only).
    const { resetStatsRepositories } = await import('$lib/server/api/catalog_stats.ts');
    resetStatsRepositories();
  });

  test('unconfigured (NEON_DATABASE_URL absent) → resolves null, never rejects', async () => {
    const { loadPackStats } = await import('$lib/server/api/catalog_stats.ts');
    await expect(loadPackStats()).resolves.toBeNull();
  });

  test('unreachable database host → resolves null, never rejects', async () => {
    setEnv({ neonUrl: DEAD_URL });
    const { loadPackStats } = await import('$lib/server/api/catalog_stats.ts');
    await expect(loadPackStats()).resolves.toBeNull();
  });

  test.skipIf(!dbReachable)(
    'reachable database → pack-derived count shape (zero is a valid populate)',
    async () => {
      setEnv({ neonUrl: LOCAL_URL });
      const { loadPackStats } = await import('$lib/server/api/catalog_stats.ts');
      const stats = await loadPackStats();
      // The shape contract, not a hard zero: C-394's tables exist (migrations
      // applied) but may already hold rows — what must hold is the packCount
      // shape, so this test survives later contracts that write rows.
      expect(stats).toEqual(expect.objectContaining({ packCount: expect.any(Number) }));
    },
  );

  test('the category load stream never rejects — .catch(() => null) guards the page data', async () => {
    setEnv({ neonUrl: DEAD_URL });
    const { load } = await import('../../../../routes/(public)/catalog/[category]/+page.server.ts');
    const data = await load({
      params: { category: 'lpc' },
      setHeaders: mock(() => {}),
      depends: mock(() => {}),
    } as never);

    expect(data.category).toBe('lpc');
    await expect(data.stats).resolves.toBeNull();
  });

  test('the detail route load stream never rejects — .catch(() => null) guards the page data too', async () => {
    setEnv({ neonUrl: DEAD_URL });
    const { load } = await import(
      '../../../../routes/(public)/catalog/[category]/[tag]/+page.server.ts'
    );
    const data = await load({
      params: { category: 'lpc', tag: 'lpc:hat:magic:celestial_adult:thrust' },
      setHeaders: mock(() => {}),
      depends: mock(() => {}),
    } as never);

    expect(data.category).toBe('lpc');
    expect(data.entry.tag).toBe('lpc:hat:magic:celestial_adult:thrust');
    await expect(data.stats).resolves.toBeNull();
  });
});
