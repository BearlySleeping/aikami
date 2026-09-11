// packages/frontend/engine/src/game_world/entity_appearance.test.ts

import { describe, expect, test } from 'bun:test';
import type { LpcLayerRecipe } from '@aikami/lpc';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { EntityAppearanceLoader } from './entity_appearance.ts';

const recipe = (slot: string, assetId: string): LpcLayerRecipe => ({
  slot,
  assetId,
  hexPalette: new Uint8Array(1024),
  layerRole: 'front',
});

/** 64×256 sheet → standard family, pitch 64, one column, four rows. */
const makeTexture = (): Texture =>
  new Texture({ source: new TextureSource({ width: 64, height: 256 }) });

type Harness = {
  loader: EntityAppearanceLoader;
  loadedUrls: string[];
  errors: Array<{ url: string; error: string }>;
  failingUrl?: string;
};

const makeLoader = (options?: { failUrl?: string; unmapped?: boolean }): Harness => {
  const loadedUrls: string[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  const harness: Harness = {
    loadedUrls,
    errors,
    loader: new EntityAppearanceLoader({
      resolveAssetUrl: (slot) => {
        if (options?.unmapped) {
          return null;
        }
        return `/assets/${slot}.png`;
      },
      loadTexture: async (url) => {
        if (url === options?.failUrl) {
          throw new Error('load failed');
        }
        loadedUrls.push(url);
        return makeTexture();
      },
      onLoadError: (info) => errors.push(info),
    }),
  };
  return harness;
};

describe('EntityAppearanceLoader — prepare', () => {
  test('loads layers off-scene without touching a live container', async () => {
    const { loader } = makeLoader();
    const target = new Container();
    const placeholder = new Sprite(Texture.WHITE);
    target.addChild(placeholder);

    const prepared = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });

    expect(prepared.layers).toHaveLength(1);
    expect(prepared.container.children).toHaveLength(1);
    // The live target is untouched until commit.
    expect(target.children).toEqual([placeholder]);

    loader.disposePrepared(prepared);
  });

  test('omits layers whose slot resolves to no URL', async () => {
    const { loader, loadedUrls } = makeLoader({ unmapped: true });
    const prepared = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });
    expect(prepared.layers).toHaveLength(0);
    expect(loadedUrls).toHaveLength(0);
    loader.disposePrepared(prepared);
  });

  test('omits a failed layer and reports the error', async () => {
    const { loader, errors } = makeLoader({ failUrl: '/assets/head.png' });
    const prepared = await loader.prepare({
      recipes: [recipe('body', 'body.1'), recipe('head', 'head.1')],
      state: 'walk',
    });
    expect(prepared.layers).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.url).toBe('/assets/head.png');
    loader.disposePrepared(prepared);
  });

  test('equal-depth layers preserve original recipe order', async () => {
    const { loader } = makeLoader();
    const prepared = await loader.prepare({
      recipes: [recipe('body', 'a'), recipe('body', 'b'), recipe('body', 'c')],
      state: 'walk',
    });
    expect(prepared.layers.map((layer) => layer.recipe.assetId)).toEqual(['a', 'b', 'c']);
    loader.disposePrepared(prepared);
  });
});

describe('EntityAppearanceLoader — commit and dispose', () => {
  test('commit atomically replaces children and destroys the old ones', async () => {
    const { loader } = makeLoader();
    const prepared = await loader.prepare({
      recipes: [recipe('body', 'body.1'), recipe('hair', 'hair.1')],
      state: 'walk',
    });

    const target = new Container();
    let oldDestroyed = false;
    const oldChild = new Sprite(Texture.WHITE);
    oldChild.destroy = () => {
      oldDestroyed = true;
    };
    target.addChild(oldChild);

    loader.commit({ target, prepared });

    expect(oldDestroyed).toBe(true);
    expect(target.children).toHaveLength(2);
    expect(target.children[0]).toBe(prepared.layers[0]?.sprite);
    expect(target.children[1]).toBe(prepared.layers[1]?.sprite);
    // The staging container is released after the reparent.
    expect(prepared.container.destroyed).toBe(true);
  });

  test('disposePrepared destroys staged sprites but not shared textures', async () => {
    const { loader } = makeLoader();
    const prepared = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });
    const layer = prepared.layers[0];
    if (!layer) {
      throw new Error('expected a prepared layer');
    }
    let spriteDestroyed = false;
    layer.sprite.destroy = () => {
      spriteDestroyed = true;
    };

    loader.disposePrepared(prepared);

    expect(spriteDestroyed).toBe(true);
    // The loaded texture is owned by the shared cache and stays usable.
    expect(layer.texture?.destroyed).toBe(false);
  });

  test('commit does not destroy the loaded textures', async () => {
    const { loader } = makeLoader();
    const prepared = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });
    const target = new Container();
    loader.commit({ target, prepared });
    expect(prepared.layers[0]?.texture?.destroyed).toBe(false);
  });
});
