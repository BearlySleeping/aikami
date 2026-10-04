// packages/frontend/engine/src/rendering/texture_manager_lifetime.test.ts
//
// Lifetime behaviour of the texture cache: single-flight loads, teardown that
// cannot be undone by a late completion, and spritesheet leases that keep a
// live actor's frame map alive past the cache budget.

import { describe, expect, test } from 'bun:test';
import { Texture, TextureSource } from 'pixi.js';
import type { LpcLayerRecipe } from '../components/appearance.ts';
import type { SpritesheetLease } from './spritesheet_registry.ts';
import { type LpcSpritesheetLayout, TextureManager } from './texture_manager.ts';

/**
 * A manager with a deliberately tiny sheet budget, so saturation is reachable
 * in a test instead of needing 129 real actor sheets.
 */
const saturatingManager = (maxEntries: number): TextureManager =>
  new TextureManager({ maxSpritesheets: maxEntries });

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
    // The borrowed lease is released on the next macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(manager.pinnedSpritesheetCount).toBe(0);
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

  test('recipe-driven lookups never leak a lease', async () => {
    // Sanity: the batch path slices through getFrameAt, which allocates a
    // frame view over the shared source and holds nothing.
    const texture = new Texture({ source: new TextureSource({ width: 16, height: 8 }) });
    const manager = new TextureManager({ loadTexture: async () => texture });
    const frames = await manager.getLayeredTextureBatch({
      recipes: [recipe('1')],
      frameIndex: 1,
      layout: LAYOUT,
    });
    expect(frames[0]?.frame.x).toBe(8);
    expect(manager.spritesheetCount).toBe(0);
  });
});

describe('TextureManager — one-shot accessors under cache saturation', () => {
  /** Pins every entry the cache holds, so the next one has no competition. */
  const pinEverything = async (manager: TextureManager): Promise<SpritesheetLease[]> => {
    const held: SpritesheetLease[] = [];
    for (let i = 0; i < 128; i++) {
      held.push(
        await manager.acquireSpritesheet({
          baseTexture: Texture.WHITE,
          layout: LAYOUT,
          cacheKey: `pinned-${i}`,
        }),
      );
    }
    return held;
  };

  test('a one-shot accessor returns a live sheet when every other entry is pinned', async () => {
    // The bug: acquire-then-release made the newest sheet the only unleased
    // candidate, so it evicted ITSELF before the awaiting caller resumed.
    const manager = saturatingManager(1);

    const pinned = await pinEverything(manager);
    const sheet = await manager.getOrCreateSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'one-shot',
    });

    // Readable immediately after the await — this is what the caller sees.
    expect(sheet).not.toBeNull();
    expect(sheet.textures).not.toBeNull();
    expect(sheet.textures.walk_0_1).toBeDefined();

    for (const lease of pinned) {
      lease.release();
    }
    manager.destroy();
  });

  test('a one-shot frame lookup returns a live frame under saturation', async () => {
    const manager = saturatingManager(1);

    const pinned = await pinEverything(manager);
    const frame = await manager.getSpritesheetFrame({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'frame-one-shot',
      frameKey: 'walk_0_1',
    });

    // The frame belongs to the sheet, so a sheet evicted before the caller
    // resumes would hand back a destroyed texture.
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(8);
    expect(frame?.frame.x).toBe(8);
    // A destroyed sheet nulls the frame map; a live one keeps the source.
    expect(frame?.source).toBeDefined();

    for (const lease of pinned) {
      lease.release();
    }
    manager.destroy();
  });

  test('a borrow is released on the next turn and does not leak', async () => {
    const manager = saturatingManager(1);

    const pinned = await pinEverything(manager);
    const sheet = await manager.getOrCreateSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'turn-borrow',
    });
    expect(sheet.textures).not.toBeNull();

    // Let the scheduled release run.
    await new Promise((resolve) => setTimeout(resolve, 1));

    for (const lease of pinned) {
      lease.release();
    }
    // The borrow is gone and the entry is collectable again.
    expect(manager.pinnedSpritesheetCount).toBe(0);
    manager.destroy();
  });

  test('repeated one-shot pressure leaves the pin count bounded', async () => {
    const manager = saturatingManager(4);

    const pinned: SpritesheetLease[] = [];
    for (let i = 0; i < 3; i++) {
      pinned.push(
        await manager.acquireSpritesheet({
          baseTexture: Texture.WHITE,
          layout: LAYOUT,
          cacheKey: `held-${i}`,
        }),
      );
    }

    for (let i = 0; i < 50; i++) {
      const sheet = await manager.getOrCreateSpritesheet({
        baseTexture: Texture.WHITE,
        layout: LAYOUT,
        cacheKey: `pressure-${i}`,
      });
      expect(sheet.textures).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Nothing accumulated: 50 one-shot reads did not become 50 pins.
    expect(manager.spritesheetCount).toBeLessThanOrEqual(4);
    for (const lease of pinned) {
      lease.release();
    }
    manager.destroy();
  });

  test('a borrow outstanding at destroy time is still reclaimed', async () => {
    const manager = saturatingManager(1);

    const sheet = await manager.getOrCreateSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'outstanding',
    });
    expect(sheet.textures).not.toBeNull();

    // Destroyed while the borrow is still pinned; the scheduled release must
    // still fire rather than leak the entry.
    manager.destroy();
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect(sheet.textures).toBeNull();
    expect(manager.spritesheetCount).toBe(0);
    manager.destroy();
  });

  test('acquireSpritesheet still pins before pruning under saturation', async () => {
    // The long-lived API is unchanged: a lease means the sheet survives.
    const manager = saturatingManager(1);
    const pinned = await pinEverything(manager);

    const held = await manager.acquireSpritesheet({
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'pinned-newcomer',
    });
    expect(held.spritesheet.textures).not.toBeNull();

    for (const lease of [...pinned, held]) {
      lease.release();
    }
    manager.destroy();
  });
});

describe('TextureManager — the sheet key is the full geometry', () => {
  const sheetFor = async (
    manager: TextureManager,
    options: {
      baseTexture: Texture;
      layout: LpcSpritesheetLayout;
      cacheKey: string;
    },
  ) => {
    const lease = await manager.acquireSpritesheet(options);
    const spritesheet = lease.spritesheet;
    return { spritesheet, release: lease.release };
  };

  test('the same URL with a different cell size is a different sheet', async () => {
    const manager = new TextureManager();
    // Same URL and same grid shape, different cell size → the 128px cells must
    // not be served the 64px sheet's frame rectangles.
    const small = await sheetFor(manager, {
      baseTexture: Texture.WHITE,
      layout: { frameWidth: 64, frameHeight: 64, columns: 4, rows: 2, keyPrefix: 'walk' },
      cacheKey: 'body.png',
    });
    const large = await sheetFor(manager, {
      baseTexture: Texture.WHITE,
      layout: { frameWidth: 128, frameHeight: 128, columns: 4, rows: 2, keyPrefix: 'walk' },
      cacheKey: 'body.png',
    });

    expect(large.spritesheet).not.toBe(small.spritesheet);
    expect(large.spritesheet.textures.walk_0_1?.frame.x).toBe(128);

    small.release();
    large.release();
  });

  test('the same URL with a different frame-label prefix is a different sheet', async () => {
    const manager = new TextureManager();
    const walking = await sheetFor(manager, {
      baseTexture: Texture.WHITE,
      layout: { ...LAYOUT, keyPrefix: 'walk' },
      cacheKey: 'body.png',
    });
    const slashing = await sheetFor(manager, {
      baseTexture: Texture.WHITE,
      layout: { ...LAYOUT, keyPrefix: 'slash' },
      cacheKey: 'body.png',
    });

    // Labels are the whole lookup contract: walk_0_1 must not answer a
    // request for slash_0_1.
    expect(slashing.spritesheet).not.toBe(walking.spritesheet);
    expect(slashing.spritesheet.textures.walk_0_1).toBeUndefined();
    expect(slashing.spritesheet.textures.slash_0_1).toBeDefined();

    walking.release();
    slashing.release();
  });

  test('two different base textures under one URL stay separate', async () => {
    const manager = new TextureManager();
    const first = await sheetFor(manager, {
      baseTexture: Texture.WHITE,
      layout: LAYOUT,
      cacheKey: 'body.png',
    });
    const second = await sheetFor(manager, {
      baseTexture: new Texture({ source: new TextureSource({ width: 16, height: 8 }) }),
      layout: LAYOUT,
      cacheKey: 'body.png',
    });

    expect(second.spritesheet).not.toBe(first.spritesheet);

    first.release();
    second.release();
  });

  test('identical geometry and base texture still dedup to one sheet', async () => {
    const manager = new TextureManager();
    const texture = new Texture({ source: new TextureSource({ width: 16, height: 8 }) });

    const first = await sheetFor(manager, {
      baseTexture: texture,
      layout: LAYOUT,
      cacheKey: 'shared.png',
    });
    const second = await sheetFor(manager, {
      baseTexture: texture,
      layout: LAYOUT,
      cacheKey: 'shared.png',
    });

    expect(second.spritesheet).toBe(first.spritesheet);
    expect(manager.spritesheetCount).toBe(1);

    first.release();
    second.release();
  });
});
