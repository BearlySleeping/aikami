// scripts/src/lib/deploy/database_migration.ts
//
// C-436: the `database` deploy app — applies pending D1 migrations via
// `wrangler d1 migrations apply`. The Postgres/Neon migration path was
// removed in C-436.
//
// Rules enforced here:
//   • Uses `wrangler d1 migrations apply DB` (local or remote).
//   • Never auto-applied on server boot and never a side effect of
//     deploying the hub — this app is independently invocable.
//
// 🔴 Mode-aware, deliberately NOT via apps/frontend/hub/wrangler.jsonc: that
// file hardcodes PRODUCTION's database_id (it's the base config the deploy
// pipeline rewrites `name`/`routes`/`vars` from — see cloudflare.ts) — a
// bare `wrangler d1 migrations apply DB --remote` run from that directory
// would always hit production's D1, even for `--mode=staging`. Instead this
// writes a throwaway config with the mode-correct `d1Databases` entry from
// APP_CONFIG.hub.cloudflare (the same source of truth cloudflare.ts's real
// deploy uses) and points `--config` at that. `migrations_dir` points
// wrangler at the migration SQL in packages/backend/database/drizzle-d1
// (the schema source of truth).
//
// Invoked via `bunx wrangler`, not a bare `wrangler` — bunx resolves the
// version pinned in scripts/package.json, so this can't drift onto whatever
// `wrangler` happens to be on $PATH (e.g. a global install).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_CONFIG } from './deployment_config';

/**
 * Deploy the database app: apply pending D1 migrations.
 */
export const deployDatabaseMigration = async (options: {
  mode: string;
  rootDir: string;
}): Promise<{ applied: number }> => {
  const { mode } = options;
  const dbDir = resolve(import.meta.dir, '../../../../apps/frontend/hub');

  const isLocal = mode === 'emulator';

  const cloudflareConfig = APP_CONFIG.hub.cloudflare;
  if (!cloudflareConfig || cloudflareConfig.assetsOnly) {
    throw new Error('hub AppConfig is missing its D1-capable cloudflare config');
  }
  const d1 =
    typeof cloudflareConfig.d1Databases === 'function'
      ? cloudflareConfig.d1Databases(mode)
      : cloudflareConfig.d1Databases;
  const dbBinding = d1?.[0];
  if (!dbBinding) {
    throw new Error(`No D1 database configured for hub in mode "${mode}"`);
  }

  // A throwaway config, not apps/frontend/hub/wrangler.jsonc — see the
  // header comment above for why the real config is unsafe to use here.
  const tmpDir = mkdtempSync(join(tmpdir(), 'aikami-d1-migrate-'));
  const tmpConfigPath = join(tmpDir, 'wrangler.jsonc');
  writeFileSync(
    tmpConfigPath,
    JSON.stringify({
      name: `aikami-${mode}-hub-migrations`, // never deployed — wrangler just wants a name
      compatibility_date: '2026-08-21',
      d1_databases: [
        {
          binding: dbBinding.binding,
          database_name: dbBinding.databaseName,
          database_id: dbBinding.databaseId,
          migrations_dir: resolve(options.rootDir, 'packages/backend/database/drizzle-d1'),
        },
      ],
    }),
  );

  const args = ['d1', 'migrations', 'apply', dbBinding.binding, '--config', tmpConfigPath];

  if (isLocal) {
    args.push('--local');
  } else {
    args.push('--remote');
  }

  console.log(
    `🗄  applying D1 migrations to ${dbBinding.databaseName} (${isLocal ? 'local' : 'remote'})...`,
  );

  try {
    const output = execFileSync('bunx', ['wrangler', ...args], {
      cwd: dbDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const outputStr = output.toString();
    console.log(outputStr);

    // Count "Applied" lines to determine how many migrations were applied.
    const applied = (outputStr.match(/Applied\s+/g) ?? []).length;
    console.log(`🗄  D1 migrations applied: ${applied} (0 = nothing pending)`);
    return { applied };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim();
    console.error(`❌ D1 migration failed: ${stderr || stdout || (error as Error).message}`);
    throw error;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};
