// apps/frontend/client/src/lib/services/audio/audio_asset_resolver.test.ts
//
// C-511 AC-3 — a generated audio asset is resolvable through the existing
// tag registry, with no network.
//
// The generated `GeneratedAsset` descriptor (produced by the shared client and
// written by `assetManager.registerGenerated`) becomes a manifest entry; this
// test drives the resolver with exactly the entry shape `runAssetGeneration`
// + `toGeneratedAsset` produce for the shipped audio recipes, so the
// recipe `tagTemplate` → resolver match is asserted end to end.
//
// `assetStore` is mocked: the real one fetches the R2 seed, which is the
// network dependency this AC is about. The mocked `resolveUrl` returns a
// synthetic blob URL — the resolver must return THAT url, not merely a
// non-null value.
//
// Contract: C-511 Local Audio Generation Modality

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AssetEntry, AssetManifest } from '@aikami/types';

let manifest: AssetManifest | undefined;
let resolveUrlCalls: string[] = [];

mock.module('../assets/asset_store.svelte.ts', () => ({
  assetStore: {
    get manifest() {
      return manifest;
    },
    fetchManifest: mock(async () => undefined),
    resolveUrl: (tag: string) => {
      resolveUrlCalls.push(tag);
      return `blob:mock/${tag}`;
    },
  },
}));

const { resolveAmbientUrl, resolveBgmUrl, resolveSfxUrl } = await import(
  './audio_asset_resolver.ts'
);

/** The manifest entry shape `runAssetGeneration` produces for a recipe tag. */
const entryFor = (options: { tag: string; category: string; subcategory: string }): AssetEntry => {
  const path = `${options.tag.split(':').join('/')}.wav`;
  const filename = path.split('/').at(-1) ?? path;
  return {
    tag: options.tag,
    category: options.category,
    subcategory: options.subcategory,
    name: filename.replace(/\.wav$/, ''),
    path,
    ext: '.wav',
  };
};

const manifestWith = (entries: readonly AssetEntry[]): AssetManifest => {
  const byCategory: AssetManifest['byCategory'] = {};
  for (const entry of entries) {
    byCategory[entry.category] = [...(byCategory[entry.category] ?? []), entry];
  }
  return {
    scannedAt: '2026-09-12T00:00:00.000Z',
    count: entries.length,
    assets: Object.fromEntries(entries.map((entry) => [entry.tag, entry])),
    byCategory,
  };
};

describe('audio_asset_resolver — C-511 generated audio', () => {
  beforeEach(() => {
    manifest = undefined;
    resolveUrlCalls = [];
  });

  test('resolveBgmUrl returns the generated exploration track URL', async () => {
    // The `music` recipe's tagTemplate is `music:exploration:{{slug}}`, so
    // `generate:asset music "calm forest loop"` lands here with the
    // `exploration` segment the explore scene matches on.
    const entry = entryFor({
      tag: 'music:exploration:calm-forest-loop',
      category: 'music',
      subcategory: 'exploration',
    });
    manifest = manifestWith([entry]);

    const url = await resolveBgmUrl('explore');
    expect(url).toBe('blob:mock/music:exploration:calm-forest-loop');
    expect(resolveUrlCalls).toEqual(['music:exploration:calm-forest-loop']);
  });

  test('resolveBgmUrl still resolves when only a non-matching scene exists', async () => {
    // No combat track was generated — the resolver falls back to the first
    // music entry rather than returning null (a 404-free degradation).
    manifest = manifestWith([
      entryFor({
        tag: 'music:exploration:calm-forest-loop',
        category: 'music',
        subcategory: 'exploration',
      }),
    ]);

    const url = await resolveBgmUrl('combat');
    expect(url).toBe('blob:mock/music:exploration:calm-forest-loop');
  });

  test('resolveSfxUrl returns the generated effect URL by slug', async () => {
    manifest = manifestWith([
      entryFor({ tag: 'sfx:metal-gate-slam', category: 'sfx', subcategory: '' }),
    ]);

    const url = await resolveSfxUrl('metal-gate-slam');
    expect(url).toBe('blob:mock/sfx:metal-gate-slam');
  });

  test('resolveAmbientUrl returns the generated ambient URL', async () => {
    manifest = manifestWith([
      entryFor({ tag: 'ambient:forest-canopy', category: 'ambient', subcategory: '' }),
    ]);

    const url = await resolveAmbientUrl('forest-canopy');
    expect(url).toBe('blob:mock/ambient:forest-canopy');
  });

  test('returns null when no generated audio exists (no network fallback)', async () => {
    manifest = manifestWith([]);
    expect(await resolveBgmUrl('explore')).toBeNull();
    expect(await resolveSfxUrl('metal-gate-slam')).toBeNull();
    expect(await resolveAmbientUrl('forest')).toBeNull();
    expect(resolveUrlCalls).toEqual([]);
  });
});
