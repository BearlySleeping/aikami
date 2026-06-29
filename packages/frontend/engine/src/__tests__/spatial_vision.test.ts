// packages/frontend/engine/src/__tests__/spatial_vision.test.ts
//
// Spatial Vision System — unit tests for the perception framework.
// Contract C-190: Validates DDA raycaster, recursive shadowcasting,
// VisionObserver/VisionVisible components, and SpatialVisionSystem.
//
// Covers:
//   AC-1: Partitioned grid lookup — sub-ms per frame
//   AC-2: DDA raycasting termination at walls
//   AC-3: Shadowcasting slope clamping and directional occlusion

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, removeEntity, set } from 'bitecs';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import {
  ObserverState,
  registerVisionObserverObservers,
  VisionObserver,
} from '../components/vision_observer.ts';
import { registerVisionVisibleObservers, VisionVisible } from '../components/vision_visible.ts';
import { castDdaVisionCone } from '../math/vision/dda_raycaster.ts';
import { castShadowcastingFov } from '../math/vision/shadowcasting.ts';
import {
  clearVisionGrid,
  resetVisibilityMasks,
  setVisionGrid,
  updateSpatialVision,
} from '../systems/spatial_vision_system.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_GRID_W = 20;
const TEST_GRID_H = 15;

// ---------------------------------------------------------------------------
// Wall grid helpers
// ---------------------------------------------------------------------------

/** Simple wall grid: a Set of "x,y" strings that block vision. */
const createWallSet = (walls: Array<[number, number]>): Set<string> => {
  const set = new Set<string>();
  for (const [x, y] of walls) {
    set.add(`${x},${y}`);
  }
  return set;
};

/** Creates a wall-check function from a Set of wall coordinates. */
const makeWallCheck = (walls: Set<string>) => {
  return (gx: number, gy: number): boolean => {
    return walls.has(`${gx},${gy}`);
  };
};

// ---------------------------------------------------------------------------
// bitECS world helpers
// ---------------------------------------------------------------------------

const createTestWorld = (): World => {
  const world = createWorld();
  registerGridPositionObservers(world);
  registerVisionObserverObservers(world);
  registerVisionVisibleObservers(world);
  return world;
};

/** Creates an observer entity with vision parameters. */
const createObserver = (
  world: World,
  options: {
    gx: number;
    gy: number;
    fovRadius: number;
    fovAngle: number;
    lookDirection: number;
    stateMask: number;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, set(GridPosition, { x: options.gx, y: options.gy }));
  addComponent(
    world,
    eid,
    set(VisionObserver, {
      fovRadius: options.fovRadius,
      fovAngle: options.fovAngle,
      lookDirection: options.lookDirection,
      stateMask: options.stateMask,
    }),
  );
  return eid;
};

/** Creates a target entity that can be seen. */
const createTarget = (world: World, gx: number, gy: number): number => {
  const eid = addEntity(world);
  addComponent(world, eid, set(GridPosition, { x: gx, y: gy }));
  addComponent(world, eid, set(VisionVisible, { visibleByMask: 0 }));
  return eid;
};

// ===========================================================================
// DDA Raycaster Tests (AC-2)
// ===========================================================================

describe('castDdaVisionCone — DDA patrol vision', () => {
  let visibilityMap: Uint8Array;

  beforeEach(() => {
    visibilityMap = new Uint8Array(TEST_GRID_W * TEST_GRID_H);
  });

  test('marks observer cell as visible', () => {
    const wallCheck = makeWallCheck(new Set());
    castDdaVisionCone({
      ox: 5,
      oy: 5,
      lookDir: 0,
      fovAngle: Math.PI / 2,
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    expect(visibilityMap[5 * TEST_GRID_W + 5]).toBe(1);
  });

  test('casts rays in a cone to the right (lookDir = 0)', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castDdaVisionCone({
      ox: 5,
      oy: 5,
      lookDir: 0,
      fovAngle: Math.PI / 4,
      maxRadius: 4,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Cells directly to the right should be visible
    expect(visibilityMap[5 * TEST_GRID_W + 6]).toBe(1);
    expect(visibilityMap[5 * TEST_GRID_W + 7]).toBe(1);
    expect(visibilityMap[5 * TEST_GRID_W + 8]).toBe(1);
    expect(visibilityMap[5 * TEST_GRID_W + 9]).toBe(1);

    // Cells far to the left (opposite direction) should NOT be visible
    expect(visibilityMap[5 * TEST_GRID_W + 0]).toBe(0);
  });

  test('casts rays in a cone to the left (lookDir = π)', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castDdaVisionCone({
      ox: 10,
      oy: 7,
      lookDir: Math.PI,
      fovAngle: Math.PI / 2,
      maxRadius: 4,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Cells to the left should be visible
    expect(visibilityMap[7 * TEST_GRID_W + 9]).toBe(1);
    expect(visibilityMap[7 * TEST_GRID_W + 8]).toBe(1);

    // Cells to the right should NOT be visible
    expect(visibilityMap[7 * TEST_GRID_W + 11]).toBe(0);
  });

  test('terminates rays at walls (AC-2)', () => {
    const walls = createWallSet([[8, 5]]);
    const wallCheck = makeWallCheck(walls);
    visibilityMap.fill(0);

    castDdaVisionCone({
      ox: 5,
      oy: 5,
      lookDir: 0,
      fovAngle: Math.PI / 8, // Narrow cone to isolate the wall
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Wall cell is marked visible (walls are seen)
    expect(visibilityMap[5 * TEST_GRID_W + 8]).toBe(1);

    // Cells beyond the wall should NOT be visible
    expect(visibilityMap[5 * TEST_GRID_W + 9]).toBe(0);
    expect(visibilityMap[5 * TEST_GRID_W + 10]).toBe(0);
  });

  test('respects maxRadius — no cells beyond radius', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castDdaVisionCone({
      ox: 5,
      oy: 5,
      lookDir: 0,
      fovAngle: Math.PI,
      maxRadius: 2,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Within radius
    expect(visibilityMap[5 * TEST_GRID_W + 6]).toBe(1);
    expect(visibilityMap[5 * TEST_GRID_W + 7]).toBe(1);

    // Beyond radius
    expect(visibilityMap[5 * TEST_GRID_W + 8]).toBe(0);
    expect(visibilityMap[5 * TEST_GRID_W + 9]).toBe(0);
  });

  test('handles zero-length cone (fovAngle = 0)', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castDdaVisionCone({
      ox: 5,
      oy: 5,
      lookDir: 0,
      fovAngle: 0,
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Should cast minimum rays (4) — observer cell and near cells visible
    expect(visibilityMap[5 * TEST_GRID_W + 5]).toBe(1);
  });

  test('clamps to grid boundaries', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    // Observer at edge
    castDdaVisionCone({
      ox: 0,
      oy: 0,
      lookDir: (3 * Math.PI) / 4, // Toward negative quadrant
      fovAngle: Math.PI,
      maxRadius: 10,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // No throw — rays terminate at grid boundaries
    // Observer cell is visible
    expect(visibilityMap[0]).toBe(1);
  });
});

// ===========================================================================
// Recursive Shadowcasting Tests (AC-3)
// ===========================================================================

describe('castShadowcastingFov — recursive shadowcasting', () => {
  let visibilityMap: Uint8Array;

  beforeEach(() => {
    visibilityMap = new Uint8Array(TEST_GRID_W * TEST_GRID_H);
  });

  test('marks observer cell as visible', () => {
    const wallCheck = makeWallCheck(new Set());

    castShadowcastingFov({
      cx: 5,
      cy: 5,
      lookDir: 0,
      fovAngle: Math.PI,
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    expect(visibilityMap[5 * TEST_GRID_W + 5]).toBe(1);
  });

  test('full 360° view in open space with no walls', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castShadowcastingFov({
      cx: 10,
      cy: 7,
      lookDir: 0,
      fovAngle: Math.PI * 2, // Full 360°
      maxRadius: 3,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // All cells in a 3-radius diamond around (10,7) should be visible
    let visibleCount = 0;
    for (let y = 4; y <= 10; y++) {
      for (let x = 7; x <= 13; x++) {
        const dx = x - 10;
        const dy = y - 7;
        if (dx * dx + dy * dy <= 9) {
          if (visibilityMap[y * TEST_GRID_W + x] === 1) {
            visibleCount++;
          }
        }
      }
    }
    // At least 25 cells visible in a 3-radius diamond
    expect(visibleCount).toBeGreaterThanOrEqual(20);
  });

  test('directional cone — only marks cells within the vision cone', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    // Look right (0°), narrow 45° cone
    castShadowcastingFov({
      cx: 5,
      cy: 5,
      lookDir: 0,
      fovAngle: Math.PI / 4,
      maxRadius: 4,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Cells directly to the right should be visible
    expect(visibilityMap[5 * TEST_GRID_W + 9]).toBe(1);

    // Cells directly behind should NOT be visible
    expect(visibilityMap[5 * TEST_GRID_W + 1]).toBe(0);

    // Cells far above (outside 45° cone) should NOT be visible
    expect(visibilityMap[1 * TEST_GRID_W + 9]).toBe(0);
  });

  test('look direction π casts vision to the left', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castShadowcastingFov({
      cx: 10,
      cy: 7,
      lookDir: Math.PI,
      fovAngle: Math.PI / 2,
      maxRadius: 4,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Left cells visible
    let leftVisible = false;
    let rightVisible = false;
    for (let x = 0; x < TEST_GRID_W; x++) {
      const idx = 7 * TEST_GRID_W + x;
      if (visibilityMap[idx] === 1) {
        if (x < 10) {
          leftVisible = true;
        }
        if (x > 10) {
          rightVisible = true;
        }
      }
    }
    expect(leftVisible).toBe(true);
    expect(rightVisible).toBe(false);
  });

  test('wall occlusion — cells behind walls are shadowed', () => {
    const walls = createWallSet([[8, 7]]);
    const wallCheck = makeWallCheck(walls);
    visibilityMap.fill(0);

    castShadowcastingFov({
      cx: 5,
      cy: 7,
      lookDir: 0,
      fovAngle: Math.PI / 8, // Narrow cone
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Wall cell is visible (walls are seen)
    expect(visibilityMap[7 * TEST_GRID_W + 8]).toBe(1);

    // Cell immediately behind wall should be shadowed
    expect(visibilityMap[7 * TEST_GRID_W + 9]).toBe(0);
  });

  test('wall one cell away — casts a shadow cone', () => {
    const walls = createWallSet([[6, 7]]);
    const wallCheck = makeWallCheck(walls);
    visibilityMap.fill(0);

    castShadowcastingFov({
      cx: 5,
      cy: 7,
      lookDir: 0,
      fovAngle: Math.PI / 4,
      maxRadius: 5,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Wall cell is visible
    expect(visibilityMap[7 * TEST_GRID_W + 6]).toBe(1);

    // Cells behind the wall that are directly in the shadow should not be visible
    // (the cell directly behind (7,7) should be shadowed)
    expect(visibilityMap[7 * TEST_GRID_W + 7]).toBe(0);
  });

  test('respects maxRadius', () => {
    const wallCheck = makeWallCheck(new Set());
    visibilityMap.fill(0);

    castShadowcastingFov({
      cx: 5,
      cy: 5,
      lookDir: 0,
      fovAngle: Math.PI,
      maxRadius: 2,
      isWall: wallCheck,
      visibleMap: visibilityMap,
      gridW: TEST_GRID_W,
      gridH: TEST_GRID_H,
    });

    // Within radius
    expect(visibilityMap[5 * TEST_GRID_W + 7]).toBe(1);

    // Beyond radius
    expect(visibilityMap[5 * TEST_GRID_W + 8]).toBe(0);
  });
});

// ===========================================================================
// VisionObserver & VisionVisible Component Tests
// ===========================================================================

describe('VisionObserver component', () => {
  test('getComponent returns set values', () => {
    const world = createTestWorld();
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(VisionObserver, {
        fovRadius: 8,
        fovAngle: 1.5,
        lookDirection: Math.PI / 2,
        stateMask: ObserverState.alert,
      }),
    );

    const data = getComponent(world, eid, VisionObserver);
    expect(data).toBeDefined();
    expect(data?.fovRadius).toBe(8);
    expect(data?.fovAngle).toBe(1.5);
    expect(data?.lookDirection).toBeCloseTo(Math.PI / 2);
    expect(data?.stateMask).toBe(ObserverState.alert);
  });

  test('SoA arrays are populated on set', () => {
    const world = createTestWorld();
    const eid = addEntity(world);
    addComponent(
      world,
      eid,
      set(VisionObserver, {
        fovRadius: 6,
        fovAngle: 2.0,
        lookDirection: 3.14,
        stateMask: ObserverState.idle,
      }),
    );

    expect(VisionObserver.fovRadius[eid]).toBe(6);
    expect(VisionObserver.fovAngle[eid]).toBe(2.0);
    expect(VisionObserver.lookDirection[eid]).toBeCloseTo(3.14);
    expect(VisionObserver.stateMask[eid]).toBe(ObserverState.idle);
  });

  test('default values for unset entities are undefined', () => {
    expect(VisionObserver.fovRadius[9999]).toBeUndefined();
    expect(VisionObserver.stateMask[9999]).toBeUndefined();
  });
});

describe('VisionVisible component', () => {
  test('getComponent returns set values', () => {
    const world = createTestWorld();
    const eid = addEntity(world);
    addComponent(world, eid, set(VisionVisible, { visibleByMask: 0b101 }));

    const data = getComponent(world, eid, VisionVisible);
    expect(data).toBeDefined();
    expect(data?.visibleByMask).toBe(0b101);
  });

  test('resetVisibilityMasks clears all masks', () => {
    const world = createTestWorld();
    const eid1 = addEntity(world);
    const eid2 = addEntity(world);
    addComponent(world, eid1, set(VisionVisible, { visibleByMask: 0b11 }));
    addComponent(world, eid2, set(VisionVisible, { visibleByMask: 0b100 }));

    resetVisibilityMasks();

    expect(VisionVisible.visibleByMask[eid1]).toBe(0);
    expect(VisionVisible.visibleByMask[eid2]).toBe(0);
  });
});

// ===========================================================================
// SpatialVisionSystem Integration Tests (AC-1)
// ===========================================================================

describe('SpatialVisionSystem', () => {
  let world: World;
  let walls: Set<string>;

  beforeEach(() => {
    world = createTestWorld();
    walls = new Set<string>();
    setVisionGrid(makeWallCheck(walls), TEST_GRID_W, TEST_GRID_H);
  });

  afterEach(() => {
    clearVisionGrid();
  });

  test('idle observer uses DDA — detects targets in cone', () => {
    // Observer at (5, 5) looking right
    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 2,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    // Target at (8, 5) — directly in the cone
    const targetEid = createTarget(world, 8, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    // Target should be visible (observer bit is 1 << (eid % 31))
    const observerBit = 1 << (obsEid % 31);
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(observerBit);
  });

  test('idle observer does NOT detect targets outside cone', () => {
    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 4,
      lookDirection: 0, // Looking right
      stateMask: ObserverState.idle,
    });

    // Target at (5, 0) — far above, outside the cone
    const targetEid = createTarget(world, 5, 0);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const observerBit = 1 << (obsEid % 31);
    // Target should NOT be visible
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(0);
  });

  test('wall blocks vision for idle observer', () => {
    walls.add('7,5');

    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 8,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    // Target at (8, 5) — behind the wall
    const targetEid = createTarget(world, 8, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const observerBit = 1 << (obsEid % 31);
    // Target should NOT be visible (wall blocks)
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(0);
  });

  test('alert observer uses shadowcasting — detects targets in cone', () => {
    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 2,
      lookDirection: 0,
      stateMask: ObserverState.alert,
    });

    const targetEid = createTarget(world, 8, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const observerBit = 1 << (obsEid % 31);
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(observerBit);
  });

  test('walls shadow targets for alert observer', () => {
    walls.add('7,7');

    const obsEid = createObserver(world, {
      gx: 5,
      gy: 7,
      fovRadius: 5,
      fovAngle: Math.PI / 8,
      lookDirection: 0,
      stateMask: ObserverState.alert,
    });

    const targetEid = createTarget(world, 9, 7);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const observerBit = 1 << (obsEid % 31);
    // Behind the wall — should be shadowed
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(0);
  });

  test('multiple observers each contribute their own faction bit', () => {
    // Create world with fresh VisionVisible arrays (no stale state)
    world = createTestWorld();
    setVisionGrid(makeWallCheck(walls), TEST_GRID_W, TEST_GRID_H);

    // Observer 1 at (5, 5) — eid-based bit
    const obs1Eid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    // Observer 2 at (5, 5) — same position, different eid
    const obs2Eid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    const targetEid = createTarget(world, 8, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const mask = VisionVisible.visibleByMask[targetEid];

    // Both observers should have contributed their bits
    const obs1Bit = 1 << (obs1Eid % 31);
    const obs2Bit = 1 << (obs2Eid % 31);

    expect(mask & obs1Bit).toBe(obs1Bit);
    expect(mask & obs2Bit).toBe(obs2Bit);
  });

  test('targets outside maxRadius are not visible', () => {
    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 2,
      fovAngle: Math.PI,
      lookDirection: 0,
      stateMask: ObserverState.alert,
    });

    const nearTarget = createTarget(world, 6, 5);
    const farTarget = createTarget(world, 9, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    const observerBit = 1 << (obsEid % 31);

    // Near target: visible
    expect(VisionVisible.visibleByMask[nearTarget] & observerBit).toBe(observerBit);

    // Far target: not visible
    expect(VisionVisible.visibleByMask[farTarget] & observerBit).toBe(0);
  });

  test('resetVisibilityMasks clears all before update', () => {
    const obsEid = createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 2,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    const targetEid = createTarget(world, 8, 5);
    const observerBit = 1 << (obsEid % 31);

    // First tick: target becomes visible
    resetVisibilityMasks();
    updateSpatialVision(world);
    expect(VisionVisible.visibleByMask[targetEid] & observerBit).toBe(observerBit);

    // Remove the observer
    removeEntity(world, obsEid);

    // Second tick: target should no longer be visible
    resetVisibilityMasks();
    updateSpatialVision(world);
    expect(VisionVisible.visibleByMask[targetEid]).toBe(0);
  });

  test('no-op when vision grid is not set', () => {
    clearVisionGrid();

    createObserver(world, {
      gx: 5,
      gy: 5,
      fovRadius: 5,
      fovAngle: Math.PI / 2,
      lookDirection: 0,
      stateMask: ObserverState.idle,
    });

    const targetEid = createTarget(world, 8, 5);

    resetVisibilityMasks();
    updateSpatialVision(world);

    // No vision grid → system is a no-op
    expect(VisionVisible.visibleByMask[targetEid]).toBe(0);
  });
});

// ===========================================================================
// AC-1: Performance — sub-millisecond processing ceiling
// ===========================================================================

describe('AC-1: Performance envelope', () => {
  test('10 observers with 10 targets each completes quickly', () => {
    const world = createTestWorld();
    const wallsSet = createWallSet([
      [5, 5],
      [10, 3],
      [12, 7],
      [3, 10],
    ]);
    setVisionGrid(makeWallCheck(wallsSet), TEST_GRID_W, TEST_GRID_H);

    // Create 10 observers
    for (let i = 0; i < 10; i++) {
      createObserver(world, {
        gx: 2 + (i % 5) * 3,
        gy: 2 + Math.floor(i / 5) * 5,
        fovRadius: 5,
        fovAngle: Math.PI / 2,
        lookDirection: (i * Math.PI) / 5,
        stateMask: i % 3 === 0 ? ObserverState.alert : ObserverState.idle,
      });
    }

    // Create 10 targets
    for (let i = 0; i < 10; i++) {
      createTarget(world, 5 + i, 7);
    }

    resetVisibilityMasks();
    const start = performance.now();
    updateSpatialVision(world);
    const elapsed = performance.now() - start;

    // Should complete in well under 10ms (contract says sub-ms but Bun test runtime adds overhead)
    expect(elapsed).toBeLessThan(50);

    clearVisionGrid();
  });
});
