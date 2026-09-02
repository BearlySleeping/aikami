// apps/backend/cloudflare/src/lib/storage/stat.ts
//
// C-455: Get R2 object metadata. Thin wrapper over `wrangler r2 object get` with --pipe.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

const main = (): void => {
  const args = Bun.argv.slice(3);
  const { mode } = resolveModeGuard(args);

  const statIdx = args.indexOf('stat');
  const key =
    statIdx + 1 < args.length && !args[statIdx + 1].startsWith('--')
      ? args[statIdx + 1]
      : undefined;

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

  try {
    execFileSync('bunx', ['wrangler', 'r2', 'object', 'get', entry.bucketName, key, '--pipe'], {
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
  main();
}
