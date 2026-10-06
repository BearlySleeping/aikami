// packages/frontend/engine/src/game_world/screen_projection.test.ts

import { describe, expect, test } from 'bun:test';
import type { TerrainGrid } from '../systems/terrain_grid.ts';
import { resolveScreenToCell } from './screen_projection.ts';

/** A grid whose cells are standable unless listed in `blocked`. */
const makeGrid = (width: number, height: number, blocked: number[] = []): TerrainGrid => {
  const cost = new Uint8Array(width * height);
  for (let i = 0; i < cost.length; i++) {
    cost[i] = 16;
  }
  for (const index of blocked) {
    cost[index] = 0;
  }
  return { width, height, tileSize: 32, cost, blocksSight: new Uint8Array(width * height) };
};

describe('resolveScreenToCell', () => {
  test('divides world pixels by the active tile size', () => {
    expect(resolveScreenToCell({ world: { x: 70, y: 40 }, tileSize: 32 })).toEqual({
      cellX: 2,
      cellY: 1,
    });
  });

  test('falls back to a 32px tile before any scene declares one', () => {
    expect(resolveScreenToCell({ world: { x: 96, y: 0 } })).toEqual({ cellX: 3, cellY: 0 });
  });

  test.each([0, -32, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back to 32px for invalid tile size %s',
    (tileSize) => {
      expect(resolveScreenToCell({ world: { x: 96, y: 64 }, tileSize })).toEqual({
        cellX: 3,
        cellY: 2,
      });
    },
  );

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'uses zero for a non-finite world coordinate %s',
    (coordinate) => {
      expect(resolveScreenToCell({ world: { x: coordinate, y: 64 } })).toEqual({
        cellX: 0,
        cellY: 2,
      });
      expect(
        resolveScreenToCell({ world: { x: 900, y: coordinate }, terrain: makeGrid(4, 4) }),
      ).toEqual({ cellX: 3, cellY: 0 });
    },
  );

  test('clamps a click in the void to the map bounds', () => {
    const terrain = makeGrid(4, 4);
    expect(resolveScreenToCell({ world: { x: -500, y: 900 }, tileSize: 32, terrain })).toEqual({
      cellX: 0,
      cellY: 3,
    });
  });

  test('snaps a wall cell onto the nearest standable cell', () => {
    const grid = makeGrid(5, 1, [2]);
    // Cell 2 is solid, so the click resolves to its standable neighbour.
    expect(resolveScreenToCell({ world: { x: 80, y: 0 }, tileSize: 32, pathGrid: grid })).toEqual({
      cellX: 1,
      cellY: 0,
    });
  });

  test('leaves an already-standable cell alone', () => {
    const grid = makeGrid(5, 1);
    expect(resolveScreenToCell({ world: { x: 80, y: 0 }, tileSize: 32, pathGrid: grid })).toEqual({
      cellX: 2,
      cellY: 0,
    });
  });

  test('clamps before snapping, so a void click still lands on the map', () => {
    const grid = makeGrid(3, 1, [1]);
    expect(
      resolveScreenToCell({
        world: { x: 9999, y: 0 },
        tileSize: 32,
        terrain: grid,
        pathGrid: grid,
      }),
    ).toEqual({ cellX: 2, cellY: 0 });
  });
});
