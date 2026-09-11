// packages/frontend/engine/src/systems/actor_footprint.test.ts
//
// C-379 footprint regression: the movement system collides a 32×32 box
// anchored at the feet, so a standing actor spans the feet row AND the row
// above it. A* that only tests the feet tile routes actors into cells whose
// head row overlaps a wall — movement then refuses the step and the actor
// jams on the corner. The derived pathfinding grid must mark those cells
// impassable.

import { afterEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { PathFollow, registerPathFollowObservers } from '../components/path_follow.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { findPath } from '../math/astar.ts';
import { buildActorPathGrid, planActorPath } from './actor_footprint.ts';
import type { CollisionGrid } from './collision_system.ts';
import { getPathfindingGrid, resetCollisionGrid, setCollisionGrid } from './collision_system.ts';
import { updateMovement } from './movement_system.ts';
import {
  hasActivePath,
  registerPathFollowHaltObservers,
  updatePathFollow,
} from './path_follow_system.ts';
import { buildTerrainGridFromBoolean } from './terrain_grid.ts';

const makeGrid = (): CollisionGrid => ({
  width: 10,
  height: 10,
  tileSize: 32,
  grid: new Array(100).fill(false),
});

describe('buildActorPathGrid (C-379 footprint)', () => {
  afterEach(() => {
    resetCollisionGrid();
  });

  it('blocks the cell whose head row overlaps a wall', () => {
    const grid = makeGrid();
    grid.grid[5 * 10 + 5] = true; // wall at (5,5)
    const terrain = buildTerrainGridFromBoolean(grid);

    const pathGrid = buildActorPathGrid(terrain);

    // Feet at (5,6): the box covers rows 5 and 6, so (5,5) wall blocks it.
    expect(pathGrid[6 * 10 + 5]).toBe(0);
    // The wall cell itself stays blocked.
    expect(pathGrid[5 * 10 + 5]).toBe(0);
    // (4,6): box covers (4,5) and (4,6) — both open.
    expect(pathGrid[6 * 10 + 4]).not.toBe(0);
    // (5,4): box covers (5,3) and (5,4) — the wall at (5,5) is below the box.
    expect(pathGrid[4 * 10 + 5]).not.toBe(0);
  });

  it('routes around a head-blocked gap that the raw grid walks through', () => {
    const grid = makeGrid();
    // A 2-tall wall at (5,4)..(5,5). The raw shortest path from (4,5) to
    // (6,5) dips through (5,6); under the actor box, (5,6)'s head is in the
    // (5,5) wall, so it is not standable.
    grid.grid[4 * 10 + 5] = true;
    grid.grid[5 * 10 + 5] = true;
    setCollisionGrid(grid);

    const rawTerrain = buildTerrainGridFromBoolean(grid);
    const raw = findPath({
      grid: rawTerrain,
      start: { x: 4, y: 5 },
      goal: { x: 6, y: 5 },
    });
    expect(raw.path.length).toBeGreaterThan(0);
    expect(raw.path.some((c) => c.x === 5 && c.y === 6)).toBe(true);

    const pathGrid = getPathfindingGrid();
    expect(pathGrid).toBeDefined();
    if (!pathGrid) {
      return;
    }

    const corrected = findPath({
      grid: pathGrid,
      start: { x: 4, y: 5 },
      goal: { x: 6, y: 5 },
    });
    expect(corrected.path.length).toBeGreaterThan(0);
    // The head-blocked cell is never used, and every cell is standable.
    expect(corrected.path.some((c) => c.x === 5 && c.y === 6)).toBe(false);
    for (const cell of corrected.path) {
      expect(pathGrid.cost[cell.y * pathGrid.width + cell.x]).not.toBe(0);
    }
  });
});

describe('footprint pathing + movement integration', () => {
  let world: World;

  const FixedStepMs = 1000 / 60;

  const runToCompletion = (eid: number, maxFrames = 400): number => {
    let frames = 0;
    while (hasActivePath(world, eid) && frames < maxFrames) {
      updatePathFollow(world, FixedStepMs);
      updateMovement(world, FixedStepMs);
      frames++;
    }
    return frames;
  };

  it('walks an actor around a wall corner without jamming', () => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerPathFollowObservers(world);
    registerPathFollowHaltObservers(world);

    const grid = makeGrid();
    // 2-tall wall at (5,4)..(5,5). A feet-only A* routes through (5,6),
    // whose head row is inside the (5,5) wall — the actor jams there.
    grid.grid[4 * 10 + 5] = true;
    grid.grid[5 * 10 + 5] = true;
    setCollisionGrid(grid);

    const pathGrid = getPathfindingGrid();
    expect(pathGrid).toBeDefined();
    if (!pathGrid) {
      return;
    }

    const path = findPath({ grid: pathGrid, start: { x: 4, y: 5 }, goal: { x: 6, y: 5 } });
    expect(path.path.length).toBeGreaterThan(0);

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 4 * 32 + 16, y: 5 * 32 + 16 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));

    const waypoints = new Float32Array(path.path.length * 2);
    for (let i = 0; i < path.path.length; i++) {
      waypoints[i * 2] = path.path[i].x * 32 + 16;
      waypoints[i * 2 + 1] = path.path[i].y * 32 + 16;
    }
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints,
        index: 1,
        length: path.path.length,
        speed: 150,
        repathAtMs: 0,
        arriveRadius: 0,
      }),
    );

    const frames = runToCompletion(eid);
    expect(hasActivePath(world, eid)).toBe(false);
    expect(frames).toBeLessThan(400);

    const pos = getComponent(world, eid, Position) as { x: number; y: number };
    expect(Math.floor(pos.x / 32)).toBe(6);
    expect(Math.floor(pos.y / 32)).toBe(5);
  });

  it('plans from the nearest standable cell when the start centre is blocked', () => {
    const grid = makeGrid();
    // Solid row 1 (the inn's top wall). Feet cell (4,2) is walkable floor but
    // its centre overlaps row 1, so the footprint grid blocks it — the player
    // can still stand there at the bottom after walking up against the wall.
    for (let x = 0; x < 10; x++) {
      grid.grid[1 * 10 + x] = true;
    }
    setCollisionGrid(grid);
    const pathGrid = getPathfindingGrid();
    if (!pathGrid) {
      throw new Error('path grid missing');
    }
    expect(pathGrid.cost[2 * 10 + 4]).toBe(0); // centre blocked

    const plan = planActorPath({
      terrain: pathGrid,
      fromCell: { x: 4, y: 2 },
      goal: { x: 4, y: 5 },
    });
    expect(plan).toBeDefined();
    if (!plan) {
      return;
    }
    // The blocked start cannot be skipped — index 0 targets the nearest
    // standable cell instead.
    expect(plan.index).toBe(0);
    const firstX = Math.floor(plan.waypoints[0] / 32);
    const firstY = Math.floor(plan.waypoints[1] / 32);
    expect(pathGrid.cost[firstY * pathGrid.width + firstX]).not.toBe(0);
  });

  it('clamps a blocked goal to the nearest standable cell', () => {
    const grid = makeGrid();
    grid.grid[5 * 10 + 5] = true; // wall at (5,5)
    setCollisionGrid(grid);
    const pathGrid = getPathfindingGrid();
    if (!pathGrid) {
      throw new Error('path grid missing');
    }

    const plan = planActorPath({
      terrain: pathGrid,
      fromCell: { x: 4, y: 5 },
      goal: { x: 5, y: 5 }, // clicked the wall
    });
    expect(plan).toBeDefined();
    if (!plan) {
      return;
    }

    const lastX = Math.floor(plan.waypoints[(plan.length - 1) * 2] / 32);
    const lastY = Math.floor(plan.waypoints[(plan.length - 1) * 2 + 1] / 32);
    // Never the wall cell itself, but an adjacent standable cell.
    expect(lastX === 5 && lastY === 5).toBe(false);
    expect(Math.abs(lastX - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(lastY - 5)).toBeLessThanOrEqual(1);
    expect(pathGrid.cost[lastY * pathGrid.width + lastX]).not.toBe(0);
  });

  it('walks the actor out of a start cell whose centre is blocked', () => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerPathFollowObservers(world);
    registerPathFollowHaltObservers(world);

    const grid = makeGrid();
    for (let x = 0; x < 10; x++) {
      grid.grid[1 * 10 + x] = true; // top wall
    }
    setCollisionGrid(grid);
    const pathGrid = getPathfindingGrid();
    if (!pathGrid) {
      return;
    }

    const plan = planActorPath({
      terrain: pathGrid,
      fromCell: { x: 4, y: 2 },
      goal: { x: 4, y: 5 },
    });
    expect(plan).toBeDefined();
    if (!plan) {
      return;
    }

    const eid = addEntity(world);
    addComponent(world, eid, Position);
    // Bottom of blocked cell (4,2): y=95 keeps the 32px box inside row 2.
    addComponent(world, eid, set(Position, { x: 4 * 32 + 16, y: 95 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints: plan.waypoints,
        index: plan.index,
        length: plan.length,
        speed: 150,
        repathAtMs: 0,
        arriveRadius: 0,
      }),
    );

    const frames = runToCompletion(eid);
    expect(hasActivePath(world, eid)).toBe(false);
    expect(frames).toBeLessThan(400);

    const pos = getComponent(world, eid, Position) as { x: number; y: number };
    expect(Math.floor(pos.x / 32)).toBe(4);
    expect(Math.floor(pos.y / 32)).toBe(5);
  });

  afterEach(() => {
    resetCollisionGrid();
  });
});
