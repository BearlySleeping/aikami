// apps/backend/cloudflare/src/lib/db/seed.ts
//
// C-455: Seed the local D1 database with dev data.
// Ported from scripts/src/lib/ops/d1_seed_local.ts.
//
// Refuses to run against non-local state (CLOUDFLARE_API_TOKEN guard).
// Seeds one dev user, one pack, and one pack version. Idempotent.

import { resolve } from 'node:path';
import { D1_DATABASES, PORTS } from '@aikami/constants';
import { checkLocalMode } from '../wrangler.ts';

const ROOT = resolve(import.meta.dir, '../../../../../..');
const HUB_DIR = resolve(ROOT, 'apps/frontend/hub');
const DB_NAME = D1_DATABASES.hub.production.databaseName;
const HUB_WORKER_PORT = Number(process.env.PORT) || PORTS.emulator.hubWorker;
const HUB_WORKER_URL = `http://127.0.0.1:${HUB_WORKER_PORT}`;

// ── Seed data ───────────────────────────────────────────────
const DEV_USER = { name: 'Dev User', email: 'dev@localhost', password: 'dev-password-123' };
const DEV_PACK = {
	name: 'Dev Test Pack',
	slug: 'dev-test-pack',
	description: 'A local dev pack for testing',
};

// ── Helpers ─────────────────────────────────────────────────
const wrangler = async (
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
	const proc = Bun.spawn(['bunx', 'wrangler', ...args], {
		cwd: HUB_DIR,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
};

const d1Exec = async (
	command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
	wrangler(['d1', 'execute', DB_NAME, '--local', '--command', command, '--yes']);

const checkHubWorkerRunning = async (): Promise<void> => {
	try {
		const res = await fetch(`${HUB_WORKER_URL}/`, { signal: AbortSignal.timeout(2000) });
		if (!res.ok && res.status >= 500) {
			throw new Error(`hub-worker returned ${res.status}`);
		}
	} catch {
		console.error(`hub-worker does not appear to be running on :${HUB_WORKER_PORT}`);
		console.error('Start the hub-worker first:');
		console.error('  bun herdr:start hub-worker');
		console.error('Then run the seed:');
		console.error('  bun run db:seed:local');
		process.exit(1);
	}
};

const seedExists = async (): Promise<boolean> => {
	const { stdout: userCheck, exitCode: userExit } = await d1Exec(
		"SELECT COUNT(*) as cnt FROM user WHERE email = 'dev@localhost'",
	);
	if (userExit !== 0) {
		return false;
	}
	const userExists =
		userCheck.includes('"cnt":1') || userCheck.includes('cnt|1') || userCheck.includes('1');
	if (!userExists) {
		return false;
	}

	const { stdout: pvCheck, exitCode: pvExit } = await d1Exec(
		`SELECT COUNT(*) as cnt FROM pack_versions pv JOIN packs p ON p.id = pv.pack_id WHERE p.slug = '${DEV_PACK.slug}'`,
	);
	if (pvExit !== 0) {
		return false;
	}
	return pvCheck.includes('"cnt":1') || pvCheck.includes('cnt|1') || pvCheck.includes('1');
};

const createDevUser = async (): Promise<void> => {
	console.log('Creating dev user via Better Auth...');
	const res = await fetch(`${HUB_WORKER_URL}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(DEV_USER),
	});

	if (res.status === 200) {
		console.log(`Dev user created: ${DEV_USER.email}`);
		return;
	}

	if (res.status === 422) {
		console.log(`Dev user already exists: ${DEV_USER.email} (idempotent)`);
		return;
	}

	const body = await res.text().catch(() => '(no body)');
	console.error(`Failed to create dev user: HTTP ${res.status} — ${body}`);
	process.exit(1);
};

const createDevPack = async (): Promise<void> => {
	console.log('Creating dev pack...');

	const { stdout, exitCode } = await d1Exec(
		"SELECT id FROM user WHERE email = 'dev@localhost' LIMIT 1",
	);
	if (exitCode !== 0 || !stdout) {
		console.error('Could not find dev user in database');
		process.exit(1);
	}

	const userIdMatch =
		stdout.match(/(?:id\|([^\s]+)|"id":"([^"]+))/) ||
		stdout.match(/id[^a-zA-Z0-9]*([a-zA-Z0-9-]+)/);
	const userId = userIdMatch?.[1] || userIdMatch?.[2];
	if (!userId) {
		console.error(`Could not parse user ID from output: ${stdout}`);
		process.exit(1);
	}

	const { stdout: packCheck, exitCode: packCheckExit } = await d1Exec(
		`SELECT COUNT(*) as cnt FROM packs WHERE slug = '${DEV_PACK.slug}'`,
	);
	if (packCheckExit !== 0) {
		console.error('Failed to query packs table');
		process.exit(1);
	}
	if (packCheck.includes('"cnt":1') || packCheck.includes('cnt|1') || packCheck.includes('1')) {
		console.log(`Dev pack already exists: ${DEV_PACK.slug} (idempotent)`);
		return;
	}

	const now = Date.now();
	const packId = crypto.randomUUID();
	const { exitCode: packExit } = await d1Exec(
		`INSERT INTO packs (id, slug, owner_account_id, visibility, created_at, updated_at) ` +
			`VALUES ('${packId}', '${DEV_PACK.slug}', '${userId}', 'draft', ${now}, ${now})`,
	);
	if (packExit !== 0) {
		console.error('Failed to create dev pack');
		process.exit(1);
	}

	const versionId = crypto.randomUUID();
	const fakeManifestHash = '0000000000000000000000000000000000000000000000000000000000000000';
	const { exitCode: versionExit } = await d1Exec(
		`INSERT INTO pack_versions (id, pack_id, version, manifest_hash, created_at) ` +
			`VALUES ('${versionId}', '${packId}', '1', '${fakeManifestHash}', ${now})`,
	);
	if (versionExit !== 0) {
		console.error('Failed to create dev pack version');
		process.exit(1);
	}

	console.log(`Dev pack created: ${DEV_PACK.name} (version 1)`);
};

// ── Main ────────────────────────────────────────────────────
const main = async (): Promise<void> => {
	console.log('D1 Local Seed');
	console.log('─────────────');

	checkLocalMode();
	console.log('Local mode confirmed');

	await checkHubWorkerRunning();
	console.log(`hub-worker is running on :${HUB_WORKER_PORT}`);

	if (await seedExists()) {
		console.log('Seed data already exists — nothing to do (idempotent)');
		process.exit(0);
	}

	await createDevUser();
	await createDevPack();

	console.log('');
	console.log('Seed complete!');
	console.log('You can now sign in with:');
	console.log(`  Email:    ${DEV_USER.email}`);
	console.log(`  Password: ${DEV_USER.password}`);
};


const isMainModule = import.meta.path === Bun.main;
if (isMainModule) {
	main();
}
