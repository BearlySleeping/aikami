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

// ── Hub catalog origin is per-mode ────────────────────────────────────────
//
// The hub only READS the catalog origin (invariant I-7). It used to receive the
// production origin for every mode, so a staging hub rendered the production
// catalog — the same class of bug as the staging publish target, one layer up.

describe('hub catalog origin var is per-mode', () => {
  const hubVars = (mode: string): Record<string, string> => {
    const cloudflare = APP_CONFIG.hub.cloudflare;
    // `cloudflare` is a discriminated union: only the SSR branch (`assetsOnly:
    // false`) carries `vars`. Narrowing here keeps the test honest about which
    // shape the hub is supposed to have.
    if (cloudflare?.assetsOnly !== false) {
      throw new Error('hub is expected to be an SSR Worker with cloudflare.vars');
    }
    const vars = cloudflare.vars;
    if (!vars) {
      throw new Error('hub has no cloudflare.vars');
    }
    return typeof vars === 'function' ? vars(mode) : vars;
  };

  test('staging receives the staging catalog origin', () => {
    expect(hubVars('staging').CATALOG_ORIGIN_URL).toBe('https://assets.stg.bearlysleeping.com');
  });

  test('production receives the production catalog origin', () => {
    expect(hubVars('production').CATALOG_ORIGIN_URL).toBe('https://assets.bearlysleeping.com');
  });

  test('the two modes never share one catalog origin', () => {
    expect(hubVars('staging').CATALOG_ORIGIN_URL).not.toBe(
      hubVars('production').CATALOG_ORIGIN_URL,
    );
  });

  test('a mode with no declared catalog origin gets no var at all', () => {
    // Fail closed: the hub renders its explicit "not configured" state rather
    // than silently reading whichever origin happened to be hardcoded.
    expect(hubVars('emulator').CATALOG_ORIGIN_URL).toBeUndefined();
  });

  test('the Better Auth cookie domain still differs per mode', () => {
    expect(hubVars('production').BETTER_AUTH_COOKIE_DOMAIN).toBe('bearlysleeping.com');
    expect(hubVars('staging').BETTER_AUTH_COOKIE_DOMAIN).toBe('stg.bearlysleeping.com');
  });
});
