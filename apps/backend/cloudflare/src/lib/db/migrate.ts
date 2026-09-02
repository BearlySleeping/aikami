// apps/backend/cloudflare/src/lib/db/migrate.ts
//
// C-455: The sole D1-migration-apply implementation. Merges the behavior of
// scripts/src/lib/deploy/database_migration.ts and
// scripts/src/lib/database/migrate.ts into one function, sourced from
// @aikami/constants' D1_DATABASES.
//
// Reached by:
//   - `bun db migrate` (developer convenience, via root package.json alias)
//   - `bun run deploy database` (orchestrator, via scripts/src/lib/deploy/index.ts)
//
// Both call the same exported function below — there is no second copy to drift.

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { D1_DATABASES } from '@aikami/constants';
import {
  confirmProduction,
  getHubDir,
  getMigrationsDir,
  resolveD1Binding,
  resolveModeGuard,
  runWrangler,
  writeThrowawayD1Config,
} from '../wrangler.ts';

/** Mode and locality used when applying D1 migrations. */
export type ApplyMigrationsOptions = {
  /** Deployment mode whose database should be migrated. */
  mode: string;
  /** Whether Wrangler should use the hub's local D1 state. */
  isLocal: boolean;
};

/**
 * Apply pending D1 migrations for the given mode.
 * @returns The number of migrations applied.
 */
export const applyMigrations = async (
  options: ApplyMigrationsOptions,
): Promise<{ applied: number }> => {
  const { mode, isLocal } = options;

  const dbBinding = isLocal ? D1_DATABASES.hub.production : resolveD1Binding({ mode });
  if (!dbBinding) {
    throw new Error(`No D1 database configured for hub in mode "${mode}"`);
  }

  // Production guard: interactive confirm or --yes for non-TTY
  if (mode === 'production') {
    const isYes = Bun.argv.includes('--yes') || Bun.argv.includes('-y');
    if (!process.stdin.isTTY) {
      if (!isYes) {
        process.exit(1);
      }
    } else if (!(await confirmProduction())) {
      process.exit(1);
    }
  }

  const dbDir = getHubDir();
  const migrationsDir = getMigrationsDir();

  const configPath = isLocal
    ? resolve(dbDir, 'wrangler.jsonc')
    : writeThrowawayD1Config({
        mode,
        isLocal,
        dbDir,
        dbBinding,
        migrationsDir,
      });

  const args = [
    'd1',
    'migrations',
    'apply',
    dbBinding.binding,
    '--config',
    configPath,
    isLocal ? '--local' : '--remote',
  ];

  try {
    const output = runWrangler({ args, cwd: dbDir });
    const outputStr = output.toString();

    const applied = (outputStr.match(/Applied\s+/g) ?? []).length;
    return { applied };
  } finally {
    if (!isLocal) {
      const tmpDir = resolve(configPath, '..');
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }
};

// ── CLI entry ──────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal } = resolveModeGuard(args);

  try {
    await applyMigrations({ mode, isLocal });
  } catch (_error) {
    process.exit(1);
  }
};

// Only run as CLI when executed directly (not imported as a module)
const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  main();
}
