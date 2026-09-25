// packages/frontend/engine/src/assets/content_identity.test.ts

import { describe, expect, test } from 'bun:test';
import { resolveContentIdentity } from './content_identity.ts';

const manifest = (): Record<string, unknown> => ({
  id: 'emberwatch',
  name: 'Emberwatch: The Fading Ward',
  version: '5.0.0',
  updatedAt: '2026-09-18T00:00:00.000Z',
  atlas: {
    textureUrl: '/game-data/sprites/tilesets/atlas.webp',
    spritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
    provenance: { source: 'generated:gpt' },
  },
  propAtlases: [
    {
      textureUrl: '/game-data/sprites/tilesets/props.webp',
      spritesheetUrl: '/game-data/sprites/tilesets/props.json',
    },
  ],
  maps: { village: { file: 'maps/village.json', name: 'Village' } },
});

describe('content identity', () => {
  test('extracts stable pack, atlas, and provenance identity', async () => {
    const identity = await resolveContentIdentity(manifest(), 'emberwatch');

    expect(identity).toMatchObject({
      packId: 'emberwatch',
      packName: 'Emberwatch: The Fading Ward',
      version: '5.0.0',
      updatedAt: '2026-09-18T00:00:00.000Z',
      atlasTextureUrl: '/game-data/sprites/tilesets/atlas.webp',
      atlasSpritesheetUrl: '/game-data/sprites/tilesets/atlas.json',
      provenanceSource: 'generated:gpt',
    });
    expect(identity.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.propAtlases).toEqual([
      {
        textureUrl: '/game-data/sprites/tilesets/props.webp',
        spritesheetUrl: '/game-data/sprites/tilesets/props.json',
      },
    ]);
  });

  test('object key order does not change the canonical digest', async () => {
    const original = manifest();
    const reordered = Object.fromEntries(Object.entries(original).toReversed());
    const [first, second] = await Promise.all([
      resolveContentIdentity(original, 'emberwatch'),
      resolveContentIdentity(reordered, 'emberwatch'),
    ]);

    expect(first.manifestSha256).toBe(second.manifestSha256);
  });

  test('array order and authored field changes change the digest', async () => {
    const original = manifest();
    const changed = manifest();
    changed.propAtlases = [
      {
        textureUrl: '/game-data/sprites/tilesets/props-extra.webp',
        spritesheetUrl: '/game-data/sprites/tilesets/props-extra.json',
      },
      {
        textureUrl: '/game-data/sprites/tilesets/props.webp',
        spritesheetUrl: '/game-data/sprites/tilesets/props.json',
      },
    ];
    const [first, second] = await Promise.all([
      resolveContentIdentity(original, 'emberwatch'),
      resolveContentIdentity(changed, 'emberwatch'),
    ]);

    expect(first.manifestSha256).not.toBe(second.manifestSha256);
  });

  test('omits unavailable atlas URLs instead of emitting undefined properties', async () => {
    const withoutAtlas = manifest();
    delete withoutAtlas.atlas;
    const identity = await resolveContentIdentity(withoutAtlas, 'emberwatch');

    expect('atlasTextureUrl' in identity).toBe(false);
    expect('atlasSpritesheetUrl' in identity).toBe(false);
  });

  test('rejects manifests missing identity fields', async () => {
    await expect(resolveContentIdentity({ id: 'incomplete' }, 'incomplete')).rejects.toThrow(
      'Content identity manifest is missing required fields',
    );
  });
});
