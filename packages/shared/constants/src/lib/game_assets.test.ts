// packages/shared/constants/src/lib/game_assets.test.ts
//
// tagToAssetPath must be the exact inverse of the pipeline that produced every
// manifest tag — `pathToTag(splitStateSegments(relPath, category))`. The
// compact boot seed (C-435) carries only a tag and an extension, so a drift
// between the two silently points every bundled URL at a file that is not
// there.

import { describe, expect, test } from 'bun:test';
import { r2AssetKey, r2AssetUrl, splitStateSegments, tagToAssetPath } from './game_assets.ts';

/** The tag half of the scan pipeline: strip ext, then `/` → `:`. */
const pathToTag = (relPath: string, category: string): string =>
  splitStateSegments(relPath, category)
    .replace(/\.[^.]+$/, '')
    .replace(/\//g, ':');

describe('tagToAssetPath', () => {
  test('treats every segment as a directory for categories without states', () => {
    expect(tagToAssetPath({ tag: 'sprites:tilesets:atlas', ext: '.webp' })).toBe(
      'sprites/tilesets/atlas.webp',
    );
    expect(tagToAssetPath({ tag: 'music:exploration:forest', ext: '.mp3' })).toBe(
      'music/exploration/forest.mp3',
    );
  });

  test('rejoins a trailing LPC state as a filename suffix', () => {
    expect(tagToAssetPath({ tag: 'lpc:body:bodies_male:walk', ext: '.webp' })).toBe(
      'lpc/body/bodies_male.walk.webp',
    );
    expect(tagToAssetPath({ tag: 'lpc:hat:magic:celestial_adult:combat_idle', ext: '.webp' })).toBe(
      'lpc/hat/magic/celestial_adult.combat_idle.webp',
    );
  });

  test('leaves an LPC segment that is not a declared state as a directory', () => {
    // "helmet" is not in lpc.stateExtensions, so it is a real path segment.
    expect(tagToAssetPath({ tag: 'lpc:hat:helmet', ext: '.webp' })).toBe('lpc/hat/helmet.webp');
  });

  test('round-trips every shape the scanner produces', () => {
    const paths = [
      'sprites/tilesets/atlas.webp',
      'sprites/combat/player_portrait.webp',
      'music/exploration/bgm_explore.webm',
      'lpc/body/bodies_male.walk.webp',
      'lpc/beard/beard/5oclock_shadow.backslash.webp',
      'lpc/hat/pirate/bicorne/athwart/admiral/original.shoot.webp',
      'maps/sandbox_zone_a.json',
    ];

    for (const path of paths) {
      const category = path.split('/')[0] ?? '';
      const ext = path.slice(path.lastIndexOf('.'));
      expect(tagToAssetPath({ tag: pathToTag(path, category), ext })).toBe(path);
    }
  });
});

describe('r2 object layout', () => {
  const hash = 'ab'.repeat(32);

  test('shards the key by the first two hash characters', () => {
    expect(r2AssetKey({ hash, ext: '.webp' })).toBe(`assets/ab/${hash}.webp`);
  });

  test('builds an absolute URL and tolerates a trailing slash on the base', () => {
    expect(r2AssetUrl({ baseUrl: 'https://cdn.example.com', hash, ext: '.png' })).toBe(
      `https://cdn.example.com/assets/ab/${hash}.png`,
    );
    expect(r2AssetUrl({ baseUrl: 'https://cdn.example.com/', hash, ext: '.png' })).toBe(
      `https://cdn.example.com/assets/ab/${hash}.png`,
    );
  });
});
