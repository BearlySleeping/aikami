// apps/frontend/client/tests/tauri_catalog_origins.test.ts
//
// The packaged desktop build is a first-class catalog consumer: it fetches
// assets straight from the catalog origin for whichever mode it was built for.
// Three separate allowlists have to name that origin —
//
//   - CSP `connect-src`      (fetch/XHR of index + seed documents)
//   - CSP `img-src`          (PixiJS textures and <img> portraits)
//   - Tauri `http:allow-fetch` capability
//
// — and all three previously named only production, so a staging desktop build
// was blocked from its own catalog. These tests fail if any of them drifts back
// to a single hardcoded origin.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { CATALOG_ORIGINS } from '@aikami/constants';

const CLIENT_DIR = join(import.meta.dirname, '..');

const tauriConf = JSON.parse(
  readFileSync(join(CLIENT_DIR, 'src-tauri/tauri.conf.json'), 'utf8'),
) as { app: { security: { csp: string } } };
const capabilities = JSON.parse(
  readFileSync(join(CLIENT_DIR, 'src-tauri/capabilities/default.json'), 'utf8'),
) as { permissions: unknown[] };

const csp = tauriConf.app.security.csp;

/** One CSP directive, e.g. `connect-src 'self' …`. */
const directive = (name: string): string => csp.match(new RegExp(`${name} [^;]+`))?.[0] ?? '';

/** Every origin the client could legitimately be built against. */
const provisionedOrigins: string[] = Object.values(CATALOG_ORIGINS)
  .map((entry) => entry.originUrl)
  .filter((url): url is string => typeof url === 'string' && url.length > 0);

/** URLs the `http:allow-fetch` capability permits. */
const allowedFetchUrls: string[] = capabilities.permissions
  .filter(
    (permission): permission is { identifier: string; allow?: { url: string }[] } =>
      typeof permission === 'object' && permission !== null && 'identifier' in permission,
  )
  .filter((permission) => permission.identifier === 'http:allow-fetch')
  .flatMap((permission) => (permission.allow ?? []).map((entry) => entry.url));

describe('Tauri allowlists cover every provisioned catalog origin', () => {
  test('there is more than one provisioned origin to cover', () => {
    // If this ever drops to one, every per-origin assertion below becomes
    // vacuous and the suite would pass while covering nothing.
    expect(provisionedOrigins.length).toBeGreaterThan(1);
  });

  test('staging and production do not share a catalog origin', () => {
    expect(CATALOG_ORIGINS.staging.originUrl).not.toBe(CATALOG_ORIGINS.production.originUrl);
  });

  for (const origin of provisionedOrigins) {
    test(`connect-src allows ${origin}`, () => {
      expect(directive('connect-src')).toContain(origin);
    });

    test(`img-src allows ${origin}`, () => {
      expect(directive('img-src')).toContain(origin);
    });

    test(`http:allow-fetch allows ${origin}`, () => {
      expect(allowedFetchUrls).toContain(`${origin}/**`);
    });
  }
});
