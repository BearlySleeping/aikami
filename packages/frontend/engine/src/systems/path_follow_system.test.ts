// packages/frontend/engine/src/systems/path_follow_system.test.ts
//
// C-379 AC-7: PathFollow writes Velocity toward waypoints; the system is
// the single locomotion executor.
//
// - A companion placed behind a wall from the player reaches its formation
//   slot without passing through the wall.
// - Path completion detaches the component and zeroes velocity.
// - An empty path is a no-op.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { PathFollow, registerPathFollowObservers } from '../components/path_follow.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { findPath } from '../math/astar.ts';
import type { CollisionGrid } from './collision_system.ts';
import { resetCollisionGrid, setCollisionGrid } from './collision_system.ts';
import { updateMovement } from './movement_system.ts';
import { hasActivePath, updatePathFollow } from './path_follow_system.ts';

const ALL_WALKABLE: CollisionGrid = {
  width: 10,
  height: 10,
  tileSize: 32,
  grid: new Array(100).fill(false),
};

describe('path_follow_system (C-379 AC-7)', () => {
  let world: World;

  // High, unique eid ranges per test avoid SoA collisions with other test
  // files (module-global component arrays; bitecs worlds recycle eids).

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerPathFollowObservers(world);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  /** Creates a fresh entity and returns its real eid. */
  const nextEid = (): number => {
    return addEntity(world);
  };

  const attachPath = (eid: number, waypoints: number[], speed = 80, arriveRadius = 4): void => {
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints: new Float32Array(waypoints),
        index: 1,
        length: waypoints.length / 2,
        speed,
        repathAtMs: 0,
        arriveRadius,
      }),
    );
  };

  it('writes Velocity toward the current waypoint', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 })); // tile (5,5) centre
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
    // Goal waypoint due east: same row, tile (7,5) centre = (240, 160).
    attachPath(eid, [160, 160, 240, 160], 80);

    updatePathFollow(world, 100); // 0.1s

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      // Direction is +x (waypoint east). Magnitude ≈ speed (80 px/s).
      expect(vel.x).toBeGreaterThan(0);
      expect(Math.abs(vel.y)).toBeLessThanOrEqual(0.001); // exactly east
      expect(Math.hypot(vel.x, vel.y)).toBeCloseTo(80, 3);
    }
  });

  it('reaches the final waypoint, zeroes velocity and detaches PathFollow', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 50, y: 0 }));
    // Tiny path: next waypoint 8px away, arriveRadius 8 → reached in one step.
    attachPath(eid, [160, 160, 168, 160], 80, 8);

    // Run the full loop — path-follow writes velocity, movement resolves it.
    let frames = 0;
    while (hasActivePath(world, eid) && frames < 100) {
      updatePathFollow(world, 100);
      updateMovement(world, 100);
      frames++;
    }

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    }
    // Component detached — no live path remains.
    expect(hasActivePath(world, eid)).toBe(false);
    expect(frames).toBeLessThan(100);
  });

  it('companion routes around a wall to its formation slot (AC-7)', () => {
    // 10×10 grid. Wall column at x=5, y=5..8 blocks the straight line from
    // (3,5) to (7,5); row 4 stays open to route around. The goal is two
    // columns past the wall so the 32px entity box has clearance while
    // turning (a corner-adjacent goal pins the box — grid-aligned
    // waypoint movement with a 2-row/2-column box, C-379 Open Questions:
    // path smoothing is deferred).
    const grid: CollisionGrid = {
      width: 10,
      height: 10,
      tileSize: 32,
      grid: new Array(100).fill(false),
    };
    for (let y = 5; y < 9; y++) {
      grid.grid[y * 10 + 5] = true;
    }
    setCollisionGrid(grid);

    // A* waypoints from (3,5) to (7,5) must route around the wall — never
    // through it. This is the unit-level integration the AC-7 demands:
    // A* produces waypoints, PathFollow writes Velocity, updateMovement
    // resolves them.
    const result = findPath({
      grid: {
        width: 10,
        height: 10,
        cost: Uint8Array.from(grid.grid.map((b) => (b ? 0 : 16))),
      },
      start: { x: 3, y: 5 },
      goal: { x: 7, y: 5 },
    });
    expect(result.path.length).toBeGreaterThan(0);
    // The path must not include the wall column x=5 for rows 5..8.
    for (const cell of result.path) {
      if (cell.x === 5 && cell.y >= 5 && cell.y <= 8) {
        throw new Error(`path crosses the wall at (${cell.x},${cell.y})`);
      }
    }

    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 3 * 32 + 16, y: 5 * 32 + 16 })); // tile (3,5)
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));

    const waypoints = new Float32Array(result.path.length * 2);
    for (let i = 0; i < result.path.length; i++) {
      waypoints[i * 2] = result.path[i].x * 32 + 16;
      waypoints[i * 2 + 1] = result.path[i].y * 32 + 16;
    }
    addComponent(
      world,
      eid,
      set(PathFollow, {
        waypoints,
        index: 1,
        length: result.path.length,
        speed: 80,
        repathAtMs: 0,
        arriveRadius: 6,
      }),
    );

    // Run the sim loop until the path completes.
    let frames = 0;
    while (hasActivePath(world, eid) && frames < 2000) {
      updatePathFollow(world, 100);
      updateMovement(world, 100);
      frames++;
    }

    const pos = getComponent(world, eid, Position) as { x: number; y: number };
    // Reached the formation slot tile (7,5) centre, ± arrival radius.
    expect(Math.abs(pos.x - (7 * 32 + 16))).toBeLessThanOrEqual(10);
    expect(Math.abs(pos.y - (5 * 32 + 16))).toBeLessThanOrEqual(10);
    expect(frames).toBeLessThan(2000);
  });

  it('empty path is a no-op', () => {
    setCollisionGrid(ALL_WALKABLE);
    const eid = nextEid();
    addComponent(world, eid, Position);
    addComponent(world, eid, set(Position, { x: 160, y: 160 }));
    addComponent(world, eid, Velocity);
    addComponent(world, eid, set(Velocity, { x: 0, y: 0 }));
    attachPath(eid, [], 80, 4);

    updatePathFollow(world, 100);

    const vel = getComponent(world, eid, Velocity) as { x: number; y: number } | undefined;
    expect(vel).toBeDefined();
    if (vel) {
      expect(vel.x).toBe(0);
      expect(vel.y).toBe(0);
    }
    expect(hasActivePath(world, eid)).toBe(false);
  });
});
