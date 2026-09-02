// apps/backend/cloudflare/src/lib/db/studio.ts
//
// C-455: Launch Drizzle Kit Studio for the D1 database.
// Thin wrapper over `drizzle-kit studio`.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const DB_DIR = resolve(ROOT, 'packages/backend/database');

const main = (): void => {
  try {
    execFileSync('bunx', ['drizzle-kit', 'studio'], {
      cwd: DB_DIR,
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (_error) {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  main();
}
