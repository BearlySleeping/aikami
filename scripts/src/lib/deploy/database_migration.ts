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

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Deploy the database app: apply pending D1 migrations.
 */
export const deployDatabaseMigration = async (options: {
  mode: string;
  rootDir: string;
}): Promise<{ applied: number }> => {
  const { mode } = options;
  const dbDir = resolve(import.meta.dir, '../../../../packages/backend/database');

  const isLocal = mode === 'emulator';
  const args = ['d1', 'migrations', 'apply', 'DB'];

  if (isLocal) {
    args.push('--local');
  } else {
    args.push('--remote');
  }

  console.log(`🗄  applying D1 migrations (${isLocal ? 'local' : 'remote'})...`);

  try {
    const output = execFileSync('wrangler', args, {
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
  }
};
