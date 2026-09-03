// apps/backend/cloudflare/src/lib/worker/deploy.ts
//
// 🔴 PARTIAL PORT, NOT WIRED IN. This is a simplified sketch, not a real
// port of scripts/src/lib/deploy/cloudflare.ts's `deployCloudflareWorker` —
// see ../worker/index.ts's header for the concrete gaps (no checksum
// cache, no build step, no headers file, expects a pre-existing
// wrangler.jsonc instead of generating one). The original 498-line file
// was NOT deleted; it is still the sole deploy path every app's
// scripts/deploy.ts and scripts/src/index.ts actually call. Finishing
// this port and cutting those four apps + the orchestrator over to it is
// unstarted, separate work — do it as its own contract, verified against
// a real staging deploy before any production app is repointed here.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppId } from '@aikami/types';
import { confirmProduction, resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');

/**
 * Deploy a Cloudflare Worker using wrangler.
 * Simplified entry point that delegates to wrangler deploy.
 */
export const deployWorker = async (): Promise<void> => {
  const args = Bun.argv.slice(3);
  const { mode, isLocal: _isLocal } = resolveModeGuard(args);

  const appIdx = args.indexOf('--app');
  const appName = (appIdx !== -1 ? args[appIdx + 1] : undefined) as AppId | undefined;

  if (!appName) {
    process.exit(1);
  }

  const appRoot = resolve(ROOT, `apps/frontend/${appName === 'client' ? 'client' : appName}`);
  const buildOutputDir = appName === 'site' || appName === 'docs' ? 'dist' : 'build';
  const outputDir = resolve(appRoot, buildOutputDir);

  if (!existsSync(outputDir)) {
    process.exit(1);
  }

  if (!_isLocal && mode === 'production') {
    const isYes = args.includes('--yes') || args.includes('-y');
    if (!process.stdin.isTTY) {
      if (!isYes) {
        process.exit(1);
      }
    } else if (!(await confirmProduction())) {
      process.exit(1);
    }
  }

  try {
    const wranglerArgs = ['wrangler', 'deploy', '--config', resolve(appRoot, 'wrangler.jsonc')];
    if (!_isLocal) {
      wranglerArgs.push('--env', mode);
    }
    execFileSync('bunx', wranglerArgs, {
      cwd: appRoot,
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (_error) {
    process.exit(1);
  }
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
  deployWorker();
}
