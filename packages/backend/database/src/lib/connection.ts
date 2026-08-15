// packages/backend/database/src/lib/connection.ts
//
// C-394: pooled `pg` connection factory for the hub server data plane.
//
// 🔴 The pool is created LAZILY on first use, never at module import — a
// database outage must not prevent the hub from booting or serving pages
// that render from the static index (D-14 / AC-1 degraded mode).
//
// The connection string is resolved here from `DATABASE_URL` — the single
// server-side secret. Production uses Neon's POOLED endpoint (host contains
// "-pooler") with `sslmode=require`; see apps/frontend/hub/.env.*
//
// Security (I-1): this module is the ONLY place the connection string is
// read. It must never be imported from a `.svelte` file or a shared module
// reachable by the client bundle — import the database package only from
// `src/lib/server/` in the hub (enforced by the I-1 bundle guard).

import { Pool, type PoolConfig } from 'pg';
import { logger } from '$logger';

// ── Configuration ───────────────────────────────────────────────────────

/** Environment key holding the pooled connection string. */
export const DATABASE_URL_ENV_KEY = 'NEON_DATABASE_URL';

/** Pool size cap. Neon Free compute is 0.25 CU — a large pool buys nothing. */
export const DEFAULT_POOL_MAX = 5;

/** Conservative statement timeout (ms) so a stalled cross-cloud connection
 *  (GCP europe-west4 → AWS eu-west-2) cannot pin a Cloud Run request. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;

/**
 * Parse a `postgresql://` URL into loggable identity parts.
 *
 * Returns only the host and region hint — never the credentials or the full
 * URL (the health route and logs must not leak the connection string).
 */
export const describeConnectionString = (
  connectionString: string,
): {
  host: string;
  isPooled: boolean;
} => {
  let host = '(unparseable)';
  try {
    const parsed = new URL(connectionString);
    host = parsed.hostname;
  } catch {
    // Leave the fallback host string.
  }
  return {
    host,
    // Neon pooled endpoints are named `*-pooler.*.neon.tech`.
    isPooled: host.includes('-pooler'),
  };
};

// ── Pool state ──────────────────────────────────────────────────────────

let _pool: Pool | undefined;

/**
 * The active pool, or undefined when never created (database unconfigured).
 *
 * Reading this never constructs anything — used by the health route to
 * distinguish "unconfigured" from "unreachable".
 */
export const getPoolIfExists = (): Pool | undefined => _pool;

/**
 * Create (once) and return the shared pool for the given connection string.
 *
 * 🔴 Lazy: no connection is opened until the first `query()`. A module-level
 * `new Pool()` that eagerly connects would turn a database outage into a
 * boot failure.
 */
export const getPool = (options: {
  /** Pooled connection string (Neon `-pooler` host in production). */
  connectionString: string;
  /** Maximum concurrent clients. Defaults to DEFAULT_POOL_MAX. */
  max?: number;
  /** Statement timeout in ms. Defaults to DEFAULT_STATEMENT_TIMEOUT_MS. */
  statementTimeoutMs?: number;
}): Pool => {
  const {
    connectionString,
    max = DEFAULT_POOL_MAX,
    statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS,
  } = options;
  if (_pool) {
    return _pool;
  }

  const { host, isPooled } = describeConnectionString(connectionString);
  logger.debug('database:pool:create', { host, isPooled, max });

  const config: PoolConfig = {
    connectionString,
    max,
    // A stalled cross-cloud connection must never pin a request indefinitely.
    // biome-ignore lint/style/useNamingConvention: pg's PoolConfig key is snake_case by contract.
    statement_timeout: statementTimeoutMs,
    // Idle clients are returned to Neon's pooler promptly; keep them short.
    idleTimeoutMillis: 10_000,
    // Don't spawn connections ahead of demand — Neon Free compute is tiny.
    connectionTimeoutMillis: 5_000,
  };

  _pool = new Pool(config);

  // Log a failed acquire once per identity — the first query after a Neon
  // suspend/resume can fail transiently, and we want the SQLSTATE on the
  // record without crashing the request loop.
  _pool.on('error', (error: Error) => {
    const code = (error as { code?: string }).code ?? 'unknown';
    logger.error('database:pool:error', { code });
  });

  return _pool;
};

/**
 * Close the pool and reset the module state (test teardown / graceful stop).
 */
export const closePool = async (): Promise<void> => {
  if (!_pool) {
    return;
  }
  const pool = _pool;
  _pool = undefined;
  await pool.end();
};
