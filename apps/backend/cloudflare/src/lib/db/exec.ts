// apps/backend/cloudflare/src/lib/db/exec.ts
//
// C-455: Thin wrapper over `wrangler d1 execute <command>`.
// Runs a SQL command against the D1 database.

import {
	getHubDir,
	resolveD1Binding,
	resolveModeGuard,
	runWrangler,
} from '../wrangler.ts';

const main = async (): Promise<void> => {
	const args = Bun.argv.slice(3);
	const { mode, isLocal } = resolveModeGuard(args);

	// Extract the SQL command from remaining args after --command
	const cmdIdx = args.indexOf('--command');
	const command = cmdIdx !== -1 ? args[cmdIdx + 1] : undefined;

	if (!command) {
		console.error('Usage: bun run src/cli.ts db exec --command <sql> [--local|--remote] [--mode staging|production]');
		process.exit(1);
	}

	const dbBinding = resolveD1Binding(mode);
	if (!dbBinding) {
		throw new Error(`No D1 database configured for hub in mode "${mode}"`);
	}

	const dbDir = getHubDir();

	const wranglerArgs = [
		'd1',
		'execute',
		dbBinding.binding,
		'--command',
		command,
		'--yes',
		isLocal ? '--local' : '--remote',
	];

	try {
		const output = runWrangler({ args: wranglerArgs, cwd: dbDir });
		console.log(output.toString());
	} catch (error) {
		console.error(`db:exec failed: ${(error as Error).message}`);
		process.exit(1);
	}
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
