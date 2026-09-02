// apps/backend/cloudflare/src/lib/worker/deploy.ts
//
// C-455: Cloudflare Worker deployment. Moved from scripts/src/lib/deploy/cloudflare.ts.
//
// This module re-exports and wraps the deploy logic that was previously in
// scripts/src/lib/deploy/cloudflare.ts. The original file is deleted after
// this migration.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppId } from '@aikami/types';
import { resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');

/**
 * Deploy a Cloudflare Worker using wrangler.
 * Simplified entry point that delegates to wrangler deploy.
 */
const main = async (): Promise<void> => {
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
  main();
}
