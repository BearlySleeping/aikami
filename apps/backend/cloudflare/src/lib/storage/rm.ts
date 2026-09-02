// apps/backend/cloudflare/src/lib/storage/rm.ts
//
// C-455: Delete an object from R2. Thin wrapper over `wrangler r2 object delete`.
// Non-local destructive command — requires --mode.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

/** Parse CLI arguments and remove one R2 object. */
export const runRemoveCommand = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  const rmIdx = args.indexOf('rm');
  const key =
    rmIdx + 1 < args.length && !args[rmIdx + 1].startsWith('--') ? args[rmIdx + 1] : undefined;

  if (!key) {
    process.exit(1);
  }

  const bucketIdx = args.indexOf('--bucket');
  const bucketKey = bucketIdx !== -1 ? args[bucketIdx + 1] : 'saves';
  const bucket = R2_BUCKETS[bucketKey as keyof typeof R2_BUCKETS];
  if (!bucket) {
    process.exit(1);
  }

  const entry = bucket[mode as keyof typeof bucket];
  if (!entry) {
    process.exit(1);
  }

  // Production guard
  if (mode === 'production') {
    const isYes = args.includes('--yes');
    if (!process.stdin.isTTY) {
      if (!isYes) {
        process.exit(1);
      }
    } else if (!(await confirmProduction())) {
      process.exit(1);
    }
  }

  try {
    execFileSync('bunx', ['wrangler', 'r2', 'object', 'delete', entry.bucketName, key], {
      cwd: HUB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  } catch {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  runRemoveCommand();
}
