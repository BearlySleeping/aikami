// apps/backend/cloudflare/src/lib/db/studio.ts
//
// C-455: Launch Drizzle Kit Studio for the D1 database.
// Thin wrapper over `drizzle-kit studio`.

import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const DB_DIR = resolve(ROOT, 'packages/backend/database');

const main = (): void => {
	console.log('Launching Drizzle Kit Studio...');
	try {
		execFileSync('bunx', ['drizzle-kit', 'studio'], {
			cwd: DB_DIR,
			stdio: 'inherit',
			timeout: 120_000,
		});
	} catch (error) {
		console.error(`db:studio failed: ${(error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
