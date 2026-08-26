// scripts/src/lib/deploy/__tests__/deployment_config.test.ts
//
// C-394 AC-5: the `database` deploy app is registered as a
// `database-migration` service type and its secrets resolve unprefixed.

import { describe, expect, test } from 'bun:test';
import {
  ALL_SERVICE_TYPES,
  APP_CONFIG,
  DEPLOYABLE_APPS,
} from '../deployment_config.ts';

describe('database app registration (AC-5)', () => {
  test('database-migration is a registered service type', () => {
    expect(ALL_SERVICE_TYPES).toContain('database-migration');
  });

  test('database is a deployable app of type database-migration with no build', () => {
    expect(DEPLOYABLE_APPS).toContain('database');
    const config = APP_CONFIG.database;
    expect(config.serviceType).toBe('database-migration');
    // Hosting/docker fields are meaningless for a migration job — must be
    // unset rather than filled with plausible-looking values.
    expect(config.needsDist).toBe(false);
    expect(config.shortName).toBe('');
    expect(config.imageName).toBeUndefined();
    expect(config.customDomains).toBeUndefined();
  });

  test('deploying the hub never triggers the database app implicitly', () => {
    // Each app names its own serviceType — hub is cloudflare-worker, so
    // deploying `hub` runs no migration. The coupling C-385 removed stays
    // removed.
    expect(APP_CONFIG.hub.serviceType).toBe('cloudflare-worker');
    expect(APP_CONFIG.database.serviceType).toBe('database-migration');
  });
});

describe('database app config', () => {
  test('database service type is database-migration', () => {
    expect(APP_CONFIG.database.serviceType).toBe('database-migration');
  });
});
