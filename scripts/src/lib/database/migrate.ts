// scripts/src/lib/database/migrate.ts
//
// C-436: developer-facing migration command for the D1 data plane.
//
//   bun run db:migrate                                → apply pending migrations to LOCAL D1
//   bun run db:status                                 → local migration status
//   bun run db:migrate:remote -- --mode staging       → apply to staging D1
//   bun run db:migrate:remote -- --mode production    → apply to production D1 (y/N prompt)
//   bun run db:status -- --remote --mode staging      → remote migration status
//
// Uses `wrangler d1 migrations apply` under the hood. The Postgres/Neon
// migration path was removed in C-436.
//
// 🔴 Mode-aware, deliberately NOT run from apps/frontend/hub — that
// directory's wrangler.jsonc hardcodes PRODUCTION's database_id (it's the
// base config the deploy pipeline rewrites `name`/`routes`/`vars` from — see
// cloudflare.ts), so a bare `wrangler d1 migrations apply DB --remote` run
// from there would always hit production's D1, even when the caller meant
// staging. See deploy/database_migration.ts's header for the full story —
// this applies the same fix: a throwaway config with the mode-correct
// `d1Databases` entry from APP_CONFIG.hub.cloudflare (the same source of
// truth cloudflare.ts's real deploy uses), pointed at via `--config`.
//
// Any run that isn't `--local` requires an explicit `--mode` — there is no
// default, since defaulting could silently mean "production". Targeting
// production additionally requires an interactive y/N confirmation; that
// prompt can only be skipped in a non-TTY context by passing `--yes`.
//
// Invoked via `bunx wrangler`, not a bare `wrangler` — bunx resolves the
// version pinned in scripts/package.json, so this can't drift onto whatever
// `wrangler` happens to be on $PATH (e.g. a global install).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { APP_CONFIG } from '../deploy/deployment_config';

const DB_DIR = resolve(import.meta.dir, '../../../../apps/frontend/hub');
const MIGRATIONS_DIR = resolve(import.meta.dir, '../../../../packages/backend/database/drizzle-d1');

const countTotalMigrations = (): number =>
  readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).length;

// `wrangler d1 migrations list` prints "No migrations to apply!" when nothing
// is pending, or a table with one `│ NNNN_name.sql │`-style row per pending
// migration otherwise — count those rows rather than the old `[x]`/`Applied `
// patterns, which never matched this wrangler version's table output (hence
// `db:status` always reporting 0 applied).
const countPendingMigrations = (outputStr: string): number =>
  (outputStr.match(/\.sql\s+│/g) ?? []).length;

const confirmProduction = async (): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\n⚠️  This targets PRODUCTION D1. Continue? (y/N) ');
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
};

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(2);
  const isLocal = args.includes('--local') || !args.includes('--remote');
  const isStatus = args.includes('--status');
  const isYes = args.includes('--yes');
  const modeIdx = args.indexOf('--mode');
  const modeArg = modeIdx !== -1 ? args[modeIdx + 1] : undefined;

  let mode: string;
  if (isLocal) {
    mode = 'emulator';
  } else {
    if (modeArg !== 'staging' && modeArg !== 'production') {
      console.error('db:migrate: --mode staging|production is required for a --remote run.');
      process.exit(1);
      return;
    }
    mode = modeArg;
  }

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
    console.error(`db:migrate: no D1 database configured for hub in mode "${mode}"`);
    process.exit(1);
    return;
  }

  console.log(`database:  ${dbBinding.databaseName} (${mode})`);

  if (mode === 'production') {
    if (!process.stdin.isTTY) {
      if (!isYes) {
        console.error(
          'db:migrate: refusing to run against production non-interactively without --yes.',
        );
        process.exit(1);
        return;
      }
    } else if (!(await confirmProduction())) {
      console.error('db:migrate: aborted.');
      process.exit(1);
      return;
    }
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
          migrations_dir: MIGRATIONS_DIR,
        },
      ],
    }),
  );

  const wranglerArgs = [
    'd1',
    'migrations',
    isStatus ? 'list' : 'apply',
    dbBinding.binding,
    '--config',
    tmpConfigPath,
  ];
  wranglerArgs.push(isLocal ? '--local' : '--remote');

  try {
    const output = execFileSync('bunx', ['wrangler', ...wranglerArgs], {
      cwd: DB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const outputStr = output.toString();
    console.log(outputStr);

    const total = countTotalMigrations();
    // `apply` throws on failure (caught below), so reaching here means
    // nothing is left pending regardless of migration mode.
    const pending = isStatus ? countPendingMigrations(outputStr) : 0;
    const applied = total - pending;
    const label = isStatus ? 'db:status' : 'db:migrate';

    console.log(
      `${label} ${isLocal ? 'local' : mode} — ${applied}/${total} migration(s) applied${
        pending > 0 ? `, ${pending} pending` : ''
      }`,
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim();
    console.error(`db:migrate failed: ${stderr || stdout || (error as Error).message}`);
    process.exit(1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

main();
