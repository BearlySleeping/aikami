// packages/frontend/preview/src/lib/sandbox/walk_sandbox_assets.test.ts
// The map's own catalog lookup is insufficient: nested tilesets use paths.
import { describe, expect, test } from 'bun:test';
import type { AssetResolver } from '@aikami/types';
import { createWalkSandboxAssetBindings } from './walk_sandbox_assets';

const createFixture = () => {
  const requests: string[] = [];
  const released: string[] = [];
  const resolver: AssetResolver = {
    kind: 'fixture',
    resolve: (tag) => {
      requests.push(tag);
      if (tag === 'sprites:tilesets:debug_tiles.png') {
        return 'blob:published-debug-tiles';
      }
      return null;
    },
    release: (url) => {
      released.push(url);
    },
  };
  return { bindings: createWalkSandboxAssetBindings({ resolver }), requests, released };
};

describe('walk sandbox catalog bindings', () => {
  test('resolves the de-bundled tileset path through its published extension-bearing tag', () => {
    const { bindings, requests } = createFixture();
    expect(bindings.resolveTag?.('/game-data/sprites/tilesets/debug_tiles.png')).toBe(
      'blob:published-debug-tiles',
    );
    expect(requests).toEqual(['sprites:tilesets:debug_tiles.png']);
  });

  test('relative and absolute legacy paths resolve identically', () => {
    const { bindings } = createFixture();
    expect(bindings.resolveTag?.('sprites/tilesets/debug_tiles.png')).toBe(
      bindings.resolveTag?.('/game-data/sprites/tilesets/debug_tiles.png'),
    );
  });

  test('an unknown image remains unresolved rather than receiving an invented URL', () => {
    const { bindings } = createFixture();
    expect(bindings.resolveTag?.('/game-data/sprites/tilesets/missing.png')).toBeNull();
  });

  test('entity IDs retain their original resolution and release follows the same resolver', () => {
    const { bindings, requests, released } = createFixture();
    bindings.assetUrlResolver?.('body', 'lpc:body:bodies_female:walk', 'walk');
    expect(requests).toEqual(['lpc:body:bodies_female:walk']);
    bindings.releaseUrl?.('blob:published-debug-tiles');
    expect(released).toEqual(['blob:published-debug-tiles']);
  });
});
