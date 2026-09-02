// scripts/src/lib/deploy/__tests__/resolve_plan.test.ts
//
// C-455 AC-5: `deploy database` and `deploy storage` gate independently.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ALL_SERVICE_TYPES, APP_CONFIG, DEPLOYABLE_APPS } from '../deployment_config.ts';

const runResolvePlan = (deployApps: string): string => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'aikami-resolve-plan-'));
  const outputPath = join(fixtureDir, 'github-output.txt');

  try {
    const result = Bun.spawnSync(
      [process.execPath, resolve(import.meta.dir, '../resolve_plan.ts')],
      {
        env: { ...process.env, DEPLOY_APPS: deployApps, GITHUB_OUTPUT: outputPath },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(result.exitCode).toBe(0);
    return readFileSync(outputPath, 'utf8');
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};

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
  test('infra fixtures map to database_migration_apps independently', () => {
    const fixtures = [
      { deployApps: 'database', expected: 'database' },
      { deployApps: 'storage', expected: 'storage' },
      { deployApps: 'database storage', expected: 'database storage' },
    ];

    for (const fixture of fixtures) {
      const output = runResolvePlan(fixture.deployApps);
      expect(output).toContain(`database_migration_apps=${fixture.expected}\n`);
    }
  });

  test('all service types emit their deployment output key', () => {
    const output = runResolvePlan('all');
    const expectedKeys = [
      'desktop_apps=',
      'cloudflare_apps=',
      'docker_release_apps=',
      'database_migration_apps=',
    ];

    expect(expectedKeys).toHaveLength(ALL_SERVICE_TYPES.length);
    for (const key of expectedKeys) {
      expect(output).toContain(key);
    }
  });
});
