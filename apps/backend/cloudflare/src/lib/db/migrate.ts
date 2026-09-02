// apps/backend/cloudflare/src/lib/db/migrate.ts
//
// C-455: The sole D1-migration-apply implementation. Merges the behavior of
// scripts/src/lib/deploy/database_migration.ts and
// scripts/src/lib/database/migrate.ts into one function, sourced from
// @aikami/constants' D1_DATABASES.
//
// Reached by:
//   - `bun db migrate` (developer convenience, via root package.json alias)
//   - `bun run deploy database` (orchestrator, via scripts/src/lib/deploy/index.ts)
//
// Both call the same exported function below — there is no second copy to drift.

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	confirmProduction,
	getHubDir,
	getMigrationsDir,
	resolveD1Binding,
	resolveModeGuard,
	runWrangler,
	writeThrowawayD1Config,
} from '../wrangler.ts';

/**
 * Apply pending D1 migrations for the given mode.
 * @returns The number of migrations applied.
 */
export const applyMigrations = async (options: {
	mode: string;
	isLocal: boolean;
}): Promise<{ applied: number }> => {
	const { mode, isLocal } = options;

	const dbBinding = resolveD1Binding(mode);
	if (!dbBinding) {
		throw new Error(`No D1 database configured for hub in mode "${mode}"`);
	}

	// Production guard: interactive confirm or --yes for non-TTY
	if (mode === 'production') {
		const isYes = Bun.argv.includes('--yes');
		if (!process.stdin.isTTY) {
			if (!isYes) {
				console.error('db:migrate: refusing to run against production non-interactively without --yes.');
				process.exit(1);
			}
		} else if (!(await confirmProduction())) {
			console.error('db:migrate: aborted.');
			process.exit(1);
		}
	}

	const dbDir = getHubDir();
	const migrationsDir = getMigrationsDir();

	const tmpConfigPath = writeThrowawayD1Config({
		mode,
		isLocal,
		dbDir,
		dbBinding,
		migrationsDir,
	});

	const args = [
		'd1',
		'migrations',
		'apply',
		dbBinding.binding,
		'--config',
		tmpConfigPath,
		isLocal ? '--local' : '--remote',
	];

	console.log(`🗄  applying D1 migrations to ${dbBinding.databaseName} (${isLocal ? 'local' : 'remote'})...`);

	try {
		const output = runWrangler({ args, cwd: dbDir });
		const outputStr = output.toString();
		console.log(outputStr);

		const applied = (outputStr.match(/Applied\s+/g) ?? []).length;
		console.log(`🗄  D1 migrations applied: ${applied} (0 = nothing pending)`);
		return { applied };
	} finally {
		// Clean up the temp config directory
		const tmpDir = resolve(tmpConfigPath, '..');
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup failure
		}
	}
};

// ── CLI entry ──────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
	const args = Bun.argv.slice(3);
	const { mode, isLocal } = resolveModeGuard(args);

	try {
		await applyMigrations({ mode, isLocal });
	} catch (error) {
		console.error(`db:migrate failed: ${(error as Error).message}`);
		process.exit(1);
	}
};

// Only run as CLI when executed directly (not imported as a module)
const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
