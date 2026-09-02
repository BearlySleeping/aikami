// apps/backend/cloudflare/src/lib/storage/ensure.ts
//
// C-455: Ensure a declared R2 bucket exists, creating it if missing.
// Compares against R2_BUCKETS from @aikami/constants.
// Deploy storage target for bucket provisioning.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

/** Options that identify the declared R2 bucket an ensure operation should provision. */
export type EnsureBucketOptions = {
  /** Deployment mode whose bucket declaration should be used. */
  mode: string;
  /** Whether the operation is constrained to local Cloudflare state. */
  isLocal: boolean;
  /** R2 bucket declaration to ensure. */
  bucketKey: keyof typeof R2_BUCKETS;
};

/**
 * Ensure a declared R2 bucket exists. Creates it if missing.
 */
export const ensureBucket = async (options: EnsureBucketOptions): Promise<{ created: boolean }> => {
  const { mode, isLocal: _isLocal, bucketKey } = options;

  const bucket = R2_BUCKETS[bucketKey];
  const entry = bucket[mode as keyof typeof bucket];
  if (!entry) {
    throw new Error(`No bucket configured for ${bucketKey} in mode "${mode}"`);
  }

  // List buckets to check if ours already exists
  try {
    const listOutput = execFileSync('bunx', ['wrangler', 'r2', 'bucket', 'list'], {
      cwd: HUB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    const buckets = listOutput.toString();
    if (buckets.includes(entry.bucketName)) {
      return { created: false };
    }
  } catch {
    // If listing fails, try creating anyway
  }

  try {
    execFileSync('bunx', ['wrangler', 'r2', 'bucket', 'create', entry.bucketName], {
      cwd: HUB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { created: true };
  } catch {
    throw new Error('Failed to create bucket');
  }
};

// ── CLI entry ──────────────────────────────────────────────────────────

/** Parse CLI arguments and ensure the selected R2 bucket exists. */
export const runEnsureCommand = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  const bucketIdx = args.indexOf('--bucket');
  const bucketKey = (bucketIdx !== -1 ? args[bucketIdx + 1] : 'saves') as keyof typeof R2_BUCKETS;

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
    await ensureBucket({ mode, isLocal: _isLocal, bucketKey });
  } catch (_error) {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  runEnsureCommand();
}
