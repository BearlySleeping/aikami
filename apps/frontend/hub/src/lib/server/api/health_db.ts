// apps/frontend/hub/src/lib/server/api/health_db.ts
//
// C-436 AC-4: GET /api/health/db — D1 binding reachability.
// Ported from the pg.Pool + NEON_DATABASE_URL path (C-394 AC-1).
//
// This is the ONE legitimate exception to I-8 (no DB queries in the render
// path): reporting database reachability is its entire purpose.
//
// Behaviour contract:
//   • Unconfigured (DB binding absent) → `{ status: 'unconfigured' }`
//     — no 500, no crash at module load. This is also the self-hosting path
//     (D-14) and the degraded mode.
//   • Unreachable → `{ status: 'unreachable' }` — the hub keeps serving
//     static-index-backed pages.
//   • Healthy → `{ status: 'ok', roundTripMs }`.
//
// Security: never emits a credential, a connection string, or an internal
// identifier. D1 has no hostname to report (unlike the old Postgres path).
//
// The D1 binding is injected per-request (see +server.ts) — a missing binding
// degrades to unconfigured, never a 500 and never a boot failure.

import { drizzle } from 'drizzle-orm/d1';
import { logger } from '$logger';

type HealthDbEnv = {
  // biome-ignore lint/style/useNamingConvention: Cloudflare D1 binding name
  DB: import('@cloudflare/workers-types').D1Database;
};

let _env: HealthDbEnv | undefined;

/** Inject the per-request Worker env (called by the catch-all route). */
export const setHealthDbEnv = (envValue: HealthDbEnv | undefined): void => {
  _env = envValue;
};

/** The injected env, or undefined when D1 is unavailable. */
export const getHealthDbEnv = (): HealthDbEnv | undefined => _env;

export type DbHealthOk = {
  status: 'ok';
  roundTripMs: number;
};

export type DbHealthDegraded = { status: 'unconfigured' } | { status: 'unreachable' };

export type DbHealthResponse = DbHealthOk | DbHealthDegraded;

/**
 * Probe D1 with a simple query and measure the round trip.
 *
 * D1 has no server_version to report (unlike Postgres), so we use
 * `SELECT 1` as a liveness probe.
 */
const probeD1 = async (
  db: ReturnType<typeof drizzle>,
): Promise<{
  roundTripMs: number;
}> => {
  const startedAt = performance.now();
  await db.run('SELECT 1');
  const roundTripMs = Math.round(performance.now() - startedAt);
  return { roundTripMs };
};

export const handleDbHealth = async (): Promise<DbHealthResponse> => {
  const env = _env;
  if (!env?.DB) {
    logger.debug('/api/health/db: unconfigured (DB binding absent)');
    return { status: 'unconfigured' };
  }

  logger.debug('/api/health/db: probing D1');
  const db = drizzle(env.DB);

  try {
    const { roundTripMs } = await probeD1(db);
    logger.debug('/api/health/db: ok', { roundTripMs });
    return { status: 'ok', roundTripMs };
  } catch (error) {
    // The binding exists but queries fail — report unreachable rather than
    // letting the error escape as a 500.
    const code = (error as { code?: string }).code ?? 'unknown';
    logger.error('/api/health/db: unreachable', { code });
    return { status: 'unreachable' };
  }
};
