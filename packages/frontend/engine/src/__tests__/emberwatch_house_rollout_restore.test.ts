// packages/frontend/engine/src/__tests__/emberwatch_house_rollout_restore.test.ts
//
// C-553 — real-map restore coverage for village cells whose open legacy door
// becomes a solid facade/door cell under the shared raised-house assembly.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import manifest from '../../../../../content/packs/emberwatch/manifest.json';
import map from '../../../../../content/packs/emberwatch/maps/village.json';
import type { CollisionGrid } from '../systems/collision_system.ts';
import { resetCollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import { clampSpawnToWalkable, isPlayerSpawnBlocked } from '../systems/movement_system.ts';

const NEWLY_BLOCKED_CELLS = [
  { building: 'inn', c: 50, r: 19 },
  { building: 'inn', c: 51, r: 19 },
  { building: 'shop', c: 50, r: 32 },
  { building: 'shop', c: 51, r: 32 },
  { building: 'north-west cottage', c: 8, r: 20 },
  { building: 'north-west cottage', c: 9, r: 20 },
  { building: 'north cottage', c: 20, r: 18 },
  { building: 'north cottage', c: 21, r: 18 },
] as const;

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
  const definition = tiles[String(gid)];
  return definition === undefined || definition.isWalkable === false;
};

const villageCollisionGrid = (): CollisionGrid => {
  const total = map.width * map.height;
  const grid = new Array<boolean>(total).fill(false);
  for (const layer of map.layers) {
    const data = layer.type === 'tilelayer' && Array.isArray(layer.data) ? layer.data : undefined;
    if (!data) {
      continue;
    }
    const isCollision = layer.name === 'collision';
    for (let index = 0; index < total; index++) {
      if (gidBlocks(data[index] ?? 0, isCollision, manifest.tiles)) {
        grid[index] = true;
      }
    }
  }
  return { width: map.width, height: map.height, tileSize: 32, grid };
};

type Cell = { c: number; r: number };

const isStandable = (village: CollisionGrid, cell: Cell): boolean => {
  if (cell.c < 0 || cell.c >= village.width || cell.r < 1 || cell.r >= village.height) {
    return false;
  }
  const index = cell.r * village.width + cell.c;
  return !village.grid[index] && !village.grid[index - village.width];
};

const actorReachable = (village: CollisionGrid, start: Cell, goal: Cell): boolean => {
  if (!isStandable(village, start) || !isStandable(village, goal)) {
    return false;
  }
  const indexOf = (cell: Cell): number => cell.r * village.width + cell.c;
  const queue = [start];
  const seen = new Set([indexOf(start)]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (!current) {
      continue;
    }
    if (current.c === goal.c && current.r === goal.r) {
      return true;
    }
    for (const [dc, dr] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const next = { c: current.c + dc, r: current.r + dr };
      const index = indexOf(next);
      if (seen.has(index) || !isStandable(village, next)) {
        continue;
      }
      seen.add(index);
      queue.push(next);
    }
  }
  return false;
};

describe('C-553 — village house navigation after rollout', () => {
  let village: CollisionGrid;

  beforeEach(() => {
    village = villageCollisionGrid();
    setCollisionGrid(village);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  it('reaches both interior triggers and inn walk-behind from every arrival', () => {
    const arrivals: readonly Cell[] = [
      { c: 3, r: 24 },
      { c: 51, r: 23 },
      { c: 32, r: 44 },
      { c: 32, r: 3 },
      { c: 51, r: 36 },
    ];
    for (const arrival of arrivals) {
      expect(actorReachable(village, arrival, { c: 51, r: 21 })).toBe(true);
      expect(actorReachable(village, arrival, { c: 51, r: 34 })).toBe(true);
      expect(actorReachable(village, arrival, { c: 51, r: 16 })).toBe(true);
    }
  });

  it('keeps named return arrivals outside inclusive door-trigger bounds', () => {
    const objects = map.layers.flatMap((layer) =>
      'objects' in layer && Array.isArray(layer.objects) ? layer.objects : [],
    );
    for (const [targetMap, spawnId] of [
      ['inn', 'from_inn'],
      ['merchant_shop', 'from_merchant'],
    ] as const) {
      const transition = objects.find(
        (object) =>
          object.type === 'transition' &&
          object.properties.some(
            (property) => property.name === 'targetMap' && property.value === targetMap,
          ),
      );
      const arrival = objects.find(
        (object) =>
          object.type === 'spawn' &&
          object.properties.some(
            (property) => property.name === 'spawnId' && property.value === spawnId,
          ),
      );
      if (!transition || !arrival) {
        throw new Error(`Missing ${targetMap} door transition or ${spawnId} arrival`);
      }
      expect(
        arrival.x < transition.x ||
          arrival.x > transition.x + transition.width ||
          arrival.y < transition.y ||
          arrival.y > transition.y + transition.height,
        `${spawnId} outside ${targetMap} inclusive trigger bounds`,
      ).toBe(true);
    }
  });
});

describe('C-553 — restoring onto a village cell newly blocked by house rollout', () => {
  let village: CollisionGrid;

  beforeEach(() => {
    village = villageCollisionGrid();
    setCollisionGrid(village);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  for (const cell of NEWLY_BLOCKED_CELLS) {
    it(`relocates a pre-C-553 save from ${cell.building} cell (${cell.c},${cell.r})`, () => {
      const saved = { x: cell.c * 32 + 16, y: cell.r * 32 + 16 };
      expect(isPlayerSpawnBlocked(saved.x, saved.y)).toBe(true);

      const clamped = clampSpawnToWalkable(saved.x, saved.y, isPlayerSpawnBlocked, {
        width: village.width * 32,
        height: village.height * 32,
      });
      expect(clamped).not.toEqual(saved);
      expect(isPlayerSpawnBlocked(clamped.x, clamped.y)).toBe(false);
      expect(
        Math.max(Math.abs(clamped.x - saved.x), Math.abs(clamped.y - saved.y)),
      ).toBeLessThanOrEqual(64);
    });
  }

  it('leaves an unaffected village-square save untouched', () => {
    const saved = { x: 32 * 32 + 16, y: 22 * 32 + 16 };
    expect(isPlayerSpawnBlocked(saved.x, saved.y)).toBe(false);
    expect(
      clampSpawnToWalkable(saved.x, saved.y, isPlayerSpawnBlocked, {
        width: village.width * 32,
        height: village.height * 32,
      }),
    ).toEqual(saved);
  });
});
