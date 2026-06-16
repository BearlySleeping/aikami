// packages/frontend/engine/src/systems/zoning_system.test.ts
//
// Contract C-138 Task 5: Unit tests for zoning_system

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerTransitionObservers, Transition } from '../components/transition.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { updateZoningSystem } from './zoning_system.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh bitECS world with all required observers registered.
 */
const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerTransitionObservers(world);
  return world;
};

/**
 * Resets module-level SoA arrays between tests.
 */
const _resetComponentArrays = (): void => {
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
 * Creates a player entity at the given position and returns its EID.
 */
const createPlayer = (world: World, x: number, y: number): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x, y }));
  return eid;
};

/**
 * Creates a transition zone entity at the given position with the
 * given target data. The position is the center of the zone rectangle.
 */
const createTransitionZone = (
  world: World,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    targetMap: string;
    targetX: number;
    targetY: number;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, Position);
  addComponent(world, eid, set(Position, { x: options.x, y: options.y }));
  addComponent(world, eid, Transition);
  addComponent(
    world,
    eid,
    set(Transition, {
      targetMap: options.targetMap,
      targetX: options.targetX,
      targetY: options.targetY,
      width: options.width,
      height: options.height,
      triggered: false,
    }),
  );
  return eid;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('zoning_system', () => {
  let world: World;
  let bridge: MockEngineBridge;

  beforeEach(() => {
    world = createTestWorld();
    bridge = new MockEngineBridge();
  });

  afterEach(() => {
    _resetComponentArrays();
    bridge.reset();
  });

  // ---------------------------------------------------------------------
  // Overlap detection
  // ---------------------------------------------------------------------

  describe('overlap detection', () => {
    it('emits ZONE_TRIGGERED when player is inside the zone rectangle', () => {
      const playerId = createPlayer(world, 100, 100);
      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 64,
        height: 64,
        targetMap: 'map2.json',
        targetX: 50,
        targetY: 80,
      });

      const events: Array<{
        type: string;
        targetMap?: string;
        targetX?: number;
        targetY?: number;
      }> = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        events.push(event);
      });

      updateZoningSystem(world, playerId, bridge);

      expect(events.length).toBe(1);
      const event = events[0];
      expect(event?.targetMap).toBe('map2.json');
      expect(event?.targetX).toBe(50);
      expect(event?.targetY).toBe(80);
    });

    it('does NOT emit when player is outside the zone', () => {
      const playerId = createPlayer(world, 0, 0);
      createTransitionZone(world, {
        x: 500,
        y: 500,
        width: 32,
        height: 32,
        targetMap: 'map2.json',
        targetX: 10,
        targetY: 20,
      });

      const events: unknown[] = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        events.push(event);
      });

      updateZoningSystem(world, playerId, bridge);

      expect(events.length).toBe(0);
    });

    it('emits only once — zone is locked after first trigger', () => {
      const playerId = createPlayer(world, 100, 100);
      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 64,
        height: 64,
        targetMap: 'map2.json',
        targetX: 0,
        targetY: 0,
      });

      let callCount = 0;
      bridge.on('ZONE_TRIGGERED', () => {
        callCount++;
      });

      // Run multiple ticks
      for (let i = 0; i < 5; i++) {
        updateZoningSystem(world, playerId, bridge);
      }

      expect(callCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Boundary conditions
  // ---------------------------------------------------------------------

  describe('boundary conditions', () => {
    it('does nothing when playerEntityId is zero', () => {
      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        targetMap: 'map2.json',
        targetX: 0,
        targetY: 0,
      });

      const events: unknown[] = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        events.push(event);
      });

      updateZoningSystem(world, 0, bridge);

      expect(events.length).toBe(0);
    });

    it('does nothing when player has no Position', () => {
      // Create a player without a Position component
      const worldRaw = createWorld();
      registerTransitionObservers(worldRaw);
      const playerId = addEntity(worldRaw); // no Position component

      createTransitionZone(worldRaw, {
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        targetMap: 'map2.json',
        targetX: 0,
        targetY: 0,
      });

      const events: unknown[] = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        events.push(event);
      });

      updateZoningSystem(worldRaw, playerId, bridge);

      expect(events.length).toBe(0);

      // Cleanup
      _resetComponentArrays();
    });

    it('does nothing when no transition zones exist', () => {
      const playerId = createPlayer(world, 50, 50);

      const events: unknown[] = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        events.push(event);
      });

      updateZoningSystem(world, playerId, bridge);

      expect(events.length).toBe(0);
    });

    it('handles player at edge of zone (exactly on boundary)', () => {
      const playerId = createPlayer(world, 100, 100);
      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 2,
        height: 2,
        targetMap: 'map2.json',
        targetX: 10,
        targetY: 20,
      });

      let triggered = false;
      bridge.on('ZONE_TRIGGERED', () => {
        triggered = true;
      });

      updateZoningSystem(world, playerId, bridge);

      expect(triggered).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Multiple zones
  // ---------------------------------------------------------------------

  describe('multiple zones', () => {
    it('only triggers the overlapping zone, not all zones', () => {
      const playerId = createPlayer(world, 100, 100);

      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        targetMap: 'map2.json',
        targetX: 0,
        targetY: 0,
      });

      createTransitionZone(world, {
        x: 500,
        y: 500,
        width: 32,
        height: 32,
        targetMap: 'map3.json',
        targetX: 0,
        targetY: 0,
      });

      const triggered: string[] = [];
      bridge.on('ZONE_TRIGGERED', (event) => {
        triggered.push(event.targetMap);
      });

      updateZoningSystem(world, playerId, bridge);

      expect(triggered.length).toBe(1);
      expect(triggered[0]).toBe('map2.json');
    });

    it('handles adjacent zones correctly', () => {
      const playerId = createPlayer(world, 100, 100);

      // Zone at center, player walks through
      createTransitionZone(world, {
        x: 100,
        y: 100,
        width: 64,
        height: 64,
        targetMap: 'town.json',
        targetX: 200,
        targetY: 200,
      });

      let triggered = false;
      bridge.on('ZONE_TRIGGERED', () => {
        triggered = true;
      });

      updateZoningSystem(world, playerId, bridge);
      expect(triggered).toBe(true);
    });
  });
});
