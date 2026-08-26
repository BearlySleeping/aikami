// scripts/src/lib/database/migrate.ts
//
// C-436: developer-facing migration command for the D1 data plane.
//
//   bun run db:migrate               → apply pending migrations to LOCAL D1
//   bun run db:migrate --remote      → apply pending migrations to remote D1
//   bun run db:status                → print how many migrations are applied
//
// Uses `wrangler d1 migrations apply` under the hood. The Postgres/Neon
// migration path was removed in C-436.
//
// Runs from apps/frontend/hub — that's where the D1 binding (wrangler.jsonc)
// lives. `migrations_dir` on that binding points wrangler at the migration
// SQL in packages/backend/database/drizzle-d1 (the schema source of truth).
//
// Invoked via `bunx wrangler`, not a bare `wrangler` — bunx resolves the
// version pinned in scripts/package.json, so this can't drift onto whatever
// `wrangler` happens to be on $PATH (e.g. a global install).

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

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

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(2);
  const isRemote = args.includes('--remote');
  const isStatus = args.includes('--status');

  const wranglerArgs = ['d1', 'migrations', isStatus ? 'list' : 'apply', 'DB'];

  if (!isRemote) {
    wranglerArgs.push('--local');
  }

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
      `${label} ${isRemote ? 'remote' : 'local'} — ${applied}/${total} migration(s) applied${
        pending > 0 ? `, ${pending} pending` : ''
      }`,
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim();
    console.error(`db:migrate failed: ${stderr || stdout || (error as Error).message}`);
    process.exit(1);
  }
};

main();
