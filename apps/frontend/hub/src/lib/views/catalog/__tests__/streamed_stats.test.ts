// apps/frontend/hub/src/lib/views/catalog/__tests__/streamed_stats.test.ts
// biome-ignore-all lint/suspicious/noExplicitAny: Bun.Server generic type
//
// C-436: D1-backed stats stream in and never block first paint.
// Ported from the Postgres-backed path (C-396 AC-4).
//
// The catalog loads return the stats as a STREAMED promise — resolving it
// must populate (zero counts are a valid populate — C-394's tables are empty
// until C-398/C-399 write rows) or degrade to null with a warn log. It must
// NEVER reject: an unhandled rejection in a streamed promise breaks the
// response after headers are sent (AC-4 watch point).

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Minimal fixture origin so the category load has an index to read.
let origin: { url: string; stop: () => void } | undefined;

const setEnv = (options: { catalogOrigin?: string }): void => {
  mock.module('$app/env/private', () => ({
    // biome-ignore lint/complexity/useLiteralKeys: env keys are SCREAMING_SNAKE_CASE literals by platform convention
    ['CATALOG_ORIGIN_URL']: options.catalogOrigin ?? origin?.url,
    __esModule: true,
  }));
};

beforeAll(async () => {
  const server: Bun.Server<any> = Bun.serve({
    port: 0,
    fetch(request: Request): Response | Promise<Response> {
      const url = new URL(request.url);
      const originUrl: string = server.url.toString().replace(/\/$/, '');
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

describe('streamed stats — C-436 (never blocks first paint)', () => {
  beforeEach(async () => {
    setEnv({});
  });

  test('unconfigured (no D1 binding) → resolves null, never rejects', async () => {
    const { loadPackStats } = await import('$lib/server/api/catalog_stats.ts');
    await expect(loadPackStats()).resolves.toBeNull();
  });

  test('the category load stream never rejects — .catch(() => null) guards the page data', async () => {
    const { load } = await import('../../../../routes/(public)/catalog/[category]/+page.server.ts');
    const data = (await load({
      params: { category: 'lpc' },
      setHeaders: mock(() => {}),
      depends: mock(() => {}),
    } as never)) as Awaited<ReturnType<typeof load>>;

    if (!data) {
      throw new Error('Expected category load data');
    }
    expect(data.category).toBe('lpc');
    await expect(data.stats).resolves.toBeNull();
  });

  test('the detail route load stream never rejects — .catch(() => null) guards the page data too', async () => {
    const { load } = await import(
      '../../../../routes/(public)/catalog/[category]/[tag]/+page.server.ts'
    );
    const data = (await load({
      params: { category: 'lpc', tag: 'lpc:hat:magic:celestial_adult:thrust' },
      setHeaders: mock(() => {}),
      depends: mock(() => {}),
    } as never)) as Awaited<ReturnType<typeof load>>;

    if (!data) {
      throw new Error('Expected asset load data');
    }
    expect(data.category).toBe('lpc');
    expect(data.entry.tag).toBe('lpc:hat:magic:celestial_adult:thrust');
    await expect(data.stats).resolves.toBeNull();
  });
});
