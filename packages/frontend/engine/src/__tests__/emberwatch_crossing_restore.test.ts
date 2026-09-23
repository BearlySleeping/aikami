// packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts
//
// C-549 — restoring a saved position onto a cell that the village crossing
// change made water.
//
// The crossing moved from cols 39–41 × rows 7–8 to cols 36–37 × rows 7–8 and the
// E–W reach widened to two rows. A save taken before that change can restore a
// player (or a companion) onto a cell that is now river. `clampSpawnToWalkable`
// is the worker's relocation policy for exactly that case, and it runs on both
// LOAD_MAP and RESTORE_PLAYER.
//
// This test drives the REAL committed village map's collision layer through the
// same oracle the worker uses, so it cannot drift from the geometry: the cells
// asserted as "newly water" are read out of the map, not hard-coded twice.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import manifest from '../../../../../content/packs/emberwatch/manifest.json';
import map from '../../../../../content/packs/emberwatch/maps/village.json';
import type { CollisionGrid } from '../systems/collision_system.ts';
import { resetCollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import { clampSpawnToWalkable, isPlayerSpawnBlocked } from '../systems/movement_system.ts';

/** True when one GID makes its cell solid, given the manifest's tile table. */
const gidBlocks = (
  gid: number,
  isCollisionLayer: boolean,
  tiles: Record<string, { isWalkable?: boolean }>,
): boolean => {
  if (gid === 0) {
    return false;
  }
  if (isCollisionLayer) {
    return true;
  }
  const def = tiles[String(gid)];
  return def === undefined || def.isWalkable === false;
};

/** The real village collision grid, exactly as the engine builds it. */
const villageCollisionGrid = (): CollisionGrid => {
  const total = map.width * map.height;
  const grid = new Array<boolean>(total).fill(false);
  for (const layer of map.layers) {
    const data = layer.type === 'tilelayer' && Array.isArray(layer.data) ? layer.data : undefined;
    if (!data) {
      continue;
    }
    const isCollision = layer.name === 'collision';
    for (let i = 0; i < total; i++) {
      if (gidBlocks(data[i] ?? 0, isCollision, manifest.tiles)) {
        grid[i] = true;
      }
    }
  }
  return { width: map.width, height: map.height, tileSize: 32, grid };
};

describe('C-549 — restoring onto a cell the crossing change made water', () => {
  let village: CollisionGrid;

  beforeEach(() => {
    village = villageCollisionGrid();
    setCollisionGrid(village);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  it('the new crossing span is walkable and its two long sides are water', () => {
    const at = (c: number, r: number): boolean => village.grid[r * village.width + c] === true;
    // The span itself (36–37 × 7–8) must be walkable.
    for (const [c, r] of [
      [36, 7],
      [37, 7],
      [36, 8],
      [37, 8],
    ] as const) {
      expect(at(c, r), `span (${c},${r}) is walkable`).toBe(false);
    }
    // The long sides are river: a save that lands here must be relocated.
    for (const [c, r] of [
      [35, 7],
      [38, 7],
      [35, 8],
      [38, 8],
    ] as const) {
      expect(at(c, r), `water (${c},${r}) is blocked`).toBe(true);
    }
  });

  it('relocates a player restored onto a newly-water cell to the nearest walkable cell', () => {
    // A pre-C-549 save could stand at (38,8): walkable when the crossing was
    // at 39–41, river now that the span moved west. Feet centre of cell (38,8).
    const savedX = 38 * 32 + 16;
    const savedY = 8 * 32 + 16;
    expect(isPlayerSpawnBlocked(savedX, savedY), 'the saved cell is now water').toBe(true);

    const clamped = clampSpawnToWalkable(savedX, savedY, isPlayerSpawnBlocked, {
      width: village.width * 32,
      height: village.height * 32,
    });

    // It moved...
    expect(clamped.x === savedX && clamped.y === savedY, 'the clamp relocated the position').toBe(
      false,
    );
    // ...onto a cell the player can actually stand in.
    expect(
      isPlayerSpawnBlocked(clamped.x, clamped.y),
      `clamped to (${clamped.x},${clamped.y}) which is walkable`,
    ).toBe(false);
    // ...and it is the NEAREST walkable cell, not the far side of the map:
    // the ring scan is unit-by-unit, so the result is at most one ring out.
    const ringDistance = Math.max(Math.abs(clamped.x - savedX), Math.abs(clamped.y - savedY));
    expect(ringDistance).toBeLessThanOrEqual(32);
  });

  it('relocates a player restored onto the old crossing span (now river) as well', () => {
    // (40,7) was the middle of the old span — walkable before, river now.
    const savedX = 40 * 32 + 16;
    const savedY = 7 * 32 + 16;
    expect(isPlayerSpawnBlocked(savedX, savedY), 'the old span is now water').toBe(true);

    const clamped = clampSpawnToWalkable(savedX, savedY, isPlayerSpawnBlocked, {
      width: village.width * 32,
      height: village.height * 32,
    });
    expect(isPlayerSpawnBlocked(clamped.x, clamped.y)).toBe(false);
  });

  it('leaves a player restored onto still-walkable ground untouched', () => {
    // The village square is unaffected by the crossing change; the clamp is a
    // no-op there, so ordinary restores do not teleport.
    const x = 32 * 32 + 16;
    const y = 22 * 32 + 16;
    expect(isPlayerSpawnBlocked(x, y), 'the square is walkable').toBe(false);
    expect(
      clampSpawnToWalkable(x, y, isPlayerSpawnBlocked, {
        width: village.width * 32,
        height: village.height * 32,
      }),
    ).toEqual({ x, y });
  });
});

describe('C-549 — companion restore path (reported, not changed)', () => {
  it.todo('relocates a companion restored onto newly-water terrain', () => {});
});
