// apps/frontend/hub/src/lib/server/api/tests/catalog_stats.test.ts
//
// C-436 AC-3: catalog stats served from D1, degradation intact.
//
// Tests three states of the D1 binding: healthy (returns packCount),
// throwing (returns null, logged at warn), and absent (returns null,
// logged at warn). Verifies the streamed-promise hazard is handled:
// loadPackStats() never rejects.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createMockD1 as createPreparedMockD1 } from './mock_d1.ts';

// ── Mock D1 helpers ─────────────────────────────────────────────────────

const createMockD1 = (shouldThrow: boolean = false): unknown =>
  createPreparedMockD1({
    execute: async () => {
      if (shouldThrow) {
        throw new Error('D1 query failed');
      }
      return { rows: [{ 'count(*)': 0 }] };
    },
  });

type TestCatalogStatsEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: unknown;
};

let setCatalogStatsEnv: (env: TestCatalogStatsEnv | undefined) => void;

beforeAll(async () => {
  const mod = await import('../catalog_stats.ts');
  setCatalogStatsEnv = mod.setCatalogStatsEnv;
});

afterAll(() => {
  setCatalogStatsEnv(undefined);
});

beforeEach(() => {
  setCatalogStatsEnv(undefined);
});

describe('catalog stats — C-436 AC-3 (D1, degradation intact)', () => {
  test('unconfigured (DB binding absent) → resolves null, never rejects', async () => {
    const { loadPackStats } = await import('../catalog_stats.ts');
    await expect(loadPackStats()).resolves.toBeNull();
  });

  test('throwing D1 binding → resolves null, never rejects', async () => {
    // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
    setCatalogStatsEnv({ DB: createMockD1(true) });
    const { loadPackStats } = await import('../catalog_stats.ts');
    await expect(loadPackStats()).resolves.toBeNull();
  });

  test('healthy D1 binding → returns packCount shape', async () => {
    // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
    setCatalogStatsEnv({ DB: createMockD1(false) });
    const { loadPackStats } = await import('../catalog_stats.ts');
    const stats = await loadPackStats();
    expect(stats).toEqual(expect.objectContaining({ packCount: expect.any(Number) }));
  });

  test('handleCatalogStats returns null when binding absent', async () => {
    const { handleCatalogStats } = await import('../catalog_stats.ts');
    await expect(handleCatalogStats()).resolves.toBeNull();
  });

  test('handleCatalogStats returns stats when binding present', async () => {
    // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
    setCatalogStatsEnv({ DB: createMockD1(false) });
    const { handleCatalogStats } = await import('../catalog_stats.ts');
    const stats = await handleCatalogStats();
    expect(stats).toEqual(expect.objectContaining({ packCount: expect.any(Number) }));
  });
});
