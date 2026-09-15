// scripts/src/lib/catalog/pack_lock.test.ts
//
// C-523 AC-5 — the write side of the installed pack lock: image pins from the
// pack's atlas declarations, audio pins from its authored `pack.audio.v1`
// bindings, resolved against what the release actually published.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import type { ContentPackManifest } from '@aikami/schemas';
import { InstalledPackLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { buildPackLock } from './pack_lock.ts';

const MANIFEST_HASH = 'a'.repeat(64);
const ATLAS_HASH = 'b'.repeat(64);
const SHEET_HASH = 'c'.repeat(64);
const EXPLORE_HASH = 'cf4233978d79d3d878e3f9b5d008b53710ea6f31259a128f828a922ba61def81';
const COMBAT_HASH = '506679f49699c83f5322ee60a3d9407c1174e49ebec6317eafff6954d6eba1fa';

const manifest = {
  id: 'emberwatch',
  name: 'Emberwatch',
  version: '4.3.0',
  updatedAt: '2026-09-15T00:00:00.000Z',
  startingMapId: 'village',
  maps: { village: { file: 'maps/village.json', name: 'Village' } },
  npcs: {},
  items: {},
  dialogues: {},
  atlas: {
    textureUrl: '/game-data/sprites/tilesets/atlas.webp',
    spritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
  },
  propAtlases: [
    {
      textureUrl: '/game-data/sprites/tilesets/props.webp',
      spritesheetUrl: '/game-data/sprites/tilesets/props.json',
    },
  ],
  audio: {
    schemaVersion: 'pack.audio.v1',
    bindings: [
      {
        cueId: 'village.music',
        target: 'music',
        context: 'village',
        tag: 'music:exploration:bgm_explore',
        sha256: EXPLORE_HASH,
        resolution: 'required',
        fallback: 'silence',
      },
      {
        cueId: 'combat.music',
        target: 'music',
        context: 'combat',
        tag: 'music:combat:bgm_combat',
        sha256: COMBAT_HASH,
        resolution: 'required',
        fallback: 'silence',
      },
      {
        cueId: 'inn.music',
        target: 'music',
        context: 'inn',
        tag: 'music:exploration:Chainsmoker',
        sha256: 'd'.repeat(64),
        resolution: 'optional',
        fallback: 'declared_cue',
        fallbackCueId: 'village.music',
      },
    ],
  },
} as unknown as ContentPackManifest;

const seedRows = [
  { tag: 'sprites:tilesets:atlas.webp', hash: ATLAS_HASH },
  { tag: 'sprites:tilesets:atlas.json', hash: SHEET_HASH },
  { tag: 'music:exploration:bgm_explore', hash: EXPLORE_HASH },
  { tag: 'music:combat:bgm_combat', hash: COMBAT_HASH },
];

describe('buildPackLock', () => {
  test('produces a schema-valid lock', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock).toBeDefined();
    expect(Value.Check(InstalledPackLockSchema, lock)).toBe(true);
  });

  test('pins the pack atlas image and spritesheet as assets', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock?.assets).toEqual([
      { id: 'sprites:tilesets:atlas.webp', imageHash: ATLAS_HASH, definitionHash: MANIFEST_HASH },
      { id: 'sprites:tilesets:atlas.json', imageHash: SHEET_HASH, definitionHash: MANIFEST_HASH },
    ]);
  });

  test('pins each authored cue to the published rendition hash', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock?.audioAssets).toEqual([
      { id: 'village.music', renditionHash: EXPLORE_HASH },
      { id: 'combat.music', renditionHash: COMBAT_HASH },
    ]);
  });

  test('omits a cue whose declared tag was never published', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock?.audioAssets?.some((pin) => pin.id === 'inn.music')).toBe(false);
  });

  test('omits audioAssets entirely when the pack authors no audio', () => {
    const { audio: _dropped, ...withoutAudio } = manifest;
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest: withoutAudio as ContentPackManifest,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock?.audioAssets).toBeUndefined();
    expect(Value.Check(InstalledPackLockSchema, lock)).toBe(true);
  });

  test('omits audioAssets when no authored cue is published', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows: seedRows.filter((row) => row.tag.startsWith('sprites:')),
    });
    expect(lock?.audioAssets).toBeUndefined();
  });

  test('returns undefined when no image bytes are published (schema needs >= 1)', () => {
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows: seedRows.filter((row) => row.tag.startsWith('music:')),
    });
    expect(lock).toBeUndefined();
  });

  test('a local override row supersedes the published one for the same tag', () => {
    const localAtlasHash = 'e'.repeat(64);
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest,
      manifestHash: MANIFEST_HASH,
      seedRows: [{ tag: 'sprites:tilesets:atlas.webp', hash: localAtlasHash }, ...seedRows],
    });
    expect(lock?.assets[0]?.imageHash).toBe(localAtlasHash);
  });

  test('deduplicates an image tag declared by both an atlas and a prop atlas', () => {
    const duplicated = {
      ...manifest,
      propAtlases: [
        {
          textureUrl: '/game-data/sprites/tilesets/atlas.webp',
          spritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
        },
      ],
    } as ContentPackManifest;
    const lock = buildPackLock({
      releaseId: 'release-1',
      manifest: duplicated,
      manifestHash: MANIFEST_HASH,
      seedRows,
    });
    expect(lock?.assets).toHaveLength(2);
  });
});
