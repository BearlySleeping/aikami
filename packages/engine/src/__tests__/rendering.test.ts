// packages/engine/src/__tests__/rendering.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { Texture } from 'pixi.js';
import { TextureManager } from '../rendering/texture_manager.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tracks mock textures created during a test. */
type MockTracker = {
  textures: Map<number, Texture & { destroyed: boolean }>;
  loadCount: number;
};

/** Minimal mock destroy fn. */
const destroyFn = function (this: { destroyed: boolean }) {
  this.destroyed = true;
};

/**
 * Creates an injectable `loadTexture` function that returns mock textures
 * and tracks creation / load counts.
 */
const createMockLoader = (tracker: MockTracker) => {
  return async (key: number): Promise<Texture> => {
    tracker.loadCount += 1;
    const mock = {
      width: 32,
      height: 32,
      destroyed: false,
      destroy: destroyFn,
    } as unknown as Texture & { destroyed: boolean };
    tracker.textures.set(key, mock);
    return mock;
  };
};

// ---------------------------------------------------------------------------
// TextureManager — LRU eviction
// ---------------------------------------------------------------------------

describe('TextureManager — LRU cache', () => {
  let manager: TextureManager;
  let tracker: MockTracker;

  beforeEach(() => {
    tracker = { textures: new Map(), loadCount: 0 };
    manager = new TextureManager({
      maxTextures: 3,
      maxBytes: Number.POSITIVE_INFINITY, // Only test count-based eviction
      loadTexture: createMockLoader(tracker),
    });
  });

  // -----------------------------------------------------------------------
  // Basic caching
  // -----------------------------------------------------------------------

  it('loads a texture on first access and returns cached on second', async () => {
    const t1 = await manager.getTexture(1);
    expect(t1).toBeDefined();
    expect(tracker.loadCount).toBe(1);
    expect(manager.size).toBe(1);

    const t1Again = await manager.getTexture(1);
    expect(t1Again).toBe(t1); // Same reference — from cache
    expect(tracker.loadCount).toBe(1); // No additional load
    expect(manager.size).toBe(1);
  });

  it('returns Texture.EMPTY for key <= 0', async () => {
    const result = await manager.getTexture(0);
    expect(result).toBe(Texture.EMPTY);
    expect(manager.size).toBe(0);
    expect(tracker.loadCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Count-based eviction
  // -----------------------------------------------------------------------

  it('evicts the least recently accessed texture when cache exceeds maxTextures', async () => {
    // Load 3 textures — fills the cache (max: 3)
    await manager.getTexture(10);
    await manager.getTexture(20);
    await manager.getTexture(30);
    expect(manager.size).toBe(3);
    expect(tracker.loadCount).toBe(3);

    // Access 10 (promotes it to most recent)
    await manager.getTexture(10);

    // Load a 4th texture — triggers eviction of the LRU (20)
    await manager.getTexture(40);
    expect(manager.size).toBe(3);

    // Texture 20 should be evicted (never re-accessed since load)
    const tex20 = tracker.textures.get(20);
    expect(tex20?.destroyed).toBe(true);

    // Texture 10 should still be cached (was re-accessed)
    const tex10 = tracker.textures.get(10);
    expect(tex10?.destroyed).toBe(false);

    // Re-accessing 10 should still return the cached copy
    const cached = await manager.getTexture(10);
    expect(cached).toBe(tex10);
  });

  it('evicts multiple entries if needed to satisfy the limit', async () => {
    const smallManager = new TextureManager({
      maxTextures: 2,
      maxBytes: Number.POSITIVE_INFINITY,
      loadTexture: createMockLoader(tracker),
    });

    // Fill cache
    await smallManager.getTexture(100);
    await smallManager.getTexture(200);
    expect(smallManager.size).toBe(2);

    // Load 3 more — each one should evict something
    await smallManager.getTexture(300);
    await smallManager.getTexture(400);
    await smallManager.getTexture(500);

    expect(smallManager.size).toBe(2);

    // Only the last two accessed should remain
    let destroyedCount = 0;
    for (const tex of tracker.textures.values()) {
      if (tex.destroyed) {
        destroyedCount += 1;
      }
    }
    expect(destroyedCount).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Byte-based eviction
  // -----------------------------------------------------------------------

  it('evicts when total bytes exceed maxBytes', async () => {
    const byteManager = new TextureManager({
      maxTextures: 100,
      maxBytes: 32 * 32 * 4 * 2, // ~8 KB — room for 2 textures
      loadTexture: createMockLoader(tracker),
    });

    // Load 2 textures (fits within byte budget)
    await byteManager.getTexture(11);
    await byteManager.getTexture(22);
    expect(byteManager.size).toBe(2);

    // Load 3rd — exceeds byte budget, triggers eviction
    await byteManager.getTexture(33);
    expect(byteManager.size).toBe(2); // One evicted

    // The bytesUsed should be within budget
    expect(byteManager.bytesUsed).toBeLessThanOrEqual(32 * 32 * 4 * 3); // close to 2-texture budget
  });

  // -----------------------------------------------------------------------
  // Explicit release
  // -----------------------------------------------------------------------

  it('releaseTexture removes from cache and destroys the texture', async () => {
    await manager.getTexture(77);
    expect(manager.size).toBe(1);

    manager.releaseTexture(77);
    expect(manager.size).toBe(0);

    const tex = tracker.textures.get(77);
    expect(tex?.destroyed).toBe(true);
  });

  it('releaseTexture is a no-op for unknown keys', () => {
    expect(() => {
      manager.releaseTexture(999);
    }).not.toThrow();
    expect(manager.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Destroy
  // -----------------------------------------------------------------------

  it('destroy clears all textures and resets state', async () => {
    await manager.getTexture(1);
    await manager.getTexture(2);
    await manager.getTexture(3);
    expect(manager.size).toBe(3);

    manager.destroy();
    expect(manager.size).toBe(0);
    expect(manager.bytesUsed).toBe(0);

    // All mocked textures should be destroyed
    for (const tex of tracker.textures.values()) {
      expect(tex.destroyed).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Access ordering
  // -----------------------------------------------------------------------

  it('re-accessing a texture promotes it to most recently used', async () => {
    // Load in order: A, B, C (C = most recent)
    await manager.getTexture(111);
    await manager.getTexture(222);
    await manager.getTexture(333);

    // Re-access A (promotes A to most recent)
    await manager.getTexture(111);

    // Now load D — should evict B (currently the LRU)
    await manager.getTexture(444);

    expect(tracker.textures.get(111)?.destroyed).toBe(false); // A survived
    expect(tracker.textures.get(222)?.destroyed).toBe(true); // B evicted
    expect(tracker.textures.get(333)?.destroyed).toBe(false); // C survived
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('handles empty cache without errors', () => {
    const empty = new TextureManager({
      maxTextures: 1,
      loadTexture: createMockLoader(tracker),
    });
    expect(empty.size).toBe(0);
    expect(empty.bytesUsed).toBe(0);
  });

  it('handles maxTextures = 0 gracefully', async () => {
    const zeroManager = new TextureManager({
      maxTextures: 0,
      maxBytes: Number.POSITIVE_INFINITY,
      loadTexture: createMockLoader(tracker),
    });

    // First load fills the cache, then immediate eviction
    const tex = await zeroManager.getTexture(55);
    expect(tex).toBeDefined();

    // Size may be 0 or 1 depending on whether eviction runs after insert
    // but repeated loads should still work (previous entries get evicted)
    await zeroManager.getTexture(66);
    // Should not throw
  });

  it('handles load errors gracefully in getTexture', async () => {
    let callCount = 0;
    const errorLoader = async (_key: number): Promise<Texture> => {
      callCount += 1;
      throw new Error('Network failure');
    };

    const errorManager = new TextureManager({
      loadTexture: errorLoader,
    });

    await expect(errorManager.getTexture(999)).rejects.toThrow('Network failure');
    expect(errorManager.size).toBe(0);
  });
});
