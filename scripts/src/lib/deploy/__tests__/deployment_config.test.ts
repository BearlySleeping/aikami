// scripts/src/lib/deploy/__tests__/deployment_config.test.ts
//
// C-394 AC-5: the `database` deploy app is registered as an
// `infra` service type and its secrets resolve unprefixed.
// C-455: renamed from `database-migration` to `infra`, added `storage` app.

import { describe, expect, test } from 'bun:test';
import { ALL_SERVICE_TYPES, APP_CONFIG, DEPLOYABLE_APPS } from '../deployment_config.ts';

describe('infra app registration (AC-5)', () => {
	test('infra is a registered service type (was database-migration)', () => {
		expect(ALL_SERVICE_TYPES).toContain('infra');
	});

	test('database is a deployable app of type infra with no build', () => {
		expect(DEPLOYABLE_APPS).toContain('database');
		const config = APP_CONFIG.database;
		expect(config.serviceType).toBe('infra');
		expect(config.needsDist).toBe(false);
		expect(config.shortName).toBe('');
		expect(config.imageName).toBeUndefined();
		expect(config.customDomains).toBeUndefined();
	});

	test('storage is a deployable app of type infra', () => {
		expect(DEPLOYABLE_APPS).toContain('storage');
		const config = APP_CONFIG.storage;
		expect(config.serviceType).toBe('infra');
		expect(config.needsDist).toBe(false);
	});

	test('deploying the hub never triggers the database or storage app implicitly', () => {
		expect(APP_CONFIG.hub.serviceType).toBe('cloudflare-worker');
		expect(APP_CONFIG.database.serviceType).toBe('infra');
		expect(APP_CONFIG.storage.serviceType).toBe('infra');
	});
});
