// apps/backend/cloudflare/src/lib/storage/ls.ts
//
// C-455: List R2 bucket contents. Thin wrapper over `wrangler r2 object list`.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

const main = (): void => {
	const args = Bun.argv.slice(3);
	const { mode, isLocal: _isLocal } = resolveModeGuard(args);

	// Extract bucket key
	const bucketKeyArg = args.find(a => !a.startsWith('--'));
	const bucketKey = bucketKeyArg || 'saves';

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

	try {
		const output = execFileSync('bunx', ['wrangler', 'r2', 'object', 'list', entry.bucketName], {
			cwd: HUB_DIR,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 30_000,
		});
		console.log(output.toString());
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
		console.error(`storage:ls failed: ${stderr || (error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
