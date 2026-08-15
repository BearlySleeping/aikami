// scripts/src/lib/deploy/database_migration.ts
//
// C-394 AC-5: the `database` deploy app — applies pending server-plane
// migrations against NEON_DATABASE_URL_DIRECT.
//
// Rules enforced here:
//   • DIRECT (unpooled) endpoint only — DDL under PgBouncer transaction
//     pooling is precisely where pooling breaks.
//   • Transactional + idempotent (drizzle's migrator wraps all pending
//     migrations in one transaction; re-running is a no-op).
//   • Never auto-applied on server boot and never a side effect of
//     deploying the hub — this app is independently invocable.
//   • Logical backup before applying: Neon Free history retention is 6
//     hours, which is the entire point-in-time-restore window. A bad
//     migration noticed the next morning is NOT recoverable from Neon's
//     history — pg_dump first, store outside Neon.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyMigrations,
  assertDirectEndpoint,
} from '../../../../packages/backend/database/src/lib/migrate.ts';
import { parseEnvKeys } from './utils.ts';

export const HUB_ENV_DIR = resolve(import.meta.dir, '../../../../apps/frontend/hub');

/** Time-stamped logical backup destination (repo-local, gitignored via .gitignore). */
const BACKUP_DIR = resolve(import.meta.dir, '../../../../.db-backups');

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * Take a logical backup (pg_dump) of the target database before applying
 * migrations. At this data size it costs seconds and is the only real
 * disaster-recovery story Neon Free has (6-hour history retention).
 * Returns the backup file path, or null when pg_dump is unavailable.
 */
export const dumpBeforeMigrate = (connectionString: string): string | null => {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const outPath = resolve(BACKUP_DIR, `catalog-${timestamp()}.sql`);
    // --no-owner / --no-privileges: the schema is owned by the deploy user,
    // not by the app roles; restore should never try to recreate owners.
    execFileSync(
      'pg_dump',
      ['--no-owner', '--no-privileges', '--format=plain', '--file', outPath, connectionString],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000 },
    );
    return outPath;
  } catch (error) {
    // A missing/mismatched pg_dump must not block the migration itself — the
    // dump is defense in depth, the migration is the required step. But the
    // reason MUST be visible (e.g. pg_dump 17 against a PG 18 server).
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    console.warn(
      `⚠ pg_dump backup failed (${stderr || (error as Error).message}) — continuing without a pre-migration dump`,
    );
    return null;
  }
};

/**
 * Deploy the database app: backup, then apply pending migrations against
 * NEON_DATABASE_URL_DIRECT from the hub's .env.{mode}.
 */
export const deployDatabaseMigration = async (options: {
  mode: string;
  rootDir: string;
}): Promise<{ applied: number }> => {
  const { mode, rootDir } = options;
  const envVars = parseEnvKeys(resolve(rootDir, HUB_ENV_DIR, `.env.${mode}`));
  const connectionString = envVars.NEON_DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error(
      `NEON_DATABASE_URL_DIRECT is not set in apps/frontend/hub/.env.${mode} — ` +
        'migrations must run through the DIRECT (unpooled) endpoint.',
    );
  }
  // Fail fast on a pooled endpoint BEFORE the backup: DDL under PgBouncer
  // transaction pooling is a corruption path, and a logical backup of the
  // wrong database is worse than no backup at all.
  assertDirectEndpoint(connectionString);

  const backupPath = dumpBeforeMigrate(connectionString);
  if (backupPath) {
    console.log(`📦 logical backup written to ${backupPath} (outside Neon)`);
  } else {
    console.warn('⚠ pg_dump unavailable — skipping pre-migration logical backup');
  }

  const applied = await applyMigrations({ connectionString });
  console.log(`🗄  database migrations applied: ${applied} (0 = nothing pending)`);
  return { applied };
};
