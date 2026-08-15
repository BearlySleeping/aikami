// apps/frontend/hub/src/lib/server/api/catalog_stats.ts
//
// C-396 AC-4: GET /api/catalog/stats — streamed, Postgres-backed catalog
// stats (placeholder aggregates; zero until C-398/C-399 write rows).
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
// The pool is created LAZILY on first query (connection.ts) — a database
// outage cannot prevent the hub from booting or serving index-backed pages.
//
// 🔴 I-1: this module lives under `src/lib/server/` — never import it from a
// `.svelte` file or the client bundle.

import {
  type CatalogRepositories,
  createCatalogRepositories,
  getPool,
  getPoolIfExists,
} from '@aikami/backend-database';
import type { AssetStats, CategoryStats } from '@aikami/schemas';
import { env } from '$env/dynamic/private';
import { logger } from '$logger';

/** Response to the browser — `null` means "unreachable/unconfigured". */
export type CatalogStatsResponse = (CategoryStats | AssetStats) | null;

let _repositories: CatalogRepositories | undefined;

/** Lazily build the C-394 repositories over the shared pool. */
const getRepositories = (): CatalogRepositories => {
  if (!_repositories) {
    const pool = getPool({ connectionString: env.NEON_DATABASE_URL ?? '' });
    _repositories = createCatalogRepositories(pool);
  }
  return _repositories;
};

/**
 * Resolve the placeholder category/asset stats.
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
export const loadPackStats = async (): Promise<CategoryStats | AssetStats | null> => {
  const connectionString = env.NEON_DATABASE_URL;
  if (!connectionString) {
    logger.warn('catalog:stats unconfigured (NEON_DATABASE_URL absent) — stats absent');
    return null;
  }

  try {
    const repositories = getRepositories();
    const packCount = await repositories.packs.countPublic();
    return { packCount };
  } catch (error) {
    // Expected and degraded — warn, never error (AC-4).
    logger.warn('catalog:stats unavailable — browse continues without stats', { error });
    return null;
  }
};

/**
 * Elysia handler for GET /api/catalog/stats.
 *
 * Responds 200 with `{ packCount }` when the database is reachable, and a
 * structured degraded response otherwise — the endpoint itself must not 500
 * (Quality Requirements: "Neither is a 500").
 */
export const handleCatalogStats = async (): Promise<CatalogStatsResponse> => {
  const connectionString = env.NEON_DATABASE_URL;
  if (!connectionString) {
    return null;
  }
  return await loadPackStats();
};

/** Test hook: whether the repository layer has been built (lazy invariant). */
export const hasStatsRepositories = (): boolean =>
  getPoolIfExists() !== undefined && _repositories !== undefined;

/**
 * Test hook: drop the cached repository layer so a later test builds a
 * fresh one over the (re-created) pool. Tests call this after closePool().
 */
export const resetStatsRepositories = (): void => {
  _repositories = undefined;
};
