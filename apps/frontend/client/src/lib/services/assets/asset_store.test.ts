// apps/frontend/client/src/lib/services/assets/asset_store.test.ts
// biome-ignore-all lint/style/useNamingConvention: mock properties mirror external API / enum names
//
// Unit tests for AssetStore tag → URL resolution (C-243, C-372, C-435).
//
// After C-435 the store is seeded from the compact boot seed fetched from R2.
// Every asset resolves to the content-addressed R2 object — nothing is bundled
// in the client anymore (C-435 follow-up). The offline-core declaration still
// controls eviction protection (pack_id = 'core') but does not affect URL
// resolution.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/assets/asset_store.test.ts

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CompactSeedDocument, OfflineCoreDeclaration } from '@aikami/types';

// $logger resolves to the SvelteKit sink which pulls $env at import time —
// mock it so the store loads cleanly in Bun.
mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

const R2_BASE = 'https://assets.bearlysleeping.com';

mock.module('@aikami/frontend/configs', () => ({
  publicEnv: { PUBLIC_ASSETS_BASE_URL: R2_BASE },
}));

import { LpcAnimationState } from '$lib/data/lpc_models';
import { lpcTag } from '$lib/data/lpc_tags';
import { assetStore } from './asset_store.svelte';

// ── Fixtures ──────────────────────────────────────────────────────────────

const HASH_APRON = 'a'.repeat(64);
const HASH_BODY = 'b'.repeat(64);
const HASH_MUSIC = 'c'.repeat(64);

const SEED: CompactSeedDocument = {
  sv: 1,
  g: '2026-08-23T00:00:00.000Z',
  o: R2_BASE,
  r: [
    {
      t: 'lpc:torso:aprons:apron_female:walk',
      h: HASH_APRON,
      s: 1024,
      c: 'lpc',
      e: '.webp',
    },
    { t: 'lpc:body:bodies_male:walk', h: HASH_BODY, s: 2048, c: 'lpc', e: '.webp' },
    { t: 'music:exploration:Chainsmoker', h: HASH_MUSIC, s: 4096, c: 'music', e: '.mp3' },
  ],
};

/** Only the default body ships in the client — the apron and music do not. */
const OFFLINE_CORE: OfflineCoreDeclaration = {
  schemaVersion: 1,
  tags: ['lpc:body:bodies_male:walk'],
  rationale: { 'lpc:body:bodies_male': 'Default player body' },
};

const r2Url = (hash: string, ext: string): string =>
  `${R2_BASE}/assets/${hash.slice(0, 2)}/${hash}${ext}`;

const originalFetch = globalThis.fetch;

/** Serves the two catalog documents the store fetches from R2 at boot. */
const stubCatalogFetch = (options?: { offlineCore?: boolean }): void => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${R2_BASE}/seed/asset_seed.json`) {
      return new Response(JSON.stringify(SEED), { status: 200 });
    }
    if (url === `${R2_BASE}/seed/offline_core.json`) {
      return options?.offlineCore === false
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(OFFLINE_CORE), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('assetStore catalog + resolveUrl (C-372, C-435)', () => {
  beforeEach(async () => {
    stubCatalogFetch();
    // rescanAssets drops the memoized load so each test re-reads the stub.
    await assetStore.rescanAssets();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rebuilds the manifest view from the compact seed', () => {
    expect(assetStore.manifest?.count).toBe(3);
    expect(assetStore.manifest?.assets['lpc:body:bodies_male:walk']).toEqual({
      tag: 'lpc:body:bodies_male:walk',
      category: 'lpc',
      subcategory: 'body',
      name: 'bodies_male.walk',
      path: 'lpc/body/bodies_male.walk.webp',
      ext: '.webp',
    });
    expect(assetStore.manifest?.byCategory.lpc).toHaveLength(2);
  });

  it('maps deep sub-slot assetIds (slash form) to colon tags', () => {
    expect(lpcTag('hair/bangslong2/bg_adult', LpcAnimationState.Shoot)).toBe(
      'lpc:hair:bangslong2:bg_adult:shoot',
    );
  });

  it('resolves all tags to the content-addressed R2 object (nothing is bundled)', () => {
    const url = assetStore.resolveUrl(lpcTag('body/bodies_male', LpcAnimationState.Walk));

    // Everything resolves to R2 — no bundled paths anymore.
    expect(url).toBe(r2Url(HASH_BODY, '.webp'));
    expect(url).toContain(R2_BASE);
    expect(url).not.toContain('/game-data/');
  });

  it('resolves a de-bundled LPC tag to the content-addressed R2 object', () => {
    const tag = lpcTag('torso/aprons/apron_female', LpcAnimationState.Walk);
    expect(tag).toBe('lpc:torso:aprons:apron_female:walk');

    // A /game-data/ URL here would 404 — the file is not in the build.
    expect(assetStore.resolveUrl(tag)).toBe(r2Url(HASH_APRON, '.webp'));
  });

  it('resolves de-bundled non-LPC tags through the same resolver', () => {
    expect(assetStore.resolveUrl('music:exploration:Chainsmoker')).toBe(r2Url(HASH_MUSIC, '.mp3'));
  });

  it('returns null for an unmapped tag', () => {
    expect(assetStore.resolveUrl(lpcTag('body/tail/cat_adult', LpcAnimationState.Walk))).toBeNull();
  });

  it('returns null for every asset when no publish origin is configured', async () => {
    mock.module('@aikami/frontend/configs', () => ({
      publicEnv: { PUBLIC_ASSETS_BASE_URL: '' },
    }));
    await assetStore.rescanAssets();

    // Without an origin, nothing can resolve — the catalog load itself fails.
    expect(assetStore.error).toBeTruthy();
    expect(assetStore.resolveUrl('music:exploration:Chainsmoker')).toBeNull();
    expect(assetStore.resolveUrl('lpc:body:bodies_male:walk')).toBeNull();

    mock.module('@aikami/frontend/configs', () => ({
      publicEnv: { PUBLIC_ASSETS_BASE_URL: R2_BASE },
    }));
  });

  it('degrades to remote-only resolution when the offline core is unavailable', async () => {
    stubCatalogFetch({ offlineCore: false });
    await assetStore.rescanAssets();

    expect(assetStore.coreTags.size).toBe(0);
    expect(assetStore.resolveUrl('lpc:body:bodies_male:walk')).toBe(r2Url(HASH_BODY, '.webp'));
  });

  it('records the error but keeps the last good catalog when a reload fails', async () => {
    globalThis.fetch = mock(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    await assetStore.rescanAssets();

    expect(assetStore.error).toBeTruthy();
    // A failed refresh must not blank out a catalog that was already working —
    // the player keeps rendering what they had.
    expect(assetStore.resolveUrl('lpc:body:bodies_male:walk')).toBe(r2Url(HASH_BODY, '.webp'));
    expect(assetStore.resolveUrl('sprites:unknown:thing')).toBeNull();
  });
});
