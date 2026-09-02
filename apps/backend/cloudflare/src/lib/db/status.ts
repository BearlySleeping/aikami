// apps/backend/cloudflare/src/lib/db/status.ts
//
// C-455: D1 migration status (list pending migrations). Calls the same
// underlying wrangler-invocation helper as migrate.ts.
//
// `wrangler d1 migrations list` prints "No migrations to apply!" when nothing
// is pending, or a table with one `│ NNNN_name.sql │`-style row per pending
// migration otherwise — count those rows rather than the old `[x]`/`Applied `
// patterns, which never matched this wrangler version's table output.

import { readdirSync, rmSync } from 'node:fs';
import {
	getHubDir,
	getMigrationsDir,
	resolveD1Binding,
	resolveModeGuard,
	runWrangler,
	writeThrowawayD1Config,
} from '../wrangler.ts';

const countTotalMigrations = (): number =>
	readdirSync(getMigrationsDir()).filter((name) => name.endsWith('.sql')).length;

const countPendingMigrations = (outputStr: string): number =>
	(outputStr.match(/\.sql\s+│/g) ?? []).length;

/**
 * List pending D1 migrations for the given mode.
 */
export const listMigrations = async (options: {
	mode: string;
	isLocal: boolean;
}): Promise<{ total: number; pending: number }> => {
	const { mode, isLocal } = options;

	const dbBinding = resolveD1Binding(mode);
	if (!dbBinding) {
		throw new Error(`No D1 database configured for hub in mode "${mode}"`);
	}

	const dbDir = getHubDir();
	const migrationsDir = getMigrationsDir();
	const total = countTotalMigrations();

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
		'list',
		dbBinding.binding,
		'--config',
		tmpConfigPath,
		isLocal ? '--local' : '--remote',
	];

	try {
		const output = runWrangler({ args, cwd: dbDir });
		const outputStr = output.toString();
		console.log(outputStr);

		const pending = countPendingMigrations(outputStr);
		const applied = total - pending;

		console.log(`db:status ${isLocal ? 'local' : mode} — ${applied}/${total} migration(s) applied${pending > 0 ? `, ${pending} pending` : ''}`);
		return { total, pending };
	} finally {
		const tmpDir = tmpConfigPath.substring(0, tmpConfigPath.lastIndexOf('/'));
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
		await listMigrations({ mode, isLocal });
	} catch (error) {
		console.error(`db:status failed: ${(error as Error).message}`);
		process.exit(1);
	}
};

const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
