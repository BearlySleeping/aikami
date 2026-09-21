// apps/frontend/client/src/lib/data/npc_avatar_catalog_pack.test.ts
//
// Pack-authored portraits must resolve BEFORE every generic stand-in.
//
// Before this, the Emberwatch cast had no portraits at all and fell through to
// the legacy sprite map — Elder Thalia rendered as `gandalf`, Rollo as `orc`.
// The pack manifest now declares its own busts; this pins that they win, that
// the emotion falls back to `neutral`, and that an unresolvable declaration is
// reported and skipped rather than rendered as a broken image.

/** biome-ignore-all lint/style/useNamingConvention: content-pack NPC ids use snake_case by design */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ContentPackManifest } from '@aikami/schemas';

const resolvedTags: string[] = [];
let resolvable = new Set<string>();

mock.module('$lib/services/assets/asset_store.svelte', () => ({
  assetStore: {
    resolveUrl: (tag: string) => {
      resolvedTags.push(tag);
      return resolvable.has(tag) ? `blob:${tag}` : null;
    },
  },
}));

const { configureNpcPortraitSource, portraitUrlToTag, resolveNpcAvatarUrl } = await import(
  './npc_avatar_catalog.ts'
);

const manifestWith = (variants: Record<string, string>): ContentPackManifest =>
  ({
    id: 'emberwatch',
    npcs: {
      village_elder: {
        name: 'Elder Thalia',
        portraits: { variants },
      },
    },
  }) as unknown as ContentPackManifest;

beforeEach(() => {
  resolvedTags.length = 0;
  resolvable = new Set();
  configureNpcPortraitSource(undefined);
});

describe('portraitUrlToTag', () => {
  test('mirrors pathToTag for the portraits category', () => {
    expect(portraitUrlToTag('/game-data/portraits/emberwatch/village_elder/neutral.png')).toBe(
      'portraits:emberwatch:village_elder:neutral',
    );
  });

  test('tolerates a URL without the game-data root', () => {
    expect(portraitUrlToTag('portraits/emberwatch/rollo_grasper/guarded.png')).toBe(
      'portraits:emberwatch:rollo_grasper:guarded',
    );
  });

  test('rejects URLs outside the published portrait catalog contract', () => {
    expect(portraitUrlToTag('https://example.test/portrait.png')).toBeUndefined();
    expect(portraitUrlToTag('/game-data/portraits/../secrets/portrait.png')).toBeUndefined();
    expect(portraitUrlToTag('/game-data/portraits/emberwatch/npc/neutral.jpg')).toBeUndefined();
  });
});

describe('resolveNpcAvatarUrl — pack-authored portraits', () => {
  test('a pack portrait wins over the legacy sprite map', () => {
    configureNpcPortraitSource(
      manifestWith({ neutral: '/game-data/portraits/emberwatch/village_elder/neutral.png' }),
    );
    resolvable = new Set(['portraits:emberwatch:village_elder:neutral']);

    expect(resolveNpcAvatarUrl({ npcId: 'village_elder' })).toBe(
      'blob:portraits:emberwatch:village_elder:neutral',
    );
    // The legacy gandalf stand-in is never consulted.
    expect(resolvedTags.some((tag) => tag.includes('gandalf'))).toBe(false);
  });

  test('an authored emotion is preferred, and neutral is the fallback', () => {
    configureNpcPortraitSource(
      manifestWith({
        neutral: '/game-data/portraits/emberwatch/village_elder/neutral.png',
        concerned: '/game-data/portraits/emberwatch/village_elder/concerned.png',
      }),
    );
    resolvable = new Set(['portraits:emberwatch:village_elder:concerned']);

    expect(resolveNpcAvatarUrl({ npcId: 'village_elder', expression: 'concerned' })).toBe(
      'blob:portraits:emberwatch:village_elder:concerned',
    );
  });

  test('an unauthored emotion falls back to neutral', () => {
    configureNpcPortraitSource(
      manifestWith({ neutral: '/game-data/portraits/emberwatch/village_elder/neutral.png' }),
    );
    resolvable = new Set(['portraits:emberwatch:village_elder:neutral']);

    expect(resolveNpcAvatarUrl({ npcId: 'village_elder', expression: 'hostile' })).toBe(
      'blob:portraits:emberwatch:village_elder:neutral',
    );
  });

  test('a declared portrait missing from the catalog does not shadow the fallback chain', () => {
    configureNpcPortraitSource(
      manifestWith({ neutral: '/game-data/portraits/emberwatch/village_elder/neutral.png' }),
    );
    // Nothing resolvable: the pack declaration is skipped, not rendered.
    expect(resolveNpcAvatarUrl({ npcId: 'village_elder' })).toBe(
      '/game-data/portraits/npc/gandalf/neutral.webp',
    );
  });

  test('an NPC with no pack portraits keeps the legacy behaviour', () => {
    configureNpcPortraitSource(manifestWith({}));
    expect(resolveNpcAvatarUrl({ npcId: 'merchant' })).toBe(
      '/game-data/portraits/npc/aragon/neutral.webp',
    );
  });
});
