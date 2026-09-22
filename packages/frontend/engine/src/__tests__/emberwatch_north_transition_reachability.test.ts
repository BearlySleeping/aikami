// packages/frontend/engine/src/__tests__/emberwatch_north_transition_reachability.test.ts
//
// Integration regression for the Emberwatch north-edge transition bug.
//
// The walkthrough that found the 5.0.0 blocker walked the real player north
// with keyboard input and got 0/18 triggers on village→old_road and
// old_road→ruined_shrine. The transition-matrix tests passed because they only
// asserted targets and landing points; they never stepped the movement clamp
// against a live ZoningSystem.
//
// This test does exactly that, cheaply: a synthetic all-walkable grid, the real
// `updateMovement` foot clamp, and the real `updateZoningSystem`. A one-row
// top-edge rect (y 0..32) must never fire; the two-row rect (y 0..64) that
// ships on PR #380 must fire once. It pins the movement↔zoning contract, not
// the rectangle metadata.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerTransitionObservers, Transition } from '../components/transition.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { ENTITY_HEIGHT_ABOVE } from '../systems/actor_footprint.ts';
import { setMapBounds } from '../systems/camera_system.ts';
import { resetCollisionGrid, setCollisionGrid } from '../systems/collision_system.ts';
import { updateMovement } from '../systems/movement_system.ts';
import { updateZoningSystem } from '../systems/zoning_system.ts';

const MAP_WIDTH = 320;
const MAP_HEIGHT = 640;

/** A 10×20 all-walkable grid — the top edge is bounded by the map clamp. */
const ALL_WALKABLE = {
  width: 10,
  height: 20,
  tileSize: 32,
  grid: new Array(200).fill(false),
};

const resetComponents = (): void => {
  Position.x.length = 0;
  Position.y.length = 0;
  Transition.targetMap.length = 0;
  Transition.targetX.length = 0;
  Transition.targetY.length = 0;
  Transition.width.length = 0;
  Transition.height.length = 0;
  Transition.triggered.length = 0;
};

/**
 * Creates a player at the given feet position facing north.
 */
const createPlayer = (world: World, x: number, y: number): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x, y }));
  addComponent(world, eid, Velocity);
  addComponent(world, eid, set(Velocity, { x: 0, y: -100 }));
  return eid;
};

/**
 * Creates a transition zone whose authored rect is `[x, y, width, height]` in
 * world pixels — the same shape `placeTransition` writes to the map JSON.
 */
const createZone = (world: World, options: { y: number; height: number }): void => {
  const eid = addEntity(world);
  const width = 96;
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: 48 + width / 2, y: options.y + options.height / 2 }));
  addComponent(world, eid, Transition);
  addComponent(
    world,
    eid,
    set(Transition, {
      targetMap: 'old_road',
      targetX: 0,
      targetY: 0,
      targetSpawnHash: 0,
      width,
      height: options.height,
      triggered: false,
    }),
  );
};

/**
 * Walks the player north for `ticks` frames and returns the visited feet Y and
 * whether the zone fired.
 */
const walkNorth = (
  world: World,
  playerId: number,
  bridge: MockEngineBridge,
  ticks = 40,
): {
  minY: number;
  fired: boolean;
} => {
  let minY = Number.POSITIVE_INFINITY;
  let fired = false;
  bridge.on('ZONE_TRIGGERED', () => {
    fired = true;
  });
  for (let i = 0; i < ticks; i++) {
    updateMovement(world, 100); // 100ms at 100px/s → 10px per tick
    updateZoningSystem(world, playerId, bridge);
    const pos = Position;
    minY = Math.min(minY, pos.y[playerId] ?? Number.POSITIVE_INFINITY);
  }
  return { minY, fired };
};

describe('Emberwatch north transition reachability — movement × zoning', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createWorld();
    registerPositionObservers(world);
    registerVelocityObservers(world);
    registerTransitionObservers(world);
    setCollisionGrid(ALL_WALKABLE);
    setMapBounds({ width: MAP_WIDTH, height: MAP_HEIGHT });
    bridge = new MockEngineBridge();
  });

  afterEach(() => {
    resetComponents();
    resetCollisionGrid();
    bridge.reset();
  });

  it('a one-row top-edge rect (y 0..32) never fires — the reported bug', () => {
    const playerId = createPlayer(world, 48 + 48, 200);
    createZone(world, { y: 0, height: 32 });
    const { minY, fired } = walkNorth(world, playerId, bridge);
    // The feet are clamped above the rect's inclusive bottom edge.
    expect(minY).toBeGreaterThan(ENTITY_HEIGHT_ABOVE);
    expect(fired).toBe(false);
  });

  it('a two-row top-edge rect (y 0..64) fires exactly once', () => {
    const playerId = createPlayer(world, 48 + 48, 200);
    createZone(world, { y: 0, height: 64 });
    const steps: number[] = [];
    let fires = 0;
    bridge.on('ZONE_TRIGGERED', () => {
      fires += 1;
    });
    for (let i = 0; i < 40; i++) {
      updateMovement(world, 100);
      steps.push(Position.y[playerId] ?? 0);
      updateZoningSystem(world, playerId, bridge);
    }
    const minY = Math.min(...steps);
    expect(minY).toBeGreaterThan(ENTITY_HEIGHT_ABOVE);
    expect(minY).toBeLessThanOrEqual(64);
    // One-shot lock: the zone never re-fires while the player remains inside.
    expect(fires).toBe(1);
  });
});
