// scripts/src/lib/deploy/__tests__/cloudflare_hub_deploy.test.ts
//
// C-426 AC-3: the hub is configured to deploy as a Cloudflare Worker (SSR),
// not Cloud Run. Verifies the deploy config, the wrangler.jsonc bindings, and
// the SvelteKit adapter swap — the three things that must be true for the hub
// to run on Workers with D1 + R2 reachable.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectWorkerSecrets, writeWranglerConfig } from '../cloudflare.ts';
import { APP_CONFIG } from '../deployment_config.ts';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..');

describe('hub Cloudflare Worker deploy config (AC-3)', () => {
  test('hub serviceType is cloudflare-worker with assetsOnly: false and a main entry', () => {
    const hub = APP_CONFIG.hub;
    expect(hub.serviceType).toBe('cloudflare-worker');
    expect(hub.cloudflare).toBeDefined();
    expect(hub.cloudflare?.assetsOnly).toBe(false);
    if (hub.cloudflare && hub.cloudflare.assetsOnly === false) {
      expect(hub.cloudflare.main).toBeTruthy();
    }
    expect(hub.cloudflare?.routes.production).toBe('hub.bearlysleeping.com');
  });

  test('hub wrangler.jsonc declares DB (D1) and SAVES_BUCKET (R2) bindings', () => {
    const wrangler = readFileSync(join(repoRoot, 'apps/frontend/hub/wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"DB"');
    expect(wrangler).toContain('"SAVES_BUCKET"');
    expect(wrangler).toContain('"d1_databases"');
    expect(wrangler).toContain('"r2_buckets"');
    expect(wrangler).toContain('"main"');
  });

  test('the generated hub config binds every R2 plane, per mode', () => {
    // `writeWranglerConfig` REPLACES the whole `r2_buckets` array, so whatever
    // `cloudflare.r2Buckets(mode)` returns is the complete binding set. It used
    // to return only SAVES_BUCKET, which silently dropped CATALOG_BUCKET and
    // UPLOADS_BUCKET from the deployed Worker — and the hub's community-asset
    // paths require all three (`asset_community_env.ts`).
    const appRoot = mkdtempSync(join(tmpdir(), 'aikami-hub-r2-'));
    try {
      type Generated = { r2_buckets?: Array<{ binding: string; bucket_name: string }> };
      const generated = (mode: string): Generated =>
        JSON.parse(
          readFileSync(writeWranglerConfig(APP_CONFIG.hub, appRoot, mode), 'utf8'),
        ) as Generated;
      const bindings = (config: Generated): string[] =>
        (config.r2_buckets ?? []).map((entry) => entry.binding);
      const bucketFor = (config: Generated, binding: string): string | undefined =>
        (config.r2_buckets ?? []).find((entry) => entry.binding === binding)?.bucket_name;

      const staging = generated('staging');
      const production = generated('production');

      expect(bindings(staging)).toEqual(['SAVES_BUCKET', 'CATALOG_BUCKET', 'UPLOADS_BUCKET']);
      expect(bindings(production)).toEqual(['SAVES_BUCKET', 'CATALOG_BUCKET', 'UPLOADS_BUCKET']);

      expect(bucketFor(staging, 'CATALOG_BUCKET')).toBe('aikami-staging-catalog');
      expect(bucketFor(production, 'CATALOG_BUCKET')).toBe('aikami-catalog');
      expect(bucketFor(staging, 'SAVES_BUCKET')).toBe('aikami-staging-saves');
      expect(bucketFor(production, 'SAVES_BUCKET')).toBe('aikami-saves');
      expect(bucketFor(staging, 'CATALOG_BUCKET')).not.toBe(
        bucketFor(production, 'CATALOG_BUCKET'),
      );
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  test('hub vite.config.ts uses @sveltejs/adapter-cloudflare', () => {
    const config = readFileSync(join(repoRoot, 'apps/frontend/hub/vite.config.ts'), 'utf8');
    expect(config).toContain('@sveltejs/adapter-cloudflare');
    expect(config).not.toContain('svelte-adapter-bun');
  });

  test('hub app.d.ts declares Platform.env with DB and SAVES_BUCKET', () => {
    const appDts = readFileSync(join(repoRoot, 'apps/frontend/hub/src/app.d.ts'), 'utf8');
    expect(appDts).toContain('DB');
    expect(appDts).toContain('SAVES_BUCKET');
    expect(appDts).toContain('D1Database');
    expect(appDts).toContain('R2Bucket');
  });

  test('generated wrangler config enables nodejs_als (required by the adapter cloudflare:workers shim)', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'aikami-hub-deploy-'));
    try {
      const configPath = writeWranglerConfig(APP_CONFIG.hub, appRoot, 'staging');
      const generated = JSON.parse(readFileSync(configPath, 'utf8')) as {
        compatibility_flags?: string[];
        d1_databases?: Array<{ binding: string }>;
        r2_buckets?: Array<{ binding: string }>;
      };
      // Without nodejs_als the adapter's `node:async_hooks` AsyncLocalStorage
      // shim cannot load under workerd. Without the D1/R2 bindings (and with
      // @sveltejs/adapter-cloudflare 8 no longer populating event.platform) the
      // hub cannot reach either data plane.
      expect(generated.compatibility_flags).toContain('nodejs_als');
      expect(generated.compatibility_flags).toContain('nodejs_compat');
      expect(generated.d1_databases?.map((d) => d.binding)).toContain('DB');
      expect(generated.r2_buckets?.map((r) => r.binding)).toContain('SAVES_BUCKET');
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });
});

describe('hub runtime secrets reach the deployed Worker (C-426 AC-4)', () => {
  test('collectWorkerSecrets picks the non-PUBLIC, non-var keys declared in .env.example', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'aikami-hub-secrets-'));
    try {
      // A trimmed-down stand-in for the real .env.example / .env.staging pair,
      // exercising every branch: PUBLIC_ excluded, var-backed keys excluded,
      // empty values skipped, real secrets included.
      writeFileSync(
        join(appRoot, '.env.example'),
        [
          'PUBLIC_APP_ID=hub',
          'PUBLIC_MODE=production',
          'APP_ID=hub',
          'LOG_LEVEL=',
          'CATALOG_ORIGIN_URL=',
          'BETTER_AUTH_SECRET=',
          'BETTER_AUTH_URL=',
          'GOOGLE_CLIENT_ID=',
          'GOOGLE_CLIENT_SECRET=',
          'OPENROUTER_API_KEY=',
          'OPENROUTER_MODEL=',
        ].join('\n'),
        'utf-8',
      );
      writeFileSync(
        join(appRoot, '.env.staging'),
        [
          'PUBLIC_APP_ID=hub',
          'PUBLIC_MODE=staging',
          'APP_ID=hub',
          'LOG_LEVEL=DEBUG',
          'CATALOG_ORIGIN_URL=https://assets.bearlysleeping.com',
          'BETTER_AUTH_SECRET=staging-signing-secret',
          'BETTER_AUTH_URL=https://hub.stg.bearlysleeping.com',
          'GOOGLE_CLIENT_ID=staging-client-id',
          'GOOGLE_CLIENT_SECRET=staging-client-secret',
          'OPENROUTER_API_KEY=staging-openrouter-key',
          'OPENROUTER_MODEL=some/model:free',
        ].join('\n'),
        'utf-8',
      );

      const secrets = collectWorkerSecrets(appRoot, 'staging');

      // The auth stack is the whole point: without these in the Worker env the
      // hub returns auth_unconfigured and sign-in 503s.
      expect(secrets.BETTER_AUTH_SECRET).toBe('staging-signing-secret');
      expect(secrets.BETTER_AUTH_URL).toBe('https://hub.stg.bearlysleeping.com');
      expect(secrets.GOOGLE_CLIENT_ID).toBe('staging-client-id');
      expect(secrets.GOOGLE_CLIENT_SECRET).toBe('staging-client-secret');
      expect(secrets.OPENROUTER_API_KEY).toBe('staging-openrouter-key');
      // Vars supplied via cloudflare.vars must NOT be uploaded as secrets —
      // wrangler rejects a name that is both.
      expect(secrets.LOG_LEVEL).toBeUndefined();
      expect(secrets.CATALOG_ORIGIN_URL).toBeUndefined();
      // PUBLIC_ values are build-time only.
      expect(secrets.PUBLIC_MODE).toBeUndefined();
      expect(secrets.PUBLIC_APP_ID).toBeUndefined();
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  test('missing or empty optional secrets are skipped, never uploaded as empty strings', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'aikami-hub-secrets-empty-'));
    try {
      writeFileSync(
        join(appRoot, '.env.example'),
        'BETTER_AUTH_SECRET=\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n',
        'utf-8',
      );
      writeFileSync(
        join(appRoot, '.env.production'),
        'BETTER_AUTH_SECRET=prod-secret\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n',
        'utf-8',
      );

      const secrets = collectWorkerSecrets(appRoot, 'production');
      expect(secrets.BETTER_AUTH_SECRET).toBe('prod-secret');
      expect('GOOGLE_CLIENT_ID' in secrets).toBe(false);
      expect('GOOGLE_CLIENT_SECRET' in secrets).toBe(false);
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });
});
