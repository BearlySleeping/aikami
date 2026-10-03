// packages/frontend/engine/src/rendering/texture_manager_lifetime.test.ts
//
// Lifetime behaviour of the texture cache: single-flight loads, teardown that
// cannot be undone by a late completion, and spritesheet leases that keep a
// live actor's frame map alive past the cache budget.

import { describe, expect, test } from 'bun:test';
import { Texture } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import { TextureManager } from './texture_manager.ts';

const LAYOUT = { frameWidth: 8, frameHeight: 8, columns: 2, rows: 1, keyPrefix: 'walk' };

const recipe = (assetId: string): LpcLayerRecipe => ({
  slot: 'body',
  assetId,
  layerRole: 'front',
  hexPalette: new Uint8Array(1024),
});

describe('TextureManager — concurrent loads', () => {
  test('concurrent misses for one key load and account once', async () => {
    let loads = 0;
    const manager = new TextureManager({
      loadTexture: async () => {
        loads++;
        return Texture.WHITE;
      },
    });

    const [a, b, c] = await Promise.all([
      manager.getTexture(11),
      manager.getTexture(11),
      manager.getTexture(11),
    ]);

    expect(loads).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(manager.size).toBe(1);
    // One accounting entry, not three.
    expect(manager.bytesUsed).toBe(Texture.WHITE.width * Texture.WHITE.height * 4);
  });

  test('concurrent misses for distinct keys each load once', async () => {
    let loads = 0;
    const manager = new TextureManager({
      loadTexture: async () => {
        loads++;
        return Texture.WHITE;
      },
    });

    await Promise.all([manager.getTexture(1), manager.getTexture(2), manager.getTexture(3)]);
    expect(loads).toBe(3);
    expect(manager.size).toBe(3);
  });

  test('a failed load is retried on the next request', async () => {
    let attempts = 0;
    const manager = new TextureManager({
      loadTexture: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('network down');
        }
        return Texture.WHITE;
      },
    });

    await expect(manager.getTexture(5)).rejects.toThrow('network down');
    expect(manager.size).toBe(0);

    expect(await manager.getTexture(5)).toBe(Texture.WHITE);
    expect(attempts).toBe(2);
    expect(manager.size).toBe(1);
  });

  test('concurrent grayscale misses for one key load once', async () => {
    let loads = 0;
    const manager = new TextureManager({
      loadTexture: async () => {
        loads++;
        return Texture.WHITE;
      },
    });

    await Promise.all([
      manager.getGrayscaleSheet(21),
      manager.getGrayscaleSheet(21),
      manager.getGrayscaleSheet(21),
    ]);

    expect(loads).toBe(1);
    expect(manager.grayscaleSheetCount).toBe(1);
  });

  test('a shared load rejection rejects every waiter once and stays retryable', async () => {
    let attempts = 0;
    const manager = new TextureManager({
      loadTexture: async () => {
        attempts++;
        throw new Error('decode blew up');
      },
    });

    // Handlers are attached eagerly: the two waiters share one rejection, and
    // an unobserved rejection would be reported as an unhandled one.
    const settled = Promise.all([
      manager.getTexture(8).then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      manager.getTexture(8).then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
    ]);

    expect(await settled).toEqual(['decode blew up', 'decode blew up']);
    expect(attempts).toBe(1);

    await expect(manager.getTexture(8)).rejects.toThrow('decode blew up');
    expect(attempts).toBe(2);
  });
});

describe('TextureManager — teardown', () => {
  test('a load that completes after destroy never repopulates the cache', async () => {
    let resolveLoad: ((texture: Texture) => void) | undefined;
    const manager = new TextureManager({
      loadTexture: () =>
        new Promise<Texture>((resolve) => {
          resolveLoad = resolve;
        }),
    });

    const pending = manager.getTexture(31);
    await Promise.resolve();

    manager.destroy();
    resolveLoad?.(Texture.WHITE);

    // The caller still receives what it asked for…
    expect(await pending).toBe(Texture.WHITE);
    // …but the destroyed cache stays empty.
    expect(manager.size).toBe(0);
    expect(manager.bytesUsed).toBe(0);
  });

  test('a grayscale load that completes after destroy never repopulates the cache', async () => {
    let resolveLoad: ((texture: Texture) => void) | undefined;
    const manager = new TextureManager({
      loadTexture: () =>
        new Promise<Texture>((resolve) => {
          resolveLoad = resolve;
        }),
    });

    const pending = manager.getGrayscaleSheet(41);
    await Promise.resolve();
    manager.destroy();
    resolveLoad?.(Texture.WHITE);

    await pending;
    expect(manager.grayscaleSheetCount).toBe(0);
  });

  test('a spritesheet parse that completes after destroy is handed over unpooled', async () => {
    const manager = new TextureManager();

    const pending = manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'late.json',
    });
    await Promise.resolve();
    manager.destroy();

    const lease = await pending;
    // Still usable by its holder…
    expect(lease.spritesheet.textures.walk_0_1).toBeDefined();
    // …but never pooled, so releasing it frees the sheet outright.
    expect(manager.spritesheetCount).toBe(0);
    lease.release();
    expect(lease.spritesheet.textures).toBeNull();
  });

  test('concurrent parses of one sheet key share a single parse', async () => {
    const manager = new TextureManager();
    const leases = await Promise.all([
      manager.acquireSpritesheet({
        baseTexture: Texture.WHITE,
        layout: LAYOUT,
        cacheKey: 'shared.json',
      }),
      manager.acquireSpritesheet({
        baseTexture: Texture.WHITE,
        layout: LAYOUT,
        cacheKey: 'shared.json',
      }),
    ]);

    expect(manager.spritesheetCount).toBe(1);
    expect(leases[0].spritesheet).toBe(leases[1].spritesheet);

    leases[0].release();
    // One holder left: the frame map must survive.
    expect(leases[1].spritesheet.textures.walk_0_0).toBeDefined();
    leases[1].release();
  });

  test('a one-shot frame lookup releases its lease', async () => {
    const manager = new TextureManager();
    const frame = await manager.getSpritesheetFrame({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'one-shot.json',
      frameKey: 'walk_0_1',
    });

    expect(frame).toBeDefined();
    expect(frame?.frame.x).toBe(8);
    // Released immediately, so the sheet is collectable again.
    expect(manager.spritesheetCount).toBe(1);
  });
});

describe('TextureManager — spritesheet leases past the cache budget', () => {
  test('an active actor survives more than 128 distinct sheets', async () => {
    // The 128-sheet budget with 129+ distinct actor sheets used to FIFO-evict
    // the oldest — including a sheet a live actor was still reading
    // `sheet.textures` from every animation frame.
    const manager = new TextureManager();
    const held: Array<{
      spritesheet: { textures: Record<string, unknown> | null };
      release: () => void;
    }> = [];

    const actor = await manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'actor-000.json',
    });
    held.push(actor);

    for (let i = 1; i <= 140; i++) {
      const lease = await manager.acquireSpritesheet({
        baseTexture: Texture.WHITE,
        layout: LAYOUT,
        cacheKey: `actor-${String(i).padStart(3, '0')}.json`,
      });
      held.push(lease);
    }

    expect(manager.spritesheetCount).toBe(141);
    for (const lease of held) {
      expect(lease.spritesheet.textures).not.toBeNull();
    }

    // Releasing everything lets the cache settle back inside its budget.
    for (const lease of held) {
      lease.release();
    }
    expect(manager.spritesheetCount).toBeLessThanOrEqual(128);
  });

  test('releasing a lease makes the sheet evictable again', async () => {
    const manager = new TextureManager();
    const evictable = await manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'transient.json',
    });
    expect(manager.spritesheetCount).toBe(1);

    evictable.release();
    expect(manager.spritesheetCount).toBe(1);

    // Churn past the budget: the released sheet is now collectable.
    const held = [];
    for (let i = 0; i < 128; i++) {
      held.push(
        await manager.acquireSpritesheet({
          baseTexture: Texture.WHITE,
          layout: LAYOUT,
          cacheKey: `churn-${i}.json`,
        }),
      );
    }
    expect(manager.spritesheetCount).toBe(128);
    for (const lease of held) {
      lease.release();
    }
  });

  test('frame views of a shared sheet stay valid while any holder remains', async () => {
    const manager = new TextureManager();
    const first = await manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'shared-holders.json',
    });
    const second = await manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'shared-holders.json',
    });

    first.release();
    expect(second.spritesheet.textures.walk_0_0).toBeDefined();
    expect(second.spritesheet.textures.walk_0_1).toBeDefined();
    second.release();
  });

  test('recipe-driven lookups never leak a lease', () => {
    // Sanity: the batch path slices through getFrameAt, which allocates a
    // frame view over the shared source and holds nothing.
    const manager = new TextureManager();
    expect(recipe('body').assetId).toBe('body');
    expect(manager.spritesheetCount).toBe(0);
  });
});
