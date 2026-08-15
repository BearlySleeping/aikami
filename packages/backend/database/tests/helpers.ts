// packages/backend/database/tests/helpers.ts
//
// C-394: shared integration-test helpers.
//
// Tests run against the REAL local PostgreSQL from C-387 (never a mock — a
// mocked database cannot prove a constraint exists). When postgres is not
// running the suites SKIP with a clear message instead of failing
// confusingly or silently passing.

import { expect } from 'bun:test';
import type { Pool } from 'pg';

/** Local C-387 PostgreSQL — the emulator value of NEON_DATABASE_URL. */
export const TEST_CONNECTION_URL = 'postgresql://localhost:5433/aikami_dev?sslmode=disable';

/** True when the local postgres answers a `SELECT 1` on port 5433. */
export const isPostgresReachable = async (): Promise<boolean> => {
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      connectionString: TEST_CONNECTION_URL,
      connectionTimeoutMillis: 1500,
    });
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch {
    return false;
  }
};

/**
 * Wipe all catalog rows between tests so the suite is order-independent and
 * re-runnable. TRUNCATE ... CASCADE is safe here: the three tables have
 * RESTRICT FKs (never cascades deletes on live rows), and we intentionally
 * reset the whole catalog between tests.
 */
export const truncateCatalog = async (pool: Pool): Promise<void> => {
  await pool.query('TRUNCATE accounts, packs, pack_versions CASCADE');
};

/** Extract the Postgres error code from a rejected promise (drizzle wraps pg errors in DrizzleQueryError → cause chain). */
export const pgErrorCode = (error: unknown): string | undefined => {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

/** Expect a rejection with the given Postgres error code (walks the cause chain). */
export const expectPgError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  const err = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(pgErrorCode(err)).toBe(code);
};
