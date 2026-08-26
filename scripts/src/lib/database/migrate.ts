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

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const DB_DIR = resolve(import.meta.dir, '../../../../packages/backend/database');

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(2);
  const isRemote = args.includes('--remote');
  const isStatus = args.includes('--status');

  const wranglerArgs = ['d1', 'migrations', isStatus ? 'list' : 'apply', 'DB'];

  if (!isRemote) {
    wranglerArgs.push('--local');
  }

  try {
    const output = execFileSync('wrangler', wranglerArgs, {
      cwd: DB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const outputStr = output.toString();
    console.log(outputStr);

    if (isStatus) {
      const applied = (outputStr.match(/\[x\]/g) ?? []).length;
      console.log(`db:status ${isRemote ? 'remote' : 'local'} — ${applied} migration(s) applied`);
    } else {
      const applied = (outputStr.match(/Applied\s+/g) ?? []).length;
      console.log(`db:migrate ${isRemote ? 'remote' : 'local'} — ${applied} migration(s) applied`);
    }
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    const stdout = (error as { stdout?: Buffer }).stdout?.toString().trim();
    console.error(`db:migrate failed: ${stderr || stdout || (error as Error).message}`);
    process.exit(1);
  }
};

main();
