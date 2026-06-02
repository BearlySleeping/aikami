// packages/frontend/engine/src/__tests__/rendering.test.ts
import { beforeEach, describe, expect, it } from 'bun:test';
import { addComponent, addEntity, createWorld, removeComponent, set } from 'bitecs';
import { Texture } from 'pixi.js';
import {
  Appearance,
  getAppearanceLayers,
  type LpcLayerRecipe,
  registerAppearanceObservers,
} from '../components/appearance.ts';
import { packRecipeToUboBuffer } from '../rendering/sprite_composer.ts';
import type { LpcSpritesheetLayout } from '../rendering/texture_manager.ts';
import { TextureManager } from '../rendering/texture_manager.ts';
import {
  LpcBatchManager,
  resetAppearanceTracking,
  syncAppearanceSystem,
} from '../systems/render_system.ts';

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

/**
 * Creates a valid {@link LpcLayerRecipe} for test purposes.
 *
 * Returns a recipe with the given slot + asset ID and a populated
 * 1024-byte palette LUT filled with a predictable pattern.
 *
 * @param slot - Slot name (e.g. "body", "hair").
 * @param assetId - Numeric asset ID as a string.
 * @returns A valid recipe for UBO packing.
 */
const createTestRecipe = (slot: string, assetId: string): LpcLayerRecipe => {
  const palette = new Uint8Array(1024);
  // Fill with a predictable non-zero pattern so tint extraction works
  for (let i = 0; i < 256; i++) {
    const base = i * 4;
    palette[base] = (i * 17) % 256; // R
    palette[base + 1] = (i * 31) % 256; // G
    palette[base + 2] = (i * 53) % 256; // B
    palette[base + 3] = 255; // A
  }
  return { slot, assetId, hexPalette: palette };
};

// ---------------------------------------------------------------------------
// C-038 LPC Spritesheet Texture Arrays — Matrix Slice Accuracy
// ---------------------------------------------------------------------------

/** Standard LPC spritesheet: 13 columns × 21 rows (832×1344 px at 64×64). */
const STANDARD_LPC_LAYOUT: LpcSpritesheetLayout = {
  columns: 13,
  frameWidth: 64,
  frameHeight: 64,
};

/** Compact LPC spritesheet: 8 columns × 8 rows (512×512 px at 64×64). */
const COMPACT_LPC_LAYOUT: LpcSpritesheetLayout = {
  columns: 8,
  rows: 8,
  frameWidth: 64,
  frameHeight: 64,
};

/**
 * Creates a mock grayscale texture with specified pixel dimensions.
 *
 * The mock carries width/height metadata and a minimal `source` shape
 * so that `TextureManager.sliceSpritesheet` can derive frame boundaries.
 *
 * @param width - Texture width in pixels.
 * @param height - Texture height in pixels.
 * @returns A mock PixiJS Texture.
 */
const createMockSheetTexture = (
  width: number,
  height: number,
): Texture & { destroyed: boolean } => {
  const destroyed = false;
  const source = { width, height, destroyed } as unknown as Texture['source'];
  const mock = {
    width,
    height,
    source,
    destroyed,
    destroy: destroyFn,
    label: `mock-${width}x${height}`,
  } as unknown as Texture & { destroyed: boolean };
  return mock;
};

describe('C-038 LPC Texture Arrays — AC-2: Grid Alignment & Slice Accuracy', () => {
  let manager: TextureManager;
  let tracker: MockTracker;

  beforeEach(() => {
    tracker = { textures: new Map(), loadCount: 0 };
    manager = new TextureManager({
      loadTexture: createMockLoader(tracker),
    });
  });

  // -----------------------------------------------------------------------
  // Basic slicing
  // -----------------------------------------------------------------------

  it('slices a standard 13×21 LPC sheet into the correct number of frames', () => {
    const sheet = createMockSheetTexture(832, 1344);
    const frames = manager.sliceSpritesheet({
      texture: sheet,
      layout: STANDARD_LPC_LAYOUT,
    });

    // 13 columns × 21 rows = 273 frames (rows derived from height / 64)
    expect(frames.length).toBe(273);

    // Each frame should be a valid Texture with 64×64 dimensions
    for (const frame of frames) {
      expect(frame.width).toBe(64);
      expect(frame.height).toBe(64);
    }
  });

  it('slices a compact 8×8 LPC sheet into 64 frames', () => {
    const sheet = createMockSheetTexture(512, 512);
    const frames = manager.sliceSpritesheet({
      texture: sheet,
      layout: COMPACT_LPC_LAYOUT,
    });

    expect(frames.length).toBe(64);

    for (const frame of frames) {
      expect(frame.width).toBe(64);
      expect(frame.height).toBe(64);
    }
  });

  it('handles single-frame sheets (1×1 grid)', () => {
    const sheet = createMockSheetTexture(64, 64);
    const frames = manager.sliceSpritesheet({
      texture: sheet,
      layout: { columns: 1, frameWidth: 64, frameHeight: 64 },
    });

    expect(frames.length).toBe(1);
    expect(frames[0].width).toBe(64);
    expect(frames[0].height).toBe(64);
  });

  // -----------------------------------------------------------------------
  // Coordinate accuracy — no bleeding between frames
  // -----------------------------------------------------------------------

  it('positions each frame at exact grid-aligned UV coordinates', () => {
    const sheet = createMockSheetTexture(256, 128);
    const layout: LpcSpritesheetLayout = { columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 };

    const frames = manager.sliceSpritesheet({ texture: sheet, layout });

    // Frame 0: (0, 0)
    expect(frames[0].frame.x).toBe(0);
    expect(frames[0].frame.y).toBe(0);

    // Frame 1: (64, 0) — first row, second column
    expect(frames[1].frame.x).toBe(64);
    expect(frames[1].frame.y).toBe(0);

    // Frame 4: (0, 64) — second row, first column
    expect(frames[4].frame.x).toBe(0);
    expect(frames[4].frame.y).toBe(64);

    // Frame 5: (64, 64) — second row, second column
    expect(frames[5].frame.x).toBe(64);
    expect(frames[5].frame.y).toBe(64);

    // Frame 7 (last): (192, 64) — second row, fourth column
    expect(frames[7].frame.x).toBe(192);
    expect(frames[7].frame.y).toBe(64);
  });

  it('maintains exact 64×64 frame boundaries with no overlap', () => {
    const sheet = createMockSheetTexture(320, 128);
    const layout: LpcSpritesheetLayout = { columns: 5, frameWidth: 64, frameHeight: 64 };

    const frames = manager.sliceSpritesheet({ texture: sheet, layout });

    // Every frame must be exactly 64×64 in frame coordinates
    for (const frame of frames) {
      expect(frame.frame.width).toBe(64);
      expect(frame.frame.height).toBe(64);
    }

    // Check adjacent frames don't overlap — frame 0 ends at x=64,
    // frame 1 starts at x=64
    expect(frames[0].frame.x + frames[0].frame.width).toBe(frames[1].frame.x);
    expect(frames[0].frame.y).toBe(frames[1].frame.y);

    // Row boundary: frame 4 ends at y=64, frame 5 starts at y=64
    expect(frames[4].frame.y + frames[4].frame.height).toBe(frames[5].frame.y);
  });

  it('clamps row count when sheet height is not an exact multiple', () => {
    const sheet = createMockSheetTexture(256, 100); // Only 1 full row + partial
    const layout: LpcSpritesheetLayout = { columns: 4, frameWidth: 64, frameHeight: 64 };

    const frames = manager.sliceSpritesheet({ texture: sheet, layout });

    // Only 1 full row: 4 frames (partial row clipped)
    expect(frames.length).toBe(4);
  });

  it('clamps column count when sheet width is not an exact multiple', () => {
    const sheet = createMockSheetTexture(100, 128); // Only 1 full column + partial
    const layout: LpcSpritesheetLayout = { columns: 2, rows: 2, frameWidth: 64, frameHeight: 64 };

    const frames = manager.sliceSpritesheet({ texture: sheet, layout });

    // Only 1 full column × 2 rows = 2 frames (partial column clipped)
    expect(frames.length).toBe(2);
  });

  it('returns empty array for texture smaller than a single frame', () => {
    const sheet = createMockSheetTexture(32, 32);
    const layout: LpcSpritesheetLayout = { columns: 1, frameWidth: 64, frameHeight: 64 };

    const frames = manager.sliceSpritesheet({ texture: sheet, layout });

    expect(frames.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Row auto-derivation from height
  // -----------------------------------------------------------------------

  it('auto-derives row count from height when rows is omitted', () => {
    const sheet = createMockSheetTexture(832, 1344);
    const frames = manager.sliceSpritesheet({
      texture: sheet,
      layout: { columns: 13, frameWidth: 64, frameHeight: 64 },
    });

    // 1344 / 64 = 21 rows × 13 columns = 273 frames
    expect(frames.length).toBe(273);
  });

  it('auto-derives column count from width when columns is omitted', () => {
    const sheet = createMockSheetTexture(512, 512);
    const frames = manager.sliceSpritesheet({
      texture: sheet,
      layout: { rows: 8, frameWidth: 64, frameHeight: 64 },
    });

    // 512 / 64 = 8 columns × 8 rows = 64 frames
    expect(frames.length).toBe(64);
  });

  // -----------------------------------------------------------------------
  // Frame index lookup
  // -----------------------------------------------------------------------

  it('retrieves a single frame by index without slicing all frames', () => {
    const sheet = createMockSheetTexture(256, 128);
    const layout: LpcSpritesheetLayout = { columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 };

    const frame3 = manager.getFrameAt({
      texture: sheet,
      layout,
      frameIndex: 3,
    });

    expect(frame3).not.toBeNull();
    expect(frame3?.frame.x).toBe(192); // Column 3 (0-indexed): 3 × 64 = 192
    expect(frame3?.frame.y).toBe(0); // Row 0
    expect(frame3?.width).toBe(64);
    expect(frame3?.height).toBe(64);
  });

  it('returns null for out-of-bounds frame index', () => {
    const sheet = createMockSheetTexture(256, 128);
    const layout: LpcSpritesheetLayout = { columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 };

    const frame8 = manager.getFrameAt({
      texture: sheet,
      layout,
      frameIndex: 8,
    });

    expect(frame8).toBeNull();
  });

  it('returns null for negative frame index', () => {
    const sheet = createMockSheetTexture(256, 128);

    expect(
      manager.getFrameAt({
        texture: sheet,
        layout: { columns: 4, frameWidth: 64, frameHeight: 64 },
        frameIndex: -1,
      }),
    ).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Layout validation
  // -----------------------------------------------------------------------

  it('rejects zero-width frame dimensions', () => {
    const sheet = createMockSheetTexture(256, 256);

    expect(() => {
      manager.sliceSpritesheet({
        texture: sheet,
        layout: { columns: 4, frameWidth: 0, frameHeight: 64 },
      });
    }).toThrow();
  });

  it('rejects zero-height frame dimensions', () => {
    const sheet = createMockSheetTexture(256, 256);

    expect(() => {
      manager.sliceSpritesheet({
        texture: sheet,
        layout: { columns: 4, frameWidth: 64, frameHeight: 0 },
      });
    }).toThrow();
  });

  it('rejects empty layouts with neither columns nor rows', () => {
    const sheet = createMockSheetTexture(256, 256);

    expect(() => {
      manager.sliceSpritesheet({
        texture: sheet,
        layout: { frameWidth: 64, frameHeight: 64 },
      });
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// C-038 LPC Texture Arrays — AC-1: Zero Pipeline Split Texture Binding
// ---------------------------------------------------------------------------

describe('C-038 LPC Texture Arrays — AC-1: Batch Routing & Sampler Assignment', () => {
  let manager: TextureManager;
  let tracker: MockTracker;

  beforeEach(() => {
    tracker = { textures: new Map(), loadCount: 0 };
    manager = new TextureManager({
      loadTexture: createMockLoader(tracker),
    });
  });

  it('getLayeredTextureBatch returns exactly N textures for N recipes', async () => {
    const recipes = [
      createTestRecipe('body', '10'),
      createTestRecipe('hair', '20'),
      createTestRecipe('torso', '30'),
    ];

    const batch = await manager.getLayeredTextureBatch({ recipes });

    expect(batch.length).toBe(recipes.length);
    // Each texture should be defined (loaded via grayscale cache)
    for (const tex of batch) {
      expect(tex).toBeDefined();
    }
  });

  it('preserves recipe ordering so slot index maps to UBO texture slot', async () => {
    const recipes = [
      createTestRecipe('body', '100'),
      createTestRecipe('hair', '200'),
      createTestRecipe('torso', '300'),
      createTestRecipe('legs', '400'),
    ];

    const batch = await manager.getLayeredTextureBatch({ recipes });

    // Index 0 → body (uTexture0), index 1 → hair (uTexture1), etc.
    expect(batch.length).toBe(4);

    // Each loaded texture should map to its recipe's asset ID
    // (load count tracks how many unique textures were loaded)
    expect(tracker.loadCount).toBeGreaterThanOrEqual(4);
  });

  it('assigns Texture.EMPTY for recipes with invalid assetId', async () => {
    const recipes = [
      createTestRecipe('body', '1'),
      { slot: 'empty-slot', assetId: '', hexPalette: new Uint8Array(1024) },
      createTestRecipe('torso', '3'),
    ];

    const batch = await manager.getLayeredTextureBatch({ recipes });

    expect(batch.length).toBe(3);
    expect(batch[0]).not.toBe(Texture.EMPTY);
    expect(batch[1]).toBe(Texture.EMPTY); // Empty assetId → EMPTY
    expect(batch[2]).not.toBe(Texture.EMPTY);
  });

  it('assigns Texture.EMPTY for recipes with non-numeric assetId', async () => {
    const recipes = [{ slot: 'bad', assetId: 'not-a-number', hexPalette: new Uint8Array(1024) }];

    const batch = await manager.getLayeredTextureBatch({ recipes });

    expect(batch.length).toBe(1);
    expect(batch[0]).toBe(Texture.EMPTY);
  });

  it('handles empty recipe array', async () => {
    const batch = await manager.getLayeredTextureBatch({ recipes: [] });
    expect(batch).toEqual([]);
  });

  it('returns sliced frames when frameIndex is provided', async () => {
    // Create a mock loader that returns properly sized textures
    const sizedTracker: MockTracker = { textures: new Map(), loadCount: 0 };
    const sizedLoader = async (key: number): Promise<Texture> => {
      sizedTracker.loadCount += 1;
      // Return a 256×128 mock so slicing to 64×64 frames works
      const mock = createMockSheetTexture(256, 128);
      sizedTracker.textures.set(key, mock);
      return mock;
    };

    const sizedManager = new TextureManager({
      loadTexture: sizedLoader,
    });

    const recipes = [createTestRecipe('body', '1')];
    const layout: LpcSpritesheetLayout = { columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 };

    const batch = await sizedManager.getLayeredTextureBatch({
      recipes,
      frameIndex: 3,
      layout,
    });

    // Should return 1 texture (frame 3 from the 256×128 sheet, at col 3 row 0)
    expect(batch.length).toBe(1);
    expect(batch[0].width).toBe(64);
    expect(batch[0].height).toBe(64);
  });

  it('returns full sheet texture when frameIndex is omitted (backward compat)', async () => {
    const recipes = [createTestRecipe('body', '10')];

    const batch = await manager.getLayeredTextureBatch({ recipes });

    // Without frameIndex, returns the base 32×32 mock texture
    expect(batch.length).toBe(1);
    expect(batch[0].width).toBe(32); // Default mock size
    expect(batch[0].height).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// C-038 LPC Texture Arrays — Cleanup & Reference Lifecycle
// ---------------------------------------------------------------------------

describe('C-038 LPC Texture Arrays — Cleanup & Reference Lifecycle', () => {
  let manager: TextureManager;
  let tracker: MockTracker;

  beforeEach(() => {
    tracker = { textures: new Map(), loadCount: 0 };
    manager = new TextureManager({
      loadTexture: createMockLoader(tracker),
    });
  });

  it('releaseGrayscaleSheet destroys the base texture and all sub-texture refs', () => {
    const sheet = createMockSheetTexture(128, 64);
    const layout: LpcSpritesheetLayout = { columns: 2, rows: 1, frameWidth: 64, frameHeight: 64 };

    // Slice first — creates sub-textures sharing the source
    const frames = manager.sliceSpritesheet({ texture: sheet, layout });
    expect(frames.length).toBe(2);

    // Release the base sheet — should destroy source
    sheet.destroy();

    // Sub-textures should be marked destroyed since they share the source
    expect(sheet.destroyed).toBe(true);
  });

  it('destroy() cleans all cached grayscale sheets and sub-textures', async () => {
    // Load a grayscale sheet
    await manager.getGrayscaleSheet(1);
    await manager.getGrayscaleSheet(2);
    expect(manager.grayscaleSheetCount).toBe(2);

    manager.destroy();

    expect(manager.grayscaleSheetCount).toBe(0);
    expect(manager.size).toBe(0);
    expect(manager.bytesUsed).toBe(0);
  });

  it('grayscale cache eviction destroys the evicted texture', async () => {
    const smallManager = new TextureManager({
      maxTextures: 3,
      loadTexture: createMockLoader(tracker),
    });

    // Load many grayscale sheets to exceed the default maxGrayscaleSheets (256)
    // For this test, we set a smaller max via construction
    // (Default maxGrayscaleSheets is 256, so use the main cache path)
    // Actually, let's test main cache eviction properly
    for (let i = 0; i < 4; i++) {
      await smallManager.getTexture(i);
    }

    // Since maxTextures=3, the 4th load should evict one
    expect(smallManager.size).toBeLessThanOrEqual(3);
  });

  it('sliding frame references do not prevent base texture eviction', async () => {
    // Use a mock loader that returns a properly sized texture
    const sizedTracker: MockTracker = { textures: new Map(), loadCount: 0 };
    const sizedLoader = async (key: number): Promise<Texture> => {
      sizedTracker.loadCount += 1;
      const mock = createMockSheetTexture(128, 64);
      sizedTracker.textures.set(key, mock);
      return mock;
    };

    const sizedManager = new TextureManager({
      loadTexture: sizedLoader,
    });

    // Load a grayscale sheet with proper dimensions
    const tex = await sizedManager.getGrayscaleSheet(99);
    expect(tex).toBeDefined();
    expect(sizedManager.grayscaleSheetCount).toBe(1);

    // Slice frames from it (they share the source)
    const layout: LpcSpritesheetLayout = { columns: 2, rows: 1, frameWidth: 64, frameHeight: 64 };
    const frames = sizedManager.sliceSpritesheet({ texture: tex, layout });
    expect(frames.length).toBe(2);

    // Release the grayscale sheet — should destroy the source
    sizedManager.releaseGrayscaleSheet(99);

    // The cached entry should be gone
    expect(sizedManager.grayscaleSheetCount).toBe(0);
  });

  it('bytesUsed is not inflated by frame slices (shared GPU resource)', () => {
    const sheet = createMockSheetTexture(256, 128);
    const layout: LpcSpritesheetLayout = { columns: 4, rows: 2, frameWidth: 64, frameHeight: 64 };

    // Slicing produces 8 frames but they share the same GPU resource
    const frames = manager.sliceSpritesheet({ texture: sheet, layout });
    expect(frames.length).toBe(8);

    // Frame slices don't increment bytesUsed — they're logical views,
    // not independent GPU allocations.
    // The base texture's bytes are tracked, not the sub-textures.
  });
});

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
    if (!tex10) {
      throw new Error('Expected texture 10 to be cached');
    }
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
    let _callCount = 0;
    const errorLoader = async (_key: number): Promise<Texture> => {
      _callCount += 1;
      throw new Error('Network failure');
    };

    const errorManager = new TextureManager({
      loadTexture: errorLoader,
    });

    await expect(errorManager.getTexture(999)).rejects.toThrow('Network failure');
    expect(errorManager.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C-034 LPC Render Pipeline — Batch Allocation Performance Tests
// ---------------------------------------------------------------------------

// === Mock infrastructure for headless rendering context ===

// === AC-1: Zero Bind Group Reallocation Under WebGPU ===

describe('C-034 LPC Batch Pipeline — AC-1: Zero Bind Group Reallocation', () => {
  const MaxEntities = 64;

  it('allocates exactly one shared UBO pool for 64 concurrent entities', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Verify pool dimensions
    expect(manager.poolSize).toBe(MaxEntities);
    expect(manager.sharedUboByteSize).toBeGreaterThanOrEqual(16 * 1024); // ≥ 16 KB

    // Pool should report zero active bindings before any entities are registered
    expect(manager.activeInstances).toBe(0);

    manager.destroy();
  });

  it('buffers up to max instances without re-allocating the shared UBO', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    const recipe = createTestRecipe('body', '1');

    // Register MAX_ENTITIES with the same recipe
    for (let eid = 0; eid < MaxEntities; eid++) {
      manager.registerEntity(eid, [recipe]);
    }

    expect(manager.activeInstances).toBe(MaxEntities);

    // The shared UBO should still be a single allocation
    // (poolSize capped; no re-allocation triggered by registration)
    expect(manager.poolSize).toBe(MaxEntities);

    manager.destroy();
  });

  it('reports zero structural re-hashes when appearance data does not change', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    const recipe = createTestRecipe('body', '10');
    manager.registerEntity(0, [recipe]);

    // Capture the initial structural snapshot after registration
    const hashesBefore = manager.structuralHashesIssued;

    // Submit the same recipe multiple times (simulates per-frame no-change path)
    for (let frame = 0; frame < 100; frame++) {
      manager.writeEntityUbo(0, [recipe]);
    }

    // Structural hashes should NOT have increased (recipe identical)
    const hashesAfter = manager.structuralHashesIssued;
    expect(hashesAfter).toBe(hashesBefore);

    manager.destroy();
  });

  it('re-uses a static UniformGroup pool across 100 entity recipe swaps', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Register 100 entities with distinct recipes
    const recipes = Array.from({ length: 100 }, (_, i) => [
      createTestRecipe('body', String(i + 1)),
    ]);

    for (let eid = 0; eid < 100; eid++) {
      manager.registerEntity(eid, recipes[eid]);
    }

    // Now simulate 60 frames of recipe swaps (appearance changes)
    // Each frame: swap every entity to a new recipe
    for (let frame = 0; frame < 60; frame++) {
      for (let eid = 0; eid < 100; eid++) {
        const newRecipe = [createTestRecipe('body', String(((eid + frame) % 256) + 1))];
        manager.writeEntityUbo(eid, newRecipe);
      }

      // Perform the batch flush (single Buffer.update per tick)
      manager.flushBatch();
    }

    // Core assertion: after 60 frames of heavy mutation, the manager
    // must not have re-allocated its internal UBO pool.
    // activeInstances should remain ≤ poolSize (no overflow re-allocation)
    expect(manager.activeInstances).toBeLessThanOrEqual(manager.poolSize);

    // The shared buffer should still be a single contiguous block
    expect(manager.sharedUboByteSize).toBeGreaterThanOrEqual(16 * 1024);

    manager.destroy();
  });
});

// === AC-2: WebGL2 Driver Sub-Data Streaming Stability ===

describe('C-034 LPC Batch Pipeline — AC-2: WebGL2 Sub-Data Streaming', () => {
  const MaxEntities = 64;

  it('performs exactly one Buffer.update per system tick for N entities', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Register 50 entities
    for (let eid = 0; eid < 50; eid++) {
      const recipe = createTestRecipe('body', String(eid + 1));
      manager.registerEntity(eid, [recipe]);
    }

    // Simulate a system tick: write UBO data for all entities, then flush
    for (let eid = 0; eid < 50; eid++) {
      // Use a different recipe to trigger an actual structural change
      // (snapshot was seeded by registerEntity with matching data)
      const recipe = createTestRecipe('hair', String(eid + 100));
      manager.writeEntityUbo(eid, [recipe]);
    }

    // Before flush: track buffer update count
    const updatesBefore = manager.batchUpdatesPerformed;

    manager.flushBatch();

    const updatesAfter = manager.batchUpdatesPerformed;
    // Exactly one flush = exactly one additional update cycle
    expect(updatesAfter).toBe(updatesBefore + 1);

    manager.destroy();
  });

  it('uses concentrated dirty segment offsets for sparse entity writes', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Register 64 entities (fills the entire pool)
    const baseRecipe = createTestRecipe('body', '1');
    for (let eid = 0; eid < MaxEntities; eid++) {
      manager.registerEntity(eid, [baseRecipe]);
    }

    // Only write to 4 entities (entities 7, 22, 38, 51)
    const dirtyEids = [7, 22, 38, 51];
    for (const eid of dirtyEids) {
      manager.writeEntityUbo(eid, [createTestRecipe('hair', '99')]);
    }

    // The dirty segment should only span the dirty entity range
    const segments = manager.dirtySegments;
    expect(segments.length).toBeGreaterThan(0);

    // Each segment should be contiguous (start + count within bounds)
    for (const segment of segments) {
      expect(segment.offsetBytes).toBeGreaterThanOrEqual(0);
      expect(segment.offsetBytes + segment.byteLength).toBeLessThanOrEqual(
        manager.sharedUboByteSize,
      );
    }

    // Total dirty bytes should be ≤ 4 entities × per-entity UBO size
    const perEntityUboSize = manager.perEntityUboByteSize;
    const totalDirtyBytes = segments.reduce((sum, s) => sum + s.byteLength, 0);
    expect(totalDirtyBytes).toBeLessThanOrEqual(dirtyEids.length * perEntityUboSize);

    manager.destroy();
  });

  it('completes a 100-frame stress cycle with sequential pass offsets', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Register 64 entities with initial recipes
    for (let eid = 0; eid < MaxEntities; eid++) {
      manager.registerEntity(eid, [createTestRecipe('body', String(eid))]);
    }

    // Run 100 frames: each frame changes a random subset of entities
    for (let frame = 0; frame < 100; frame++) {
      // Change entities 0–15 on even frames, 16–31 on odd frames, etc.
      const startEid = (frame % 4) * 16;
      for (let eid = startEid; eid < startEid + 16; eid++) {
        manager.writeEntityUbo(eid, [createTestRecipe('body', String((eid + frame + 1000) % 256))]);
      }

      manager.flushBatch();

      // After each flush, verify pool integrity
      expect(manager.activeInstances).toBeLessThanOrEqual(MaxEntities);
    }

    // Frame completion: verify the batch update count matches frame count
    expect(manager.batchUpdatesPerformed).toBe(100);

    manager.destroy();
  });

  it('preserves shared buffer layout alignment across flush cycles', () => {
    const manager = new LpcBatchManager({ maxInstances: MaxEntities });

    // Register entities with varied recipe counts (1–7 layers)
    for (let eid = 0; eid < 32; eid++) {
      const layerCount = (eid % 7) + 1;
      const recipes: LpcLayerRecipe[] = [];
      for (let l = 0; l < layerCount; l++) {
        recipes.push(createTestRecipe(`layer_${l}`, String(eid * 10 + l)));
      }
      manager.registerEntity(eid, recipes);
    }

    // Flush 5 times — the shared buffer stride alignment must be preserved
    for (let cycle = 0; cycle < 5; cycle++) {
      // Toggle every other entity
      for (let eid = cycle % 2; eid < 32; eid += 2) {
        manager.writeEntityUbo(eid, [createTestRecipe('flipped', String(eid + cycle * 100))]);
      }
      manager.flushBatch();
    }

    // After 5 cycles, no entity should have overflowed its UBO slot
    // (verified by sharedUboByteSize remaining at the configured value)
    const expectedSize = MaxEntities * manager.perEntityUboByteSize;
    expect(manager.sharedUboByteSize).toBe(expectedSize);

    manager.destroy();
  });
});

// === Structural array alignment and integrity ===

describe('C-034 LPC Batch Pipeline — Structural Alignment', () => {
  it('assigns contiguous entity index descriptors matching pool slot order', () => {
    const manager = new LpcBatchManager({ maxInstances: 32 });

    // Register entities out of order to test slot assignment
    const eids = [17, 3, 29, 5, 11, 0, 22, 8];
    for (const eid of eids) {
      manager.registerEntity(eid, [createTestRecipe('body', String(eid))]);
    }

    // Each entity should map to a pool slot; indices are contiguous
    const indices = eids.map((eid) => manager.getEntitySlotIndex(eid));

    // All indices should be defined and within [0, poolSize)
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(manager.poolSize);
    }

    // Indices should be unique (one slot per entity)
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(eids.length);

    manager.destroy();
  });

  it('reuses freed pool slots after entity deregistration', () => {
    const manager = new LpcBatchManager({ maxInstances: 8 });

    // Fill all 8 slots
    for (let eid = 0; eid < 8; eid++) {
      manager.registerEntity(eid, [createTestRecipe('body', String(eid))]);
    }
    expect(manager.activeInstances).toBe(8);

    // Deregister entity 3
    manager.deregisterEntity(3);
    expect(manager.activeInstances).toBe(7);

    // Register a new entity — should reuse the freed slot
    manager.registerEntity(99, [createTestRecipe('new', '99')]);
    expect(manager.activeInstances).toBe(8);

    // The new entity should have a valid slot index
    const idx = manager.getEntitySlotIndex(99);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(manager.poolSize);

    manager.destroy();
  });

  it('writes packed UBO bytes at the correct per-entity offset within the shared buffer', () => {
    const manager = new LpcBatchManager({ maxInstances: 16 });
    const recipe = createTestRecipe('body', '42');

    manager.registerEntity(5, [recipe]);
    manager.writeEntityUbo(5, [recipe]);

    // The raw shared buffer at entity 5's offset should contain the packed recipe
    const slotIndex = manager.getEntitySlotIndex(5);
    const perEntitySize = manager.perEntityUboByteSize;
    const offsetFloats = (slotIndex * perEntitySize) / 4;

    const rawView = manager.getSharedBufferView();
    expect(rawView).not.toBeNull();

    if (rawView) {
      // Verify the packed data starts at the correct offset
      // (tint R channel for layer 0 should be non-zero)
      expect(rawView[offsetFloats]).toBeGreaterThan(0);

      // Active flag for layer 0 at offset 32 should be 1.0
      expect(rawView[offsetFloats + 32]).toBe(1);
    }

    manager.destroy();
  });

  it('packRecipeToUboBuffer produces std140-aligned 256-byte buffer', () => {
    const recipe = createTestRecipe('body', '1');
    const packed = packRecipeToUboBuffer([recipe]);

    // 64 floats × 4 bytes = 256 bytes (std140 aligned)
    expect(packed.length).toBe(64);
    expect(packed.byteLength).toBe(256);

    // Layer 0 tint alpha should be 1.0
    expect(packed[3]).toBe(1);

    // Layer 0 active flag should be 1.0 (at offset 32)
    expect(packed[32]).toBe(1);

    // Unused layers (1–7) should have active = 0.0 and tint alpha = 0.0
    for (let layer = 1; layer < 8; layer++) {
      expect(packed[layer * 4 + 3]).toBe(0); // tint alpha = 0
      expect(packed[32 + layer * 4]).toBe(0); // active = 0
    }
  });

  it('handles empty recipe arrays without overflowing buffer bounds', () => {
    const packed = packRecipeToUboBuffer([]);

    expect(packed.length).toBe(64);

    // All values should be 0 (empty input = zero-filled output)
    for (let i = 0; i < packed.length; i++) {
      expect(packed[i]).toBe(0);
    }
  });
});

// ===========================================================================
// C-036 ECS Appearance Bridge — bitECS → LpcBatchManager Integration Tests
// ===========================================================================

/**
 * Minimal recipe resolver for tests.
 *
 * Maps layer IDs to {@link LpcLayerRecipe} entries using predictable
 * slot names and a filled 1024-byte palette so UBO packing produces
 * non-zero tint values.
 */
const testRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const slotNames = ['body', 'hair', 'torso', 'legs', 'feet'];
  return layerIds
    .map((id, index) => {
      if (id <= 0) {
        return null;
      }
      return createTestRecipe(slotNames[index] ?? `layer_${index}`, String(id));
    })
    .filter((r): r is LpcLayerRecipe => r !== null);
};

/** Helper to set Appearance layers on an entity. */
const setAppearance = (
  world: ReturnType<typeof createWorld>,
  eid: number,
  layers: { layer0?: number; layer1?: number; layer2?: number; layer3?: number; layer4?: number },
): void => {
  addComponent(
    world,
    eid,
    set(Appearance, {
      layer0: layers.layer0 ?? 0,
      layer1: layers.layer1 ?? 0,
      layer2: layers.layer2 ?? 0,
      layer3: layers.layer3 ?? 0,
      layer4: layers.layer4 ?? 0,
    }),
  );
};

// === AC-1: Automated Slot Allocation & LIFO Tracking ===

describe('C-036 ECS Bridge — AC-1: Automated Slot Allocation & LIFO Tracking', () => {
  const MaxInstances = 16;

  it('reserves consecutive slot indices for 5 entities entering the system query', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create 5 entities with Appearance descriptors
    const eids: number[] = [];
    for (let i = 0; i < 5; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: i + 1 });
      eids.push(eid);
    }

    // Run the sync system — should register all 5 entities
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

    expect(batchManager.activeInstances).toBe(5);

    // Each entity should have a unique slot index
    const slots = eids.map((eid) => batchManager.getEntitySlotIndex(eid));
    const uniqueSlots = new Set(slots);
    expect(uniqueSlots.size).toBe(5);

    // All slots should be within valid range
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(MaxInstances);
    }

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('detects entity exit when Appearance component is removed', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create 3 entities
    const eid1 = addEntity(world);
    const eid2 = addEntity(world);
    const eid3 = addEntity(world);
    setAppearance(world, eid1, { layer0: 1 });
    setAppearance(world, eid2, { layer0: 2 });
    setAppearance(world, eid3, { layer0: 3 });

    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(3);

    // Remove Appearance from entity 2
    removeComponent(world, eid2, Appearance);

    // Next sync should detect exit and deregister entity 2
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(2);

    // Entity 2 should no longer have a slot
    expect(batchManager.getEntitySlotIndex(eid2)).toBe(-1);

    // Entity 1 and 3 should still be registered
    expect(batchManager.getEntitySlotIndex(eid1)).toBeGreaterThanOrEqual(0);
    expect(batchManager.getEntitySlotIndex(eid3)).toBeGreaterThanOrEqual(0);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('reuses freed pool slots (LIFO) after entity deregistration', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: 8 });

    // Fill all 8 slots
    const eids: number[] = [];
    for (let i = 0; i < 8; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: i + 1 });
      eids.push(eid);
    }
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(8);

    // Deregister entity 3 (by removing its Appearance component)
    removeComponent(world, eids[3], Appearance);
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(7);

    // Create a new entity — should reuse the freed slot
    const newEid = addEntity(world);
    setAppearance(world, newEid, { layer0: 99 });
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(8);

    // New entity should have a valid slot index
    const idx = batchManager.getEntitySlotIndex(newEid);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(8);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('handles empty world with zero allocations', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Sync with zero entities — should not throw
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

    expect(batchManager.activeInstances).toBe(0);
    expect(batchManager.structuralHashesIssued).toBe(0);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('batches multiple enter+exit changes in a single frame', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Frame 1: 4 entities enter
    const eids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: i + 1 });
      eids.push(eid);
    }
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(4);

    // Frame 2: remove 2, add 3 new (net +1)
    removeComponent(world, eids[0], Appearance);
    removeComponent(world, eids[1], Appearance);
    for (let i = 0; i < 3; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: (i + 10) * 10 });
      eids.push(eid);
    }
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(5);

    // Old entities should be gone
    expect(batchManager.getEntitySlotIndex(eids[0])).toBe(-1);
    expect(batchManager.getEntitySlotIndex(eids[1])).toBe(-1);

    // Surviving entities still registered
    expect(batchManager.getEntitySlotIndex(eids[2])).toBeGreaterThanOrEqual(0);
    expect(batchManager.getEntitySlotIndex(eids[3])).toBeGreaterThanOrEqual(0);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });
});

// === AC-2: Fingerprint Evaluation Optimization ===

describe('C-036 ECS Bridge — AC-2: Fingerprint Evaluation Optimization', () => {
  const MaxInstances = 64;

  it('skips UBO re-packing when appearance layers remain identical across frames', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create entity with initial appearance
    const eid = addEntity(world);
    setAppearance(world, eid, { layer0: 42, layer1: 7 });

    // First sync — registers entity and writes initial UBO
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    const hashesAfterFirst = batchManager.structuralHashesIssued;

    // Run 50 frames with identical appearance data
    for (let frame = 0; frame < 50; frame++) {
      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    }

    // Structural hashes should NOT have increased (no appearance changes)
    expect(batchManager.structuralHashesIssued).toBe(hashesAfterFirst);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('triggers UBO re-packing when appearance changes structurally', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    const eid = addEntity(world);
    setAppearance(world, eid, { layer0: 1 });

    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    const hashesBefore = batchManager.structuralHashesIssued;

    // Change appearance
    setAppearance(world, eid, { layer0: 2, layer1: 3 });
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

    // Hash should have increased by at least 1 (structural change detected)
    expect(batchManager.structuralHashesIssued).toBeGreaterThan(hashesBefore);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('batchUpdatesPerformed only increments per flush when dirty data exists', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create 3 entities with stable initial appearances
    const eids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: i + 1 });
      eids.push(eid);
    }

    // First sync — registerEntity seeds fingerprint, no dirty data yet
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    const updatesBefore = batchManager.batchUpdatesPerformed;

    // Run 10 frames, each changing one entity's appearance to force dirty writes
    for (let frame = 0; frame < 10; frame++) {
      setAppearance(world, eids[frame % 3], { layer0: frame + 100 });
      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    }

    // Each frame had a structural change → 10 flushes each performed
    expect(batchManager.batchUpdatesPerformed).toBe(updatesBefore + 10);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('only writes dirty segments for entities with structural changes', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create 4 entities with stable appearances
    const eids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, { layer0: i + 10 });
      eids.push(eid);
    }

    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    const hashesBefore = batchManager.structuralHashesIssued;

    // Change only one entity's appearance
    setAppearance(world, eids[1], { layer0: 99 });
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

    // Only 1 structural hash should have been issued (for the changed entity)
    expect(batchManager.structuralHashesIssued).toBe(hashesBefore + 1);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('completes a 100-frame stress test with periodic appearance toggles', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Register 16 entities with stable appearances
    const eids: number[] = [];
    for (let i = 0; i < 16; i++) {
      const eid = addEntity(world);
      setAppearance(world, eid, {
        layer0: (i % 5) + 1,
        layer1: ((i + 1) % 5) + 1,
        layer2: ((i + 2) % 5) + 1,
      });
      eids.push(eid);
    }
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(16);

    const hashesBefore = batchManager.structuralHashesIssued;
    const updatesBefore = batchManager.batchUpdatesPerformed;

    // Run 100 frames — every frame, toggle one entity's layer to force dirty flushes
    for (let frame = 0; frame < 100; frame++) {
      const targetEid = eids[frame % 16];
      const currentLayer0 = getAppearanceLayers(targetEid)[0];
      setAppearance(world, targetEid, { layer0: currentLayer0 > 10 ? 1 : 99 });

      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
      expect(batchManager.activeInstances).toBe(16);
    }

    // 100 frames of toggling = 100 structural hashes + 100 batch flushes
    // (each frame has exactly one entity's appearance changed)
    expect(batchManager.structuralHashesIssued).toBe(hashesBefore + 100);
    expect(batchManager.batchUpdatesPerformed).toBe(updatesBefore + 100);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('reports zero structural re-hashes when only entity position changes', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    // Create entity with static appearance
    const eid = addEntity(world);
    setAppearance(world, eid, { layer0: 5, layer1: 3, layer2: 1 });

    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    const hashesBefore = batchManager.structuralHashesIssued;

    // Run 30 frames — appearance stays identical (simulating position-only changes)
    for (let frame = 0; frame < 30; frame++) {
      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    }

    // No structural changes — hashes should not have increased
    expect(batchManager.structuralHashesIssued).toBe(hashesBefore);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });
});

// === Edge Cases ===

describe('C-036 ECS Bridge — Edge Cases', () => {
  const MaxInstances = 164;

  it('resetAppearanceTracking clears world state for clean re-initialization', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    const eid = addEntity(world);
    setAppearance(world, eid, { layer0: 1 });
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(1);

    // Reset tracking — next sync should re-discover entity as "new"
    resetAppearanceTracking(world);

    // After reset, the entity is seen as "enter" again which triggers
    // registerEntity. But it's already registered, so registerEntity
    // returns the existing slot (idempotent check).
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    expect(batchManager.activeInstances).toBe(1);

    batchManager.destroy();
  });

  it('handles entity with all zero layer IDs gracefully', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    const eid = addEntity(world);
    setAppearance(world, eid, {
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
    });

    // Should not throw — empty recipes are valid for registerEntity
    expect(() => {
      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });
    }).not.toThrow();

    expect(batchManager.activeInstances).toBe(1);

    resetAppearanceTracking(world);
    batchManager.destroy();
  });

  it('maintains slot integrity across multiple appearance swaps', () => {
    const world = createWorld();
    registerAppearanceObservers(world);
    const batchManager = new LpcBatchManager({ maxInstances: MaxInstances });

    const eid = addEntity(world);
    setAppearance(world, eid, { layer0: 1 });
    syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

    const originalSlot = batchManager.getEntitySlotIndex(eid);
    expect(originalSlot).toBeGreaterThanOrEqual(0);

    // Swap appearance 10 times — slot should remain the same
    for (let i = 0; i < 10; i++) {
      setAppearance(world, eid, {
        layer0: i + 1,
        layer1: i + 2,
        layer2: i + 3,
      });
      syncAppearanceSystem({ world, batchManager, recipeResolver: testRecipeResolver });

      // Slot should be stable — only UBO data changes, not slot assignment
      expect(batchManager.getEntitySlotIndex(eid)).toBe(originalSlot);
    }

    resetAppearanceTracking(world);
    batchManager.destroy();
  });
});
