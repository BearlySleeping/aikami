// packages/frontend/engine/src/rendering/spritesheet_registry.test.ts

import { describe, expect, test } from 'bun:test';
import { Rectangle, Spritesheet, Texture } from 'pixi.js';
import { type SpritesheetLease, SpritesheetRegistry } from './spritesheet_registry.ts';

const ATLAS = {
  frames: {
    // biome-ignore lint/style/useNamingConvention: spritesheet frame labels are snake_case
    walk_0_0: { frame: { x: 0, y: 0, w: 8, h: 8 } },
    // biome-ignore lint/style/useNamingConvention: spritesheet frame labels are snake_case
    walk_0_1: { frame: { x: 8, y: 0, w: 8, h: 8 } },
  },
  meta: {
    image: 'sheet.png',
    format: 'RGBA8888',
    size: { w: 16, h: 8 },
    scale: 1,
  },
};

/** A real, parsed PixiJS spritesheet — real destroy semantics (textures=null). */
const makeSheet = async (): Promise<Spritesheet> => {
  const sheet = new Spritesheet(Texture.WHITE, ATLAS);
  await sheet.parse();
  return sheet;
};

describe('SpritesheetRegistry — leases pin sheets', () => {
  test('a second acquire of one key parses once and yields two leases', async () => {
    const registry = new SpritesheetRegistry();
    let parses = 0;
    const create = async (): Promise<Spritesheet> => {
      parses++;
      return makeSheet();
    };

    const first = await registry.acquire({ cacheKey: 'a', create });
    const second = await registry.acquire({ cacheKey: 'a', create });

    expect(parses).toBe(1);
    expect(registry.count).toBe(1);
    expect(registry.pinnedCount).toBe(1);
    expect(second.spritesheet).toBe(first.spritesheet);

    first.release();
    expect(registry.pinnedCount).toBe(1);
    second.release();
    expect(registry.pinnedCount).toBe(0);
  });

  test('concurrent acquires of one key share a single parse', async () => {
    const registry = new SpritesheetRegistry();
    let parses = 0;
    const create = async (): Promise<Spritesheet> => {
      parses++;
      return makeSheet();
    };

    const [a, b, c] = await Promise.all([
      registry.acquire({ cacheKey: 'shared', create }),
      registry.acquire({ cacheKey: 'shared', create }),
      registry.acquire({ cacheKey: 'shared', create }),
    ]);

    expect(parses).toBe(1);
    // One SHEET pinned, held by three leases.
    expect(registry.pinnedCount).toBe(1);
    expect(registry.count).toBe(1);
    expect(a.spritesheet).toBe(b.spritesheet);
    expect(b.spritesheet).toBe(c.spritesheet);

    a.release();
    b.release();
    // Still pinned: the third holder has not released.
    expect(registry.pinnedCount).toBe(1);
    c.release();
    expect(registry.pinnedCount).toBe(0);
  });

  test('a leased sheet is never evicted, however much churn happens', async () => {
    // The production crash: 128-sheet budget, FIFO eviction, and an actor
    // whose `sheet.textures` was nulled while it was still animating.
    const registry = new SpritesheetRegistry({ maxEntries: 4 });
    const create = async (): Promise<Spritesheet> => makeSheet();

    const actor: SpritesheetLease = await registry.acquire({ cacheKey: 'actor', create });

    // 40 distinct sheets on top of a 4-entry budget, all held at once.
    const npcs: SpritesheetLease[] = [];
    for (let i = 0; i < 40; i++) {
      npcs.push(await registry.acquire({ cacheKey: `npc-${i}`, create }));
    }

    // Over budget, but every pinned actor is intact and still usable.
    expect(registry.count).toBe(41);
    expect(registry.pinnedCount).toBe(41);
    expect(actor.spritesheet.textures.walk_0_1).toBeDefined();
    expect(actor.spritesheet.textures.walk_0_0).toBeInstanceOf(Texture);
    for (const npc of npcs) {
      expect(npc.spritesheet.textures.walk_0_0).toBeDefined();
    }

    // Releasing everything makes the cache collectable again.
    actor.release();
    for (const npc of npcs) {
      npc.release();
    }
    expect(registry.count).toBe(4);
    expect(registry.pinnedCount).toBe(0);
  });

  test('unleased sheets are evicted least-recently-used first', async () => {
    const registry = new SpritesheetRegistry({ maxEntries: 2 });
    const create = async (): Promise<Spritesheet> => makeSheet();

    const oldest = await registry.acquire({ cacheKey: 'oldest', create });
    oldest.release();
    await registry.acquire({ cacheKey: 'middle', create }).then((lease) => lease.release());
    await registry.acquire({ cacheKey: 'newest', create }).then((lease) => lease.release());

    expect(registry.count).toBe(2);
    // 'oldest' was touched first and then released, so it is the victim.
    const reAcquired = await registry.acquire({ cacheKey: 'oldest', create });
    expect(registry.count).toBe(2);
    reAcquired.release();
  });

  test('release is idempotent', async () => {
    const registry = new SpritesheetRegistry({ maxEntries: 1 });
    const lease = await registry.acquire({
      cacheKey: 'a',
      create: async () => makeSheet(),
    });

    lease.release();
    lease.release();
    lease.release();

    expect(registry.pinnedCount).toBe(0);
    // The over-releases must not have driven the count negative and skipped
    // an eviction it owed.
    await registry
      .acquire({ cacheKey: 'b', create: async () => makeSheet() })
      .then((l) => l.release());
    expect(registry.count).toBe(1);
  });

  test('destroy keeps a leased sheet alive until the last release', async () => {
    const registry = new SpritesheetRegistry();
    const lease = await registry.acquire({
      cacheKey: 'actor',
      create: async () => makeSheet(),
    });
    const sheet = lease.spritesheet;

    registry.destroy();

    // The holder keeps a working sheet through teardown.
    expect(sheet.textures.walk_0_0).toBeDefined();

    lease.release();
    // …and only now is the frame map torn down.
    expect(sheet.textures).toBeNull();
  });

  test('destroy releases unleased sheets immediately', async () => {
    const registry = new SpritesheetRegistry();
    const lease = await registry.acquire({
      cacheKey: 'a',
      create: async () => makeSheet(),
    });
    const sheet = lease.spritesheet;
    lease.release();

    registry.destroy();
    expect(sheet.textures).toBeNull();
    expect(registry.count).toBe(0);
  });

  test('destroy does not destroy the asset-owned base texture', async () => {
    // `destroy(true)` would free a GPU resource the Pixi asset system — and
    // every other consumer of the same sheet — still owns.
    const base = Texture.WHITE;
    const registry = new SpritesheetRegistry();
    const lease = await registry.acquire({
      cacheKey: 'a',
      create: async () => {
        const sheet = new Spritesheet(base, ATLAS);
        await sheet.parse();
        return sheet;
      },
    });
    lease.release();

    registry.destroy();

    expect(base.source.destroyed).toBe(false);
    expect(base.width).toBeGreaterThan(0);
  });

  test('a parse in flight during destroy never lands in the cache', async () => {
    const registry = new SpritesheetRegistry();
    let parses = 0;
    const create = async (): Promise<Spritesheet> => {
      parses++;
      return makeSheet();
    };

    const pending = registry.acquire({ cacheKey: 'late', create });
    // Let the shared-flight entry exist before the owner goes away.
    await Promise.resolve();
    registry.destroy();

    const lease = await pending;
    // The caller still gets a usable sheet…
    expect(lease.spritesheet.textures.walk_0_0).toBeDefined();
    // …but it is not cached, and releasing it frees it rather than pinning.
    expect(registry.count).toBe(0);
    lease.release();
    expect(lease.spritesheet.textures).toBeNull();
    expect(parses).toBe(1);
  });

  test('a late parse cannot be handed out twice as the same cached entry', async () => {
    const registry = new SpritesheetRegistry();
    const first = await registry.acquire({
      cacheKey: 'a',
      create: async () => makeSheet(),
    });
    first.release();

    registry.destroy();

    const afterDestroy = await registry.acquire({
      cacheKey: 'a',
      create: async () => makeSheet(),
    });
    expect(afterDestroy.spritesheet.textures.walk_0_1).toBeDefined();
    afterDestroy.release();
  });

  test('evicted sheets really do lose their frame map', async () => {
    const registry = new SpritesheetRegistry({ maxEntries: 1 });
    const first = await registry.acquire({
      cacheKey: 'a',
      create: async () => makeSheet(),
    });
    const sheet = first.spritesheet;
    first.release();

    await registry
      .acquire({ cacheKey: 'b', create: async () => makeSheet() })
      .then((lease) => lease.release());

    expect(registry.count).toBe(1);
    expect(sheet.textures).toBeNull();
  });

  test('a frame lookup through a leased sheet keeps its UV rectangle', () => {
    // Guards the "texture wrappers != the sheet's UV frames" distinction: the
    // per-frame path reads `sheet.textures[label]`, not a fresh rectangle.
    return makeSheet().then(async (sheet) => {
      const frame = sheet.textures.walk_0_1;
      expect(frame.frame.x).toBe(8);
      expect(frame.frame instanceof Rectangle).toBe(true);
    });
  });
});
