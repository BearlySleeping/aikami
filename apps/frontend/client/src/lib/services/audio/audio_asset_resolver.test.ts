// apps/frontend/client/src/lib/services/audio/audio_asset_resolver.test.ts
//
// C-511 AC-3 — a generated audio asset is resolvable through the existing
// tag registry, with no network.
//
// C-513 AC-10 — an *imported community* audio asset resolves too, including
// after a reload with networking blocked. The manifest the resolver searches is
// the boot-seed catalog (a build artifact published from R2), so it can never
// contain a community import: the on-device registry is the only place that tag
// exists. These cases drive that second source.
//
// Both `assetStore` and the local registry seam are mocked. The mocked
// `resolveUrl` returns a synthetic blob URL — the resolver must return THAT url,
// not merely a non-null value — and the local seam records every tag it is
// asked about, so "the registry was actually consulted" is asserted rather than
// assumed.
//
// Contract: C-511 Local Audio Generation Modality, C-513 AC-10

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AssetEntry, AssetManifest } from '@aikami/types';

let manifest: AssetManifest | undefined;
let resolveUrlCalls: string[] = [];

/** Owned tags per category, as the local registry would report them. */
let localTags: Partial<Record<'music' | 'sfx' | 'ambient', readonly string[]>> = {};
/** URL per owned tag; a tag absent here resolves to null (uncacheable). */
let localUrls = new Map<string, string>();
let listTagsCalls: string[] = [];
let resolveLocalCalls: string[] = [];
/** Set to make the registry unavailable (a device with no local DB). */
let listTagsThrows = false;

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

mock.module('./audio_local_source.ts', () => ({
  localAudioSource: {
    listTags: async (category: 'music' | 'sfx' | 'ambient') => {
      listTagsCalls.push(category);
      if (listTagsThrows) {
        throw new Error('registry unavailable');
      }
      return localTags[category] ?? [];
    },
    resolve: async (tag: string) => {
      resolveLocalCalls.push(tag);
      return localUrls.get(tag) ?? null;
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
    localTags = {};
    localUrls = new Map();
    listTagsCalls = [];
    resolveLocalCalls = [];
    listTagsThrows = false;
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
    // The curated catalog answered, so the on-device registry was not needed.
    expect(listTagsCalls).toEqual([]);
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

describe('audio_asset_resolver — C-513 AC-10 community import, offline after reload', () => {
  beforeEach(() => {
    manifest = undefined;
    resolveUrlCalls = [];
    localTags = {};
    localUrls = new Map();
    listTagsCalls = [];
    resolveLocalCalls = [];
    listTagsThrows = false;
  });

  /**
   * The post-reload offline state: the seed fetch failed, so there is no
   * manifest at all, and the only thing that knows the imported tag is the
   * on-device registry.
   */
  test('a community-imported music tag plays from the registry with no manifest', async () => {
    manifest = undefined;
    localTags = { music: ['music:community:tavern-theme'] };
    localUrls = new Map([['music:community:tavern-theme', 'blob:cached/tavern-theme']]);

    const url = await resolveBgmUrl('explore');

    expect(url).toBe('blob:cached/tavern-theme');
    // The registry was consulted for music, and the resolved URL is the cached
    // blob — not an origin/R2 URL that would need the network.
    expect(listTagsCalls).toEqual(['music']);
    expect(resolveLocalCalls).toEqual(['music:community:tavern-theme']);
    expect(url?.startsWith('blob:')).toBe(true);
  });

  test('a scene-matching imported track is preferred over an unrelated one', async () => {
    localTags = { music: ['music:community:ambient-hum', 'music:combat:battle-drums'] };
    localUrls = new Map([
      ['music:community:ambient-hum', 'blob:cached/ambient-hum'],
      ['music:combat:battle-drums', 'blob:cached/battle-drums'],
    ]);

    // The combat scene matches on the `combat` segment; the first owned tag is
    // an unrelated community upload, so tag matching must win over ordering.
    expect(await resolveBgmUrl('combat')).toBe('blob:cached/battle-drums');
    expect(resolveLocalCalls).toEqual(['music:combat:battle-drums']);
  });

  test('an unrelated imported track is still playable (music degrades to some track)', async () => {
    localTags = { music: ['music:community:tavern-theme'] };
    localUrls = new Map([['music:community:tavern-theme', 'blob:cached/tavern-theme']]);

    expect(await resolveBgmUrl('combat')).toBe('blob:cached/tavern-theme');
  });

  test('the curated catalog still outranks an imported tag', async () => {
    manifest = manifestWith([
      entryFor({ tag: 'music:exploration:shipped', category: 'music', subcategory: 'exploration' }),
    ]);
    localTags = { music: ['music:community:imported'] };
    localUrls = new Map([['music:community:imported', 'blob:cached/imported']]);

    expect(await resolveBgmUrl('explore')).toBe('blob:mock/music:exploration:shipped');
    expect(listTagsCalls).toEqual([]);
  });

  test('an imported SFX resolves by name segment', async () => {
    localTags = { sfx: ['sfx:community:gate-slam'] };
    localUrls = new Map([['sfx:community:gate-slam', 'blob:cached/gate-slam']]);

    expect(await resolveSfxUrl('gate-slam')).toBe('blob:cached/gate-slam');
  });

  test('an unmatched SFX refuses to play an arbitrary imported sound', async () => {
    localTags = { sfx: ['sfx:community:gate-slam'] };
    localUrls = new Map([['sfx:community:gate-slam', 'blob:cached/gate-slam']]);

    // Wrong sound is worse than silence — the sfx path has no first-tag
    // fallback, unlike music/ambient.
    expect(await resolveSfxUrl('coin-pickup')).toBeNull();
    expect(resolveLocalCalls).toEqual([]);
  });

  test('an imported ambient resolves by tag', async () => {
    localTags = { ambient: ['ambient:community:forest-canopy'] };
    localUrls = new Map([['ambient:community:forest-canopy', 'blob:cached/forest-canopy']]);

    expect(await resolveAmbientUrl('forest-canopy')).toBe('blob:cached/forest-canopy');
  });

  test('a tag the device owns but cannot serve resolves to null, never an origin URL', async () => {
    localTags = { music: ['music:community:tavern-theme'] };
    localUrls = new Map(); // no cached bytes

    expect(await resolveBgmUrl('explore')).toBeNull();
  });

  test('an unavailable registry degrades to null instead of throwing', async () => {
    listTagsThrows = true;
    expect(await resolveBgmUrl('explore')).toBeNull();
    expect(await resolveSfxUrl('gate-slam')).toBeNull();
    expect(await resolveAmbientUrl('forest')).toBeNull();
  });

  test('a device with no local audio at all resolves to null', async () => {
    localTags = {};
    expect(await resolveBgmUrl('explore')).toBeNull();
    expect(await resolveSfxUrl('gate-slam')).toBeNull();
    expect(await resolveAmbientUrl('forest')).toBeNull();
    expect(resolveLocalCalls).toEqual([]);
  });
});
