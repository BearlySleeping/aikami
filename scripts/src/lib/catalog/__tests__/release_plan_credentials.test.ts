// scripts/src/lib/catalog/__tests__/release_plan_credentials.test.ts
//
// "Show me exactly what would happen" must not require "I can make it happen".
//
// Before this split, `resolveCatalogConfig` — which demands R2 write
// credentials — ran before plan mode, so reviewing a plan required the ability
// to execute it. That coupled a read-only question to a write capability and
// made the two failure modes indistinguishable:
//
//   origin not provisioned   (staging today — genuinely external)
//   write credentials absent (an operator or CI limitation)
//
// These tests pin the separation. `resolveCatalogTarget` answers the read-only
// question and needs no credentials; `resolveCatalogConfig` adds them and is
// the only thing a writing path should call.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { CATALOG_ORIGINS } from '@aikami/constants';
import { resolveCatalogConfig, resolveCatalogTarget } from '../config.ts';

const PRODUCTION_ORIGIN = CATALOG_ORIGINS.production.originUrl;
const PRODUCTION_BUCKET = CATALOG_ORIGINS.production.bucketName;

/** Every env key the catalog config reads. */
const MANAGED_KEYS = [
  'CATALOG_BUCKET',
  'CATALOG_ORIGIN_URL',
  'CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID',
  'CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY',
  'CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT',
  'AIKAMI_CATALOG_TEST_SEAM',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = saved[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/** A correctly configured production target with NO write credentials. */
const configureProductionReadOnly = (): void => {
  process.env.CATALOG_ORIGIN_URL = PRODUCTION_ORIGIN;
  process.env.CATALOG_BUCKET = PRODUCTION_BUCKET;
};

describe('release target resolution needs no write credentials', () => {
  test('a correctly configured production target resolves read-only', () => {
    configureProductionReadOnly();
    const target = resolveCatalogTarget('production');
    expect(target.bucket).toBe(PRODUCTION_BUCKET);
    expect(target.originUrl).toBe(PRODUCTION_ORIGIN);
    expect(target.releaseTarget.mode).toBe('production');
  });

  test('the same environment cannot produce a write config without credentials', () => {
    configureProductionReadOnly();
    expect(() => resolveCatalogConfig('production')).toThrow(/Catalog publish config missing/);
  });

  test('the credential error names the missing keys, not the target', () => {
    configureProductionReadOnly();
    let message = '';
    try {
      resolveCatalogConfig('production');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID');
    expect(message).toContain('CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY');
    expect(message).toContain('CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT');
    // The target itself was fine — the failure is purely about credentials.
    expect(message).not.toContain('origin');
  });

  test('write credentials make the write config resolvable', () => {
    configureProductionReadOnly();
    process.env.CLOUD_FLARE_CATALOG_BUCKET_ACCESS_KEY_ID = 'test-key';
    process.env.CLOUD_FLARE_CATALOG_BUCKET_SECRET_ACCESS_KEY = 'test-secret';
    process.env.CLOUD_FLARE_CATALOG_BUCKET_ENDPOINT = 'https://example.test';
    const config = resolveCatalogConfig('production');
    expect(config.bucket).toBe(PRODUCTION_BUCKET);
    expect(config.originUrl).toBe(PRODUCTION_ORIGIN);
  });
});

describe('staging fails closed on its unprovisioned origin, not on credentials', () => {
  test('staging has no declared public origin in the shipped table', () => {
    // The premise of the test below. If this ever becomes non-null, staging
    // has been provisioned and the fail-closed case must be re-derived.
    expect(CATALOG_ORIGINS.staging.originUrl).toBeNull();
  });

  test('a staging target is refused even with a plausible origin configured', () => {
    process.env.CATALOG_ORIGIN_URL = 'https://staging-assets.example.test';
    process.env.CATALOG_BUCKET = CATALOG_ORIGINS.staging.bucketName;
    expect(() => resolveCatalogTarget('staging')).toThrow(/originUrl is null|not provisioned/i);
  });

  test('staging cannot be pointed at the production origin', () => {
    process.env.CATALOG_ORIGIN_URL = PRODUCTION_ORIGIN;
    process.env.CATALOG_BUCKET = CATALOG_ORIGINS.staging.bucketName;
    expect(() => resolveCatalogTarget('staging')).toThrow();
  });

  test('staging cannot silently adopt the production bucket', () => {
    process.env.CATALOG_ORIGIN_URL = 'https://staging-assets.example.test';
    process.env.CATALOG_BUCKET = PRODUCTION_BUCKET;
    expect(() => resolveCatalogTarget('staging')).toThrow(/disagrees with the bucket declared/);
  });
});
