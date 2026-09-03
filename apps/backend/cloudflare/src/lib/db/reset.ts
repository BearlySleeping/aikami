// apps/backend/cloudflare/src/lib/db/reset.ts
//
// C-455: Reset local D1 database state (delete .wrangler/state and re-apply migrations).
// Thin wrapper over wrangler local state management.

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkLocalMode, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

export const main = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { isLocal } = resolveModeGuard(args);

  if (!isLocal) {
    process.exit(1);
  }

  checkLocalMode();
  rmSync(resolve(HUB_DIR, '.wrangler/state'), { recursive: true, force: true });
  const proc = Bun.spawn(['bunx', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'], {
    cwd: HUB_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  main();
}
