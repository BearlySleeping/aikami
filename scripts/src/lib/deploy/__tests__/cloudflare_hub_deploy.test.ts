// scripts/src/lib/deploy/__tests__/cloudflare_hub_deploy.test.ts
//
// C-426 AC-3: the hub is configured to deploy as a Cloudflare Worker (SSR),
// not Cloud Run. Verifies the deploy config, the wrangler.jsonc bindings, and
// the SvelteKit adapter swap — the three things that must be true for the hub
// to run on Workers with D1 + R2 reachable.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
});
