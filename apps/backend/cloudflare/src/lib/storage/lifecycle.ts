// apps/backend/cloudflare/src/lib/storage/lifecycle.ts
//
// C-455: Manage R2 bucket lifecycle rules. Thin wrapper over wrangler.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

/** Parse CLI arguments and list lifecycle rules for a declared R2 bucket. */
export const runLifecycleCommand = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  const bucketIdx = args.indexOf('--bucket');
  const bucketKey = (bucketIdx !== -1 ? args[bucketIdx + 1] : 'saves') as keyof typeof R2_BUCKETS;
  const bucket = R2_BUCKETS[bucketKey];
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
    const output = execFileSync(
      'bunx',
      ['wrangler', 'r2', 'bucket', 'lifecycle', 'list', entry.bucketName],
      {
        cwd: HUB_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    process.stdout.write(output);
  } catch {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  runLifecycleCommand();
}
