// packages/frontend/engine/src/assets/manifest_atlas_resolver.test.ts

import { describe, expect, spyOn, test } from 'bun:test';
import { ManifestAtlasResolver } from './manifest_atlas_resolver.ts';

describe('ManifestAtlasResolver.getTileTextureFromGid', () => {
  test('masks flipped GIDs before resolving the local tile ID', () => {
    const resolver = new ManifestAtlasResolver({
      tileSize: 32,
      atlas: { textureUrl: 'atlas.webp', spritesheetUrl: '' },
      fallbackTile: 'fallback.png',
      tiles: {},
    });
    const getTileTexture = spyOn(resolver, 'getTileTexture').mockReturnValue(undefined);

    resolver.getTileTextureFromGid(0xe0000064, 100);
    expect(getTileTexture).toHaveBeenCalledWith(1);
    expect(resolver.getTileTextureFromGid(0x80000000, 100)).toBeUndefined();
    expect(getTileTexture).toHaveBeenCalledTimes(1);
  });
});
