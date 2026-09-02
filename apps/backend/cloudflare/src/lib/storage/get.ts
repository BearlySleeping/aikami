// apps/backend/cloudflare/src/lib/storage/get.ts
//
// C-455: Get an object from R2. Thin wrapper over `wrangler r2 object get`.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

/** Parse CLI arguments and fetch one R2 object. */
export const runGetCommand = (): void => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  // Parse: storage get <key> [--bucket <bucketKey>]
  const keyIdx = args.indexOf('get') + 1;
  const key =
    keyIdx > 0 && keyIdx < args.length && !args[keyIdx].startsWith('--') ? args[keyIdx] : undefined;

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
    const output = execFileSync(
      'bunx',
      ['wrangler', 'r2', 'object', 'get', `${entry.bucketName}/${key}`],
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
  runGetCommand();
}
