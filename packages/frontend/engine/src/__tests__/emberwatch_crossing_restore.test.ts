// packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts
//
// C-549 — restoring a saved position onto a cell that the village crossing
// change made water.
//
// The crossing moved from cols 39–41 × rows 7–8 to cols 36–38 × rows 7–8 and the
// E–W reach widened to two rows. A save taken before that change can restore a
// player (or a companion) onto a cell that is now river. `clampSpawnToWalkable`
// is the worker's relocation policy for exactly that case, and it runs on both
// LOAD_MAP and RESTORE_PLAYER.
//
// This test drives the REAL committed village map's collision layer through the
// same oracle the worker uses, so it cannot drift from the geometry: the cells
// asserted as "newly water" are read out of the map, not hard-coded twice.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { addComponent, addEntity, createWorld, hasComponent, set, type World } from 'bitecs';
import manifest from '../../../../../content/packs/emberwatch/manifest.json';
import map from '../../../../../content/packs/emberwatch/maps/village.json';
import { registerAppearanceObservers } from '../components/appearance.ts';
import { registerCollisionDataObservers } from '../components/collision_data.ts';
import { Companion, registerCompanionObservers } from '../components/companion.ts';
import { registerGridPositionObservers } from '../components/grid_position.ts';
import { registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { PathFollow, registerPathFollowObservers } from '../components/path_follow.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerSpatialLinkObservers } from '../components/spatial_link.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { registerVisualObservers } from '../components/visual.ts';
import { createNPC } from '../entities/create_npc.ts';
import type { CollisionGrid } from '../systems/collision_system.ts';
import {
  insertIntoSpatialGrid,
  resetCollisionGrid,
  setCollisionGrid,
} from '../systems/collision_system.ts';
import { clampSpawnToWalkable, isPlayerSpawnBlocked } from '../systems/movement_system.ts';
import { relocateRestoredEntities } from '../worker/companion_restore.ts';

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
    // The span itself (36–38 × 7–8) must be walkable.
    for (const [c, r] of [
      [36, 7],
      [37, 7],
      [38, 7],
      [36, 8],
      [37, 8],
      [38, 8],
    ] as const) {
      expect(at(c, r), `span (${c},${r}) is walkable`).toBe(false);
    }
    // The long sides are river: a save that lands here must be relocated.
    for (const [c, r] of [
      [35, 7],
      [39, 7],
      [35, 8],
      [39, 8],
    ] as const) {
      expect(at(c, r), `water (${c},${r}) is blocked`).toBe(true);
    }
  });

  it('relocates a player restored onto a newly-water cell to the nearest walkable cell', () => {
    // A pre-C-549 save could stand at (39,8): walkable when the crossing was
    // at 39–41, river now that the span moved west. Feet centre of cell (39,8).
    const savedX = 39 * 32 + 16;
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

describe('C-556 — companion restore clamp', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerVisualObservers(world);
    registerNPCDialogObservers(world);
    registerAppearanceObservers(world);
    registerCollisionDataObservers(world);
    registerGridPositionObservers(world);
    registerSpatialLinkObservers(world);
    registerCompanionObservers(world);
    registerPathFollowObservers(world);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  it('relocates a companion restored onto newly-water terrain next to the player', () => {
    setCollisionGrid(villageCollisionGrid());
    const playerX = 38 * 32 + 16;
    const playerY = 7 * 32 + 16;
    const playerEntityId = addEntity(world);
    addComponent(world, playerEntityId, set(Position, { x: playerX, y: playerY }));
    const savedCompanion = { x: 39 * 32 + 16, y: 8 * 32 + 16 };
    const companionEntityId = createNPC(world, {
      npcId: 'village_guard',
      npcName: 'Village Guard',
      x: savedCompanion.x,
      y: savedCompanion.y,
      textureKey: 'npc',
      dialog: '',
      interactionRadius: 32,
      isCompanion: true,
    });
    insertIntoSpatialGrid(companionEntityId);
    Companion.recruited[companionEntityId] = true;
    addComponent(
      world,
      companionEntityId,
      set(PathFollow, {
        waypoints: new Float32Array([playerX, playerY]),
        index: 0,
        length: 1,
        speed: 80,
        repathAtMs: Date.now() + 10_000,
        arriveRadius: 8,
      }),
    );
    addComponent(world, companionEntityId, set(Velocity, { x: 20, y: 0 }));
    expect(isPlayerSpawnBlocked(savedCompanion.x, savedCompanion.y)).toBe(true);

    const relocations = relocateRestoredEntities({
      world,
      playerEntityId,
      source: 'RESTORE_PLAYER',
    });
    const restoredX = Position.x[companionEntityId] ?? 0;
    const restoredY = Position.y[companionEntityId] ?? 0;

    expect(relocations.some((entry) => entry.entityId === companionEntityId)).toBe(true);
    expect({ x: restoredX, y: restoredY }).not.toEqual(savedCompanion);
    expect(isPlayerSpawnBlocked(restoredX, restoredY)).toBe(false);
    const playerCell = { x: Math.floor(playerX / 32), y: Math.floor(playerY / 32) };
    const restoredCell = {
      x: Math.floor(restoredX / 32),
      y: Math.floor(restoredY / 32),
    };
    expect(
      Math.max(Math.abs(restoredCell.x - playerCell.x), Math.abs(restoredCell.y - playerCell.y)),
    ).toBe(1);
    expect(hasComponent(world, companionEntityId, PathFollow)).toBe(false);
    expect(hasComponent(world, companionEntityId, Velocity)).toBe(false);
    expect(PathFollow.repathAtMs[companionEntityId]).toBe(0);
  });

  it('keeps an unrecruited companion near its saved cell while relocating a recruited companion beside the player', () => {
    const grid = new Array<boolean>(64).fill(false);
    grid[1 * 8 + 1] = true;
    grid[6 * 8 + 6] = true;
    setCollisionGrid({ width: 8, height: 8, tileSize: 32, grid });
    const playerEntityId = addEntity(world);
    addComponent(world, playerEntityId, set(Position, { x: 4 * 32 + 16, y: 4 * 32 + 16 }));
    const createCompanion = (npcId: string, x: number, y: number): number => {
      const entityId = createNPC(world, {
        npcId,
        npcName: npcId,
        x,
        y,
        textureKey: 'npc',
        dialog: '',
        interactionRadius: 32,
        isCompanion: true,
      });
      insertIntoSpatialGrid(entityId);
      return entityId;
    };
    const recruitedEntityId = createCompanion('recruited-companion', 1 * 32 + 16, 1 * 32 + 16);
    const unrecruitedEntityId = createCompanion('unrecruited-companion', 6 * 32 + 16, 6 * 32 + 16);
    Companion.recruited[recruitedEntityId] = true;

    relocateRestoredEntities({ world, playerEntityId, source: 'LOAD_GAME' });

    const restoredCell = (entityId: number): { x: number; y: number } => ({
      x: Math.floor((Position.x[entityId] ?? 0) / 32),
      y: Math.floor((Position.y[entityId] ?? 0) / 32),
    });
    const recruitedCell = restoredCell(recruitedEntityId);
    const unrecruitedCell = restoredCell(unrecruitedEntityId);
    expect(Math.max(Math.abs(recruitedCell.x - 4), Math.abs(recruitedCell.y - 4))).toBe(1);
    expect(
      Math.max(Math.abs(unrecruitedCell.x - 6), Math.abs(unrecruitedCell.y - 6)),
    ).toBeLessThanOrEqual(1);
    expect(unrecruitedCell).not.toEqual({ x: 6, y: 6 });
  });

  it('uses the companion mask before falling back to the saved-cell ring search', () => {
    const grid = new Array<boolean>(64).fill(false);
    grid[1 * 8 + 1] = true;
    setCollisionGrid({ width: 8, height: 8, tileSize: 32, grid });
    const playerEntityId = addEntity(world);
    addComponent(world, playerEntityId, set(Position, { x: 4 * 32 + 16, y: 4 * 32 + 16 }));
    const companionEntityId = createNPC(world, {
      npcId: 'moving-companion',
      npcName: 'Moving Companion',
      x: 1 * 32 + 16,
      y: 1 * 32 + 16,
      textureKey: 'npc',
      dialog: '',
      interactionRadius: 32,
      isCompanion: true,
    });
    insertIntoSpatialGrid(companionEntityId);

    for (const [x, y] of [
      [3, 3],
      [4, 3],
      [5, 3],
      [3, 4],
      [5, 4],
      [3, 5],
      [4, 5],
      [5, 5],
    ] as const) {
      const blockerEntityId = createNPC(world, {
        npcId: `blocking-companion-${x}-${y}`,
        npcName: 'Blocking Companion',
        x: x * 32 + 16,
        y: y * 32 + 16,
        textureKey: 'npc',
        dialog: '',
        interactionRadius: 32,
        isCompanion: true,
      });
      insertIntoSpatialGrid(blockerEntityId);
    }

    relocateRestoredEntities({ world, playerEntityId, source: 'LOAD_GAME' });

    const restoredCell = {
      x: Math.floor((Position.x[companionEntityId] ?? 0) / 32),
      y: Math.floor((Position.y[companionEntityId] ?? 0) / 32),
    };
    const distanceFromPlayer = Math.max(Math.abs(restoredCell.x - 4), Math.abs(restoredCell.y - 4));
    expect(distanceFromPlayer).toBeGreaterThan(1);
    expect(
      isPlayerSpawnBlocked(Position.x[companionEntityId] ?? 0, Position.y[companionEntityId] ?? 0),
    ).toBe(false);
  });
});
