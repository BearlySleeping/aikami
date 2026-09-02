// apps/backend/cloudflare/src/lib/storage/sync.ts
//
// C-455: Bucket-vs-catalog reconciliation for R2. Deploy storage target.
// Lists objects once, diffs in memory, and applies changes.
// Preserves the list-once-diff-in-memory strategy from catalog/upload.ts.

import { R2_BUCKETS } from '@aikami/constants';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

/** Options that select the R2 desired state a reconciliation should apply. */
export type SyncOptions = {
  /** Deployment mode whose bucket declaration should be reconciled. */
  mode: string;
  /** Whether reconciliation is constrained to local Cloudflare state. */
  isLocal: boolean;
  /** R2 bucket declaration to reconcile. */
  bucketKey: keyof typeof R2_BUCKETS;
  /** Optional object-key prefix that limits reconciliation scope. */
  prefix?: string;
};

/**
 * Refuse the deployment target until a desired-object manifest exists.
 * Returning success after list-only work would falsely mark R2 as reconciled.
 */
export const reconcileBucket = async (options: SyncOptions): Promise<never> => {
  const { mode, bucketKey } = options;

  const bucket = R2_BUCKETS[bucketKey];
  const entry = bucket[mode as keyof typeof bucket];
  if (!entry) {
    throw new Error(`No bucket configured for ${bucketKey} in mode "${mode}"`);
  }

  throw new Error(
    `R2 reconciliation is unsupported for ${entry.bucketName}: no desired-object manifest is defined`,
  );
};

// ── CLI entry ──────────────────────────────────────────────────────────

/** Parse CLI arguments and attempt the guarded R2 reconciliation target. */
export const runSyncCommand = async (): Promise<void> => {
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
  runSyncCommand();
}
