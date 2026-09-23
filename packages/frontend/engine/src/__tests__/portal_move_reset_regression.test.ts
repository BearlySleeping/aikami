// packages/frontend/engine/src/__tests__/portal_move_reset_regression.test.ts
//
// C-138 / C-379 regression: a click-to-move player must not keep walking after
// crossing a map portal.
//
// A click-to-move player follows a PathFollow whose waypoints are expressed in
// the CURRENT map's coordinates. When the player steps into a transition zone
// the worker runs LOAD_MAP: it repositions the player at the destination spawn
// but, before the fix, left the stale PathFollow (and Velocity) attached. The
// resumed tick loop then steered the player across the new map toward the old
// map's waypoints — the "player keeps moving after the portal" bug.
//
// LOAD_MAP now calls clearActorMovement() after repositioning the player. This
// test drives the two real systems (updatePathFollow + updateMovement) over the
// exact discontinuity: teleport, clear, then tick, asserting the player stays
// parked.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getComponent, set } from 'bitecs';
import { PathFollow, registerPathFollowObservers } from '../components/path_follow.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import type { CollisionGrid } from '../systems/collision_system.ts';
import { resetCollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import { updateMovement } from '../systems/movement_system.ts';
import {
  clearActorMovement,
  hasActivePath,
  registerPathFollowHaltObservers,
  updatePathFollow,
} from '../systems/path_follow_system.ts';

const ALL_WALKABLE: CollisionGrid = {
  width: 20,
  height: 20,
  tileSize: 32,
  grid: new Array(400).fill(false),
};

describe('portal map-transition — click-to-move reset (C-138 regression)', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerPathFollowObservers(world);
    registerPathFollowHaltObservers(world);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  it('leaves the player parked on the new spawn when a stale click path is cleared', () => {
    setCollisionGrid(ALL_WALKABLE);

    const player = addEntity(world);
    addComponent(world, player, Position);
    addComponent(world, player, set(Position, { x: 160, y: 160 })); // tile (5,5) centre
    addComponent(world, player, Velocity);
    addComponent(world, player, set(Velocity, { x: 0, y: 0 }));

    // Click-to-move path from (5,5) to (9,5), mid-flight (index 1 of 2).
    addComponent(
      world,
      player,
      set(PathFollow, {
        waypoints: new Float32Array([160, 160, 288, 160]),
        index: 1,
        length: 2,
        speed: 80,
        repathAtMs: 0,
        arriveRadius: 4,
      }),
    );

    // Sanity: before the transition the player is genuinely walking.
    updatePathFollow(world, 100);
    updateMovement(world, 100);
    const beforeTransition = getComponent(world, player, Position) as { x: number; y: number };
    expect(beforeTransition.x).toBeGreaterThan(160);

    // ── Portal crossing (LOAD_MAP steps 2 + 2b) ──
    // Reposition the player at the destination spawn...
    addComponent(world, player, set(Position, { x: 64, y: 64 })); // tile (2,2) centre
    // ...then drop the departing map's locomotion state.
    clearActorMovement(world, player);

    // Without the reset the next tick would re-steer toward (288,160) — the
    // stale waypoint. With it the systems are inert for this entity.
    for (let frame = 0; frame < 10; frame++) {
      updatePathFollow(world, 100);
      updateMovement(world, 100);
    }

    const parked = getComponent(world, player, Position) as { x: number; y: number };
    expect(parked.x).toBe(64);
    expect(parked.y).toBe(64);
    expect(hasActivePath(world, player)).toBe(false);
    expect(getComponent(world, player, Velocity)).toBeUndefined();
  });

  it('demonstrates the stale-path hazard the reset removes', () => {
    setCollisionGrid(ALL_WALKABLE);

    const player = addEntity(world);
    addComponent(world, player, Position);
    addComponent(world, player, set(Position, { x: 160, y: 160 }));
    addComponent(world, player, Velocity);
    addComponent(world, player, set(Velocity, { x: 0, y: 0 }));
    addComponent(
      world,
      player,
      set(PathFollow, {
        waypoints: new Float32Array([160, 160, 288, 160]),
        index: 1,
        length: 2,
        speed: 80,
        repathAtMs: 0,
        arriveRadius: 4,
      }),
    );

    // Teleport WITHOUT clearing: the stale path keeps steering the player.
    addComponent(world, player, set(Position, { x: 64, y: 64 }));
    updatePathFollow(world, 100);
    updateMovement(world, 100);

    const drifted = getComponent(world, player, Position) as { x: number; y: number };
    expect(drifted.x).toBeGreaterThan(64);
  });
});
