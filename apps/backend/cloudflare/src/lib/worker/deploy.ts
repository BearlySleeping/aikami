// apps/backend/cloudflare/src/lib/worker/deploy.ts
//
// C-455: Cloudflare Worker deployment. Moved from scripts/src/lib/deploy/cloudflare.ts.
//
// This module re-exports and wraps the deploy logic that was previously in
// scripts/src/lib/deploy/cloudflare.ts. The original file is deleted after
// this migration.

import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
		console.error('Usage: bun run src/cli.ts worker deploy --app <appId> [--mode staging|production]');
		console.error('  App IDs: client, site, docs, hub');
		process.exit(1);
	}

	const appRoot = resolve(ROOT, `apps/frontend/${appName === 'client' ? 'client' : appName}`);
	const buildOutputDir = appName === 'site' || appName === 'docs' ? 'dist' : 'build';
	const outputDir = resolve(appRoot, buildOutputDir);

	if (!existsSync(outputDir)) {
		console.error(`Build output not found at ${outputDir}. Run the build first.`);
		process.exit(1);
	}

	console.log(`⛅ Deploying ${appName} Worker to ${mode}...`);

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
		console.log(`✅ ${appName} deployed to Cloudflare (${mode})`);
	} catch (error) {
		console.error(`worker:deploy failed: ${(error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
