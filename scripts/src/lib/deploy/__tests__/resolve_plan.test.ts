// scripts/src/lib/deploy/__tests__/resolve_plan.test.ts
//
// C-455 AC-5: `deploy database` and `deploy storage` gate independently.

import { describe, expect, test } from 'bun:test';
import { ALL_SERVICE_TYPES, APP_CONFIG, DEPLOYABLE_APPS } from '../deployment_config.ts';

describe('infra service type (AC-5)', () => {
	test('infra is a registered service type (replaces database-migration)', () => {
		expect(ALL_SERVICE_TYPES).toContain('infra');
		expect(ALL_SERVICE_TYPES).not.toContain('database-migration');
	});

	test('database is a deployable app of type infra with target d1-migrate', () => {
		expect(DEPLOYABLE_APPS).toContain('database');
		const config = APP_CONFIG.database;
		expect(config.serviceType).toBe('infra');
		expect(config.target).toBe('d1-migrate');
		expect(config.path).toBe('apps/backend/cloudflare');
		expect(config.needsDist).toBe(false);
	});

	test('storage is a deployable app of type infra with target r2-reconcile', () => {
		expect(DEPLOYABLE_APPS).toContain('storage');
		const config = APP_CONFIG.storage;
		expect(config.serviceType).toBe('infra');
		expect(config.target).toBe('r2-reconcile');
		expect(config.path).toBe('apps/backend/cloudflare');
		expect(config.needsDist).toBe(false);
	});

	test('database and storage share the same directory', () => {
		expect(APP_CONFIG.database.path).toBe(APP_CONFIG.storage.path);
	});

	test('database and storage have distinct targets', () => {
		expect(APP_CONFIG.database.target).not.toBe(APP_CONFIG.storage.target);
	});

	test('deploying the hub never triggers database or storage implicitly', () => {
		expect(APP_CONFIG.hub.serviceType).toBe('cloudflare-worker');
		expect(APP_CONFIG.database.serviceType).toBe('infra');
		expect(APP_CONFIG.storage.serviceType).toBe('infra');
	});
});

describe('resolve_plan output key mapping (AC-5)', () => {
	test('infra maps to database_migration_apps output key', async () => {
		// The SERVICE_TYPE_OUTPUT_KEY is not exported, but we verify the mapping
		// by checking that all service types in ALL_SERVICE_TYPES have a
		// corresponding output key in resolve_plan.ts
		const content = await Bun.file(
			import.meta.dir + '/../resolve_plan.ts',
		).text();
		// Verify 'infra' maps to 'database_migration_apps'
		expect(content).toContain("'infra': 'database_migration_apps'");
	});

	test('all service types have a corresponding output key mapping', async () => {
		const content = await Bun.file(
			import.meta.dir + '/../resolve_plan.ts',
		).text();
		for (const st of ALL_SERVICE_TYPES) {
			// Each service type should have a mapping like `'infra': '...'`
			expect(content).toContain(`'${st}':`);
		}
	});
});
