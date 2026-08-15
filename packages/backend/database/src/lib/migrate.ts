// packages/backend/database/src/lib/migrate.ts
//
// C-394: migration runner for the server data plane.
//
// Drizzle owns DDL (D-9) — this module only APPLIES the generated
// migrations. Requirements:
//
//   • Connect through the DIRECT (non-pooled) endpoint. DDL under PgBouncer
//     transaction pooling is precisely where pooling breaks — the deploy
//     step passes `DATABASE_URL_DIRECT`, never the runtime pooled URL.
//   • Forward-only and transactional: drizzle's pg migrator wraps ALL
//     pending migrations in one transaction, so a partially applied
//     migration is impossible and a failed run leaves the previous version
//     intact (exits non-zero).
//   • Idempotent by version: applied migration folders are recorded in
//     `drizzle.__drizzle_migrations`; re-running apply is a no-op.
//   • NEVER auto-applied on server boot — a Cloud Run cold start must not
//     race N instances into the same migration. Applying is the explicit
//     deploy step (AC-5).

import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as runDrizzleMigrations } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { logger } from '$logger';
import { describeConnectionString } from './connection.ts';

// ── Configuration ───────────────────────────────────────────────────────

/** Environment key holding the DIRECT (unpooled) connection string for migrations. */
export const DATABASE_URL_DIRECT_ENV_KEY = 'NEON_DATABASE_URL_DIRECT';

/** Drizzle-generated migration folder, relative to this package root. */
const MIGRATIONS_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', 'drizzle');

// ── Runner ──────────────────────────────────────────────────────────────

/**
 * Apply all pending generated migrations against the given connection
 * string (DIRECT endpoint). Returns the number of migrations applied
 * (0 = nothing pending = no-op).
 *
 * Uses a single dedicated `pg.Client` — migrations are one-shot DDL runs,
 * not request traffic, so a pool would add nothing.
 */
export const applyMigrations = async (options: {
  /** DIRECT (non-pooled) connection string. */
  connectionString: string;
  /** Override the migrations folder (tests). */
  migrationsFolder?: string;
}): Promise<number> => {
  const { connectionString, migrationsFolder = MIGRATIONS_DIR } = options;
  const { host, isPooled } = describeConnectionString(connectionString);
  logger.debug('database:migrate:start', { host, isPooled });

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const db = drizzle(client);

    const before = await countApplied(client);
    await runDrizzleMigrations(db, { migrationsFolder });
    const after = await countApplied(client);

    const applied = after - before;
    logger.info('database:migrate:applied', { applied, host });
    return applied;
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'unknown';
    logger.error('database:migrate:failed', { code });
    throw error;
  } finally {
    await client.end().catch(() => {
      // Best-effort teardown — a failed connect leaves nothing to close.
    });
  }
};

/** Number of applied migration folders recorded by the drizzle journal. */
export const countAppliedMigrations = async (options: {
  /** DIRECT (non-pooled) connection string. */
  connectionString: string;
}): Promise<number> => {
  const { connectionString } = options;
  const { host } = describeConnectionString(connectionString);
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return await countApplied(client);
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'unknown';
    logger.error('database:migrate:status:failed', { code, host });
    throw error;
  } finally {
    await client.end().catch(() => {
      // Best-effort teardown.
    });
  }
};

/** Number of applied migration folders recorded by the drizzle journal. */
const countApplied = async (client: Client): Promise<number> => {
  try {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    // Fresh database — the journal table does not exist until the first
    // migration run creates it (42P01 undefined_table). That is "0 applied".
    if ((error as { code?: string }).code === '42P01') {
      return 0;
    }
    throw error;
  }
};

/**
 * True when the migrations folder exists and contains a journal
 * (used by tests to skip cleanly when the package has no migrations yet).
 */
export const hasMigrations = async (
  migrationsFolder: string = MIGRATIONS_DIR,
): Promise<boolean> => {
  try {
    const entries = await readdir(migrationsFolder);
    return entries.some((entry) => entry === 'meta');
  } catch {
    return false;
  }
};
