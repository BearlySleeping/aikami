// apps/backend/cloudflare/src/lib/storage/put.ts
//
// C-455: Put an object into R2. Thin wrapper over `wrangler r2 object put`.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { R2_BUCKETS } from '@aikami/constants';
import { resolveModeGuard } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');

const main = (): void => {
	const args = Bun.argv.slice(3);
	const { mode } = resolveModeGuard(args);

	// Parse: storage put <key> <file> [--bucket <bucketKey>]
	const putIdx = args.findIndex(a => a === 'put');
	const key = putIdx + 1 < args.length && !args[putIdx + 1].startsWith('--') ? args[putIdx + 1] : undefined;
	const file = putIdx + 2 < args.length && !args[putIdx + 2].startsWith('--') ? args[putIdx + 2] : undefined;

	if (!key || !file) {
		console.error('Usage: bun run src/cli.ts storage put <key> <file> [--bucket saves|catalog] [--local|--remote]');
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

	try {
		const output = execFileSync('bunx', ['wrangler', 'r2', 'object', 'put', `${entry.bucketName}/${key}`, '--file', file], {
			cwd: HUB_DIR,
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 60_000,
		});
		console.log(output.toString());
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
		console.error(`storage:put failed: ${stderr || (error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
