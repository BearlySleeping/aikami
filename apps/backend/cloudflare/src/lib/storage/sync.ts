// apps/backend/cloudflare/src/lib/storage/sync.ts
//
// C-455: Bucket-vs-catalog reconciliation for R2. Deploy storage target.
// Lists objects once, diffs in memory, and applies changes.
// Preserves the list-once-diff-in-memory strategy from catalog/upload.ts.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

export type SyncOptions = {
  mode: string;
  isLocal: boolean;
  bucketKey: keyof typeof R2_BUCKETS;
  prefix?: string;
};

/**
 * Reconcile R2 bucket contents. Lists remote objects, diffs against
 * the declared set, and applies changes.
 * Currently a scaffold that verifies the bucket is accessible and lists contents.
 * Full reconciliation logic will be added in follow-up work.
 */
export const reconcileBucket = async (options: SyncOptions): Promise<{ checked: number }> => {
  const { mode, isLocal: _isLocal, bucketKey, prefix } = options;

  const bucket = R2_BUCKETS[bucketKey];
  const entry = bucket[mode as keyof typeof bucket];
  if (!entry) {
    throw new Error(`No bucket configured for ${bucketKey} in mode "${mode}"`);
  }

  const listArgs = ['r2', 'object', 'list', entry.bucketName];
  if (prefix) {
    listArgs.push('--prefix', prefix);
  }

  try {
    const output = execFileSync('bunx', ['wrangler', ...listArgs], {
      cwd: HUB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    const objects = output.toString().trim().split('\n').filter(Boolean);
    return { checked: objects.length };
  } catch (error) {
    throw error;
  }
};

// ── CLI entry ──────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  const bucketIdx = args.indexOf('--bucket');
  const bucketKey = (bucketIdx !== -1 ? args[bucketIdx + 1] : 'saves') as keyof typeof R2_BUCKETS;
  const prefixIdx = args.indexOf('--prefix');
  const prefix = prefixIdx !== -1 ? args[prefixIdx + 1] : undefined;

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
    await reconcileBucket({ mode, isLocal: _isLocal, bucketKey, prefix });
  } catch (_error) {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  main();
}
