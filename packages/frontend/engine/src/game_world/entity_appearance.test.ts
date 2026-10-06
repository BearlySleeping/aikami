// packages/frontend/engine/src/game_world/entity_appearance.test.ts

import { describe, expect, test } from 'bun:test';
import type { LpcLayerRecipe } from '@aikami/lpc';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { TextureManager } from '../rendering/texture_manager.ts';
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

/** A loader backed by a real TextureManager, so leases are really taken. */
const makeLeaseHarness = (): { loader: EntityAppearanceLoader; manager: TextureManager } => {
  const manager = new TextureManager();
  const loader = new EntityAppearanceLoader({
    resolveAssetUrl: (_slot, assetId) => `/assets/${assetId}.png`,
    loadTexture: async () => makeTexture(),
    textureManager: manager,
  });
  return { loader, manager };
};

/**
 * Churns `count` extra leases through the manager and releases them, forcing
 * eviction to settle inside the 128-sheet budget. Any sheet still pinned by a
 * leaked lease survives this as an over-budget entry.
 */
const churnPastBudget = async (manager: TextureManager, prefix: string): Promise<void> => {
  const held = [];
  for (let i = 0; i < 140; i++) {
    held.push(
      await manager.acquireSpritesheet({
        baseTexture: Texture.WHITE,
        layout: { frameWidth: 8, frameHeight: 8, columns: 2, rows: 1 },
        cacheKey: `${prefix}-${i}`,
      }),
    );
  }
  for (const lease of held) {
    lease.release();
  }
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

describe('EntityAppearanceLoader — spritesheet lease lifetime', () => {
  test('a prepared layer pins its sheet and disposePrepared gives the pin back', async () => {
    const harness = makeLeaseHarness();
    const prepared = await harness.loader.prepare({
      recipes: [recipe('body', 'body.1')],
      state: 'walk',
    });

    expect(prepared.layers).toHaveLength(1);
    expect(prepared.layers[0]?.spritesheet).toBeDefined();
    expect(harness.manager.spritesheetCount).toBe(1);

    const sheet = prepared.layers[0]?.spritesheet;
    harness.loader.disposePrepared(prepared);

    // The pin is gone and the layer no longer references the sheet, so a
    // later eviction can safely null `sheet.textures`.
    expect(prepared.layers[0]?.spritesheet).toBeUndefined();
    expect(prepared.layers[0]?.releaseSheet).toBeUndefined();
    expect(harness.manager.spritesheetCount).toBe(1);
    expect(sheet?.textures).not.toBeNull();
  });

  test('replacing a committed appearance releases the replaced sheet', async () => {
    const { loader, manager } = makeLeaseHarness();
    const target = new Container();

    const first = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });
    const firstSheet = first.layers[0]?.spritesheet;
    loader.commit({ target, prepared: first });
    expect(manager.spritesheetCount).toBe(1);

    // A different asset, committed over the top: the old sheet is now unused.
    const second = await loader.prepare({ recipes: [recipe('body', 'body.2')], state: 'walk' });
    loader.commit({ target, prepared: second });

    expect(manager.spritesheetCount).toBe(2);
    expect(firstSheet?.textures).not.toBeNull();

    // With the pin returned, the manager can drop it — and does.
    const released = [];
    for (let i = 0; i < 128; i++) {
      released.push(
        await manager.acquireSpritesheet({
          baseTexture: Texture.WHITE,
          layout: { frameWidth: 8, frameHeight: 8, columns: 2, rows: 1 },
          cacheKey: `filler-${i}`,
        }),
      );
    }
    // 128 unpinned entries plus the sheet the live appearance still holds:
    // the over-budget one is the pinned one, which is the whole point.
    expect(manager.spritesheetCount).toBe(129);
    expect(second.layers[0]?.spritesheet?.textures).not.toBeNull();
    for (const lease of released) {
      lease.release();
    }
  });

  test('a superseded prepare never leaves a pin behind', async () => {
    const { loader, manager } = makeLeaseHarness();
    const stale = await loader.prepare({ recipes: [recipe('body', 'body.9')], state: 'walk' });
    loader.disposePrepared(stale);
    loader.disposePrepared(stale);

    // Idempotent: the second dispose must not double-release a pin.
    expect(manager.pinnedSpritesheetCount).toBe(0);
  });
});

describe('EntityAppearanceLoader — lease lifetime follows the sprite', () => {
  test('destroying a sprite releases its sheet without going through the loader', async () => {
    // The teardown that matters: a scene surface reset or a world restore
    // destroys display objects directly. A pin stranded there would make the
    // sheet permanently unevictable.
    const { loader, manager } = makeLeaseHarness();
    const prepared = await loader.prepare({ recipes: [recipe('body', 'body.1')], state: 'walk' });
    const sprite = prepared.layers[0]?.sprite;

    expect(manager.spritesheetCount).toBe(1);

    sprite?.destroy({ children: true });

    await churnPastBudget(manager, 'churn');
    expect(manager.spritesheetCount).toBeLessThanOrEqual(128);
  });

  test('repeated map/entity cycles do not ratchet the pin count up', async () => {
    // The plateau test: every cycle acquires, commits and then has its live
    // display objects destroyed by a scene reset. One leaked pin per cycle
    // would show up as a growing cache that refuses to shrink.
    const { loader, manager } = makeLeaseHarness();

    for (let cycle = 0; cycle < 10; cycle++) {
      const target = new Container();
      const prepared = await loader.prepare({
        recipes: [recipe('body', `body-${cycle}`)],
        state: 'walk',
      });
      loader.commit({ target, prepared });
      target.destroy({ children: true });
    }

    // Every cycle's sheet was released, so nothing survives the churn.
    await churnPastBudget(manager, 'plateau');
    expect(manager.spritesheetCount).toBeLessThanOrEqual(128);
  });

  test('a stale prepare whose sprites are destroyed still releases its pin', async () => {
    // A load that is superseded after staging: nobody commits it and nobody
    // calls disposePrepared — the staged sprites are simply destroyed.
    const { loader, manager } = makeLeaseHarness();
    const prepared = await loader.prepare({ recipes: [recipe('body', 'stale.1')], state: 'walk' });

    expect(manager.spritesheetCount).toBe(1);
    prepared.container.destroy({ children: true });

    await churnPastBudget(manager, 'stale');
    expect(manager.spritesheetCount).toBeLessThanOrEqual(128);
  });
});
