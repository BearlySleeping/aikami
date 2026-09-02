// apps/backend/cloudflare/src/lib/storage/rm.ts
//
// C-455: Delete an object from R2. Thin wrapper over `wrangler r2 object delete`.
// Non-local destructive command — requires --mode.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { resolveModeGuard, confirmProduction } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

const main = async (): Promise<void> => {
	const args = Bun.argv.slice(3);
	const { mode, isLocal: _isLocal } = resolveModeGuard(args);

	const rmIdx = args.findIndex(a => a === 'rm');
	const key = rmIdx + 1 < args.length && !args[rmIdx + 1].startsWith('--') ? args[rmIdx + 1] : undefined;

	if (!key) {
		console.error('Usage: bun run src/cli.ts storage rm <key> [--bucket saves|catalog] [--local|--remote] [--mode staging|production]');
		process.exit(1);
	}

	const bucketIdx = args.indexOf('--bucket');
	const bucketKey = bucketIdx !== -1 ? args[bucketIdx + 1] : 'saves';
	const bucket = R2_BUCKETS[bucketKey as keyof typeof R2_BUCKETS];
	if (!bucket) {
		console.error(`Unknown bucket key: ${bucketKey}. Valid keys: saves, catalog`);
		process.exit(1);
	}

	const entry = bucket[mode as keyof typeof bucket];
	if (!entry) {
		console.error(`No bucket configured for ${bucketKey} in mode "${mode}"`);
		process.exit(1);
	}

	// Production guard
	if (mode === 'production') {
		const isYes = args.includes('--yes');
		if (!process.stdin.isTTY) {
			if (!isYes) {
				console.error('storage:rm: refusing to run against production non-interactively without --yes.');
				process.exit(1);
			}
		} else if (!(await confirmProduction())) {
			console.error('storage:rm: aborted.');
			process.exit(1);
		}
	}

	try {
		const output = execFileSync('bunx', ['wrangler', 'r2', 'object', 'delete', entry.bucketName, key], {
			cwd: HUB_DIR,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 30_000,
		});
		console.log(output.toString());
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
		console.error(`storage:rm failed: ${stderr || (error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
