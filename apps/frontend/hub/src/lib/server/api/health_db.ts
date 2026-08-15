// apps/frontend/hub/src/lib/server/api/health_db.ts
//
// C-394 AC-1: GET /api/health/db — database reachability + version.
//
// This is the ONE legitimate exception to I-8 (no DB queries in the render
// path): reporting database reachability is its entire purpose.
//
// Behaviour contract:
//   • Unconfigured (NEON_DATABASE_URL absent) → `{ status: 'unconfigured' }`
//     — no 500, no crash at module load. This is also the self-hosting path
//     (D-14) and the degraded mode when the GSM secret is missing.
//   • Unreachable → `{ status: 'unreachable', host }` — the hub keeps
//     serving static-index-backed pages.
//   • Healthy → `{ status: 'ok', databaseVersion, host, roundTripMs }`.
//
// Security: hostname only — never the connection string, never credentials.
// The pool is created LAZILY on first query (never at module import), so a
// database outage cannot prevent the hub from booting.

import { describeConnectionString, getPool, getPoolIfExists } from '@aikami/backend-database';
import { env } from '$env/dynamic/private';
import { logger } from '$logger';

export type DbHealthOk = {
  status: 'ok';
  databaseVersion: string;
  host: string;
  roundTripMs: number;
};

export type DbHealthDegraded =
  | { status: 'unconfigured' }
  | { status: 'unreachable'; host?: string };

export type DbHealthResponse = DbHealthOk | DbHealthDegraded;

/**
 * Query the server version and measure the round trip.
 *
 * `SHOW server_version` returns the engine version only (e.g. "18.4") —
 * exactly what AC-1 needs to assert 18.x without leaking connection
 * metadata. The pool is created on first use; a healthy response proves
 * the runtime connection string actually resolves.
 */
const queryVersion = async (
  connectionString: string,
): Promise<{
  version: string;
  roundTripMs: number;
}> => {
  const startedAt = performance.now();
  const pool = getPool({ connectionString });
  // `AS "serverVersion"` keeps the pg row key camelCase (biome naming rule).
  const result = await pool.query<{ serverVersion: string }>(
    'SELECT current_setting(\'server_version\') AS "serverVersion"',
  );
  const roundTripMs = Math.round(performance.now() - startedAt);
  return { version: result.rows[0]?.serverVersion ?? 'unknown', roundTripMs };
};

export const handleDbHealth = async (): Promise<DbHealthResponse> => {
  const connectionString = env.NEON_DATABASE_URL;
  if (!connectionString) {
    logger.debug('/api/health/db: unconfigured (NEON_DATABASE_URL absent)');
    return { status: 'unconfigured' };
  }

  const { host, isPooled } = describeConnectionString(connectionString);
  logger.debug('/api/health/db: probing', { host, isPooled });

  try {
    const { version, roundTripMs } = await queryVersion(connectionString);
    logger.debug('/api/health/db: ok', { host, version, roundTripMs });
    return { status: 'ok', databaseVersion: version, host, roundTripMs };
  } catch (error) {
    // The pool may already exist from a prior request — report unreachable
    // rather than letting the error escape as a 500.
    const code = (error as { code?: string }).code ?? 'unknown';
    logger.error('/api/health/db: unreachable', { host, code });
    return { status: 'unreachable', host };
  }
};

/**
 * Internal: exposes whether a pool exists — used by tests to assert the
 * lazy-creation invariant (no connection until the first query).
 */
export const hasPool = (): boolean => getPoolIfExists() !== undefined;
