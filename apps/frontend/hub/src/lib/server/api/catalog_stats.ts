// apps/frontend/hub/src/lib/server/api/catalog_stats.ts
//
// C-436 AC-3: GET /api/catalog/stats — streamed, D1-backed catalog stats
// (placeholder aggregates; zero until C-398/C-399 write rows). Ported from
// the pg.Pool + NEON_DATABASE_URL path (C-396 AC-4).
//
// This is the ONE data-plane query in the catalog render path, and it is
// deliberately never awaited before first paint: the SSR loads return
// `loadPackStats()` as a STREAMED promise (I-8). A database outage must
// degrade to "no stats", not to a broken page:
//
//   • `loadPackStats()` catches every failure and resolves to `null`, and
//     the load functions add an extra `.catch(() => null)` — an unhandled
//     rejection in a streamed promise breaks the response after headers are
//     sent (AC-4 watch point).
//   • Failures are logged at `warn` — expected and degraded, not exceptional
//     (Observability requirement).
//
// The D1 binding is injected per-request (see +server.ts) — a missing binding
// degrades to null, never a 500 and never a boot failure.
//
// 🔴 I-1: this module lives under `src/lib/server/` — never import it from a
// `.svelte` file or the client bundle.

import { packs } from '@aikami/backend-database';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logger } from '$logger';

type CatalogStatsEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
};

let _env: CatalogStatsEnv | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setCatalogStatsEnv = (envValue: CatalogStatsEnv | undefined): void => {
  _env = envValue;
};

/** The injected env, or undefined when D1 is unavailable. */
export const getCatalogStatsEnv = (): CatalogStatsEnv | undefined => _env;

/** Response to the browser — `null` means "unreachable/unconfigured". */
export type CatalogStatsResponse = { packCount: number } | null;

/**
 * Resolve the placeholder category/asset stats from D1.
 *
 * `category`/`tag` are accepted but not yet used for filtering — C-394's
 * packs table has no category or asset-tag column, so the aggregate is the
 * public pack count, identical for every category and asset until C-398/C-399
 * extend the schema (per the contract, these shapes are C-396's contract
 * only).
 *
 * @returns `null` when the database is unconfigured or unreachable — never
 *   throws.
 */
export const loadPackStats = async (): Promise<{ packCount: number } | null> => {
  const env = _env;
  if (!env?.DB) {
    logger.warn('catalog:stats unconfigured (DB binding absent) — stats absent');
    return null;
  }

  try {
    const db = drizzle(env.DB, { schema: { packs } });
    const rows = await db
      .select({ value: count() })
      .from(packs)
      .where(eq(packs.visibility, 'public'));
    const packCount = rows[0]?.value ?? 0;
    return { packCount };
  } catch (error) {
    // Expected and degraded — warn, never error (AC-4). Not cached: the
    // next request probes the database again once it recovers.
    logger.warn('catalog:stats unavailable — browse continues without stats', { error });
    return null;
  }
};

/**
 * Elysia handler for GET /api/catalog/stats.
 *
 * Responds 200 with `{ packCount }` when the database is reachable, and
 * `null` otherwise — the endpoint itself must not 500 (Quality Requirements:
 * "Neither is a 500").
 */
export const handleCatalogStats = async (): Promise<CatalogStatsResponse> => {
  const env = _env;
  if (!env?.DB) {
    return null;
  }
  return await loadPackStats();
};
