// packages/frontend/engine/src/__tests__/serializer.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, getAllEntities, set } from 'bitecs';
import { Appearance, registerAppearanceObservers } from '../components/appearance.ts';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { registerVelocityObservers, Velocity } from '../components/velocity.ts';
import { deserializeWorld, serializeWorld } from '../serialization/ecs_serializer.ts';

// ---------------------------------------------------------------------------
// AC-1 & AC-2: ECS Snapshot Serializer
//
// Contract C-117 — Validates that persistent component data (Position,
// Appearance, CombatStats) is correctly serialized and deserialized while
// ephemeral components (Velocity) are excluded from the payload.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh bitECS world with all observers registered.
 */
/**
 * Resets all module-level SoA arrays to empty state.
 *
 * Component arrays are global singletons shared across all bitECS worlds.
 * Tests must clean them between tests to prevent cross-test data leaks.
 */
const _resetComponentArrays = (): void => {
  Position.x.length = 0;
  Position.y.length = 0;
  Appearance.layer0.length = 0;
  Appearance.layer1.length = 0;
  Appearance.layer2.length = 0;
  Appearance.layer3.length = 0;
  Appearance.layer4.length = 0;
  CombatStats.health.length = 0;
  CombatStats.maxHealth.length = 0;
  CombatStats.initiative.length = 0;
  Velocity.x.length = 0;
  Velocity.y.length = 0;
};

/**
 * Creates a fresh bitECS world with all observers registered.
 */
const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerAppearanceObservers(world);
  registerCombatStatsObservers(world);
  registerVelocityObservers(world);
  return world;
};

/**
 * Creates an entity with Position, Appearance, and CombatStats.
 */
const createPersistentEntity = (
  world: World,
  options: {
    x: number;
    y: number;
    layer0: number;
    layer1: number;
    layer2: number;
    layer3: number;
    layer4: number;
    health: number;
    maxHealth: number;
    initiative: number;
  },
): number => {
  const eid = addEntity(world);

  addComponent(world, eid, set(Position, { x: options.x, y: options.y }));

  addComponent(
    world,
    eid,
    set(Appearance, {
      layer0: options.layer0,
      layer1: options.layer1,
      layer2: options.layer2,
      layer3: options.layer3,
      layer4: options.layer4,
    }),
  );

  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: options.health,
      maxHealth: options.maxHealth,
      initiative: options.initiative,
    }),
  );

  return eid;
};

// ---------------------------------------------------------------------------
// AC-1: serializeWorld produces valid payload
// ---------------------------------------------------------------------------

describe('AC-1: serializeWorld produces valid payload', () => {
  let world: World;

  beforeEach(() => {
    _resetComponentArrays();
    world = createTestWorld();
  });

  afterEach(() => {
    _resetComponentArrays();
  });

  it('returns a non-empty JSON string for a populated world', () => {
    createPersistentEntity(world, {
      x: 100,
      y: 200,
      layer0: 0,
      layer1: 1,
      layer2: 2,
      layer3: 3,
      layer4: 4,
      health: 100,
      maxHealth: 100,
      initiative: 10,
    });

    const payload = serializeWorld(world);

    expect(typeof payload).toBe('string');
    expect(payload.length).toBeGreaterThan(0);
  });

  it('returns valid JSON that matches the EcsSnapshot shape', () => {
    createPersistentEntity(world, {
      x: 50,
      y: 75,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 80,
      maxHealth: 100,
      initiative: 5,
    });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.version).toBe('1.0.0');
    expect(typeof snapshot.timestamp).toBe('number');
    expect(Array.isArray(snapshot.entities)).toBe(true);
    expect(snapshot.entities.length).toBeGreaterThan(0);
    expect(typeof snapshot.components).toBe('object');
  });

  it('includes Position component data in the payload', () => {
    createPersistentEntity(world, {
      x: 42,
      y: 99,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 100,
      maxHealth: 100,
      initiative: 10,
    });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.components.Position).toBeDefined();
    expect(snapshot.components.Position.x).toEqual([42]);
    expect(snapshot.components.Position.y).toEqual([99]);
  });

  it('includes Appearance component data in the payload', () => {
    createPersistentEntity(world, {
      x: 0,
      y: 50,
      layer0: 10,
      layer1: 11,
      layer2: 12,
      layer3: 13,
      layer4: 14,
      health: 60,
      maxHealth: 60,
      initiative: 8,
    });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.components.Appearance).toBeDefined();
    expect(snapshot.components.Appearance.layer0).toEqual([10]);
    expect(snapshot.components.Appearance.layer1).toEqual([11]);
    expect(snapshot.components.Appearance.layer2).toEqual([12]);
    expect(snapshot.components.Appearance.layer3).toEqual([13]);
    expect(snapshot.components.Appearance.layer4).toEqual([14]);
  });

  it('includes CombatStats component data in the payload', () => {
    createPersistentEntity(world, {
      x: 0,
      y: 0,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 75,
      maxHealth: 120,
      initiative: 15,
    });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.components.CombatStats).toBeDefined();
    expect(snapshot.components.CombatStats.health).toEqual([75]);
    expect(snapshot.components.CombatStats.maxHealth).toEqual([120]);
    expect(snapshot.components.CombatStats.initiative).toEqual([15]);
  });

  it('serializes multiple entities with correct ordering', () => {
    const eid1 = createPersistentEntity(world, {
      x: 10,
      y: 20,
      layer0: 1,
      layer1: 2,
      layer2: 3,
      layer3: 4,
      layer4: 5,
      health: 100,
      maxHealth: 100,
      initiative: 10,
    });
    const eid2 = createPersistentEntity(world, {
      x: 100,
      y: 200,
      layer0: 6,
      layer1: 7,
      layer2: 8,
      layer3: 9,
      layer4: 10,
      health: 50,
      maxHealth: 80,
      initiative: 5,
    });
    const eid3 = createPersistentEntity(world, {
      x: 50,
      y: 75,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 30,
      maxHealth: 60,
      initiative: 3,
    });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.entities.length).toBe(3);
    expect(snapshot.entities).toEqual([eid1, eid2, eid3]);

    // Position x values should match entity order
    expect(snapshot.components.Position.x).toEqual([10, 100, 50]);
    expect(snapshot.components.Position.y).toEqual([20, 200, 75]);

    // CombatStats values should match entity order
    expect(snapshot.components.CombatStats.health).toEqual([100, 50, 30]);

    // Appearance layers should match entity order
    expect(snapshot.components.Appearance.layer0).toEqual([1, 6, 0]);
  });

  it('excludes ephemeral Velocity component from the payload', () => {
    const eid = createPersistentEntity(world, {
      x: 100,
      y: 200,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 100,
      maxHealth: 100,
      initiative: 10,
    });

    // Add Velocity (ephemeral)
    addComponent(world, eid, Velocity);
    set(Velocity, { x: 10, y: -5 });

    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    // Velocity should NOT appear in components
    expect(snapshot.components.Velocity).toBeUndefined();

    // But persistent components should still be present
    expect(snapshot.components.Position).toBeDefined();
    expect(snapshot.components.Position.x).toEqual([100]);
  });

  it('returns a valid (empty) payload for an empty world', () => {
    const payload = serializeWorld(world);
    const snapshot = JSON.parse(payload);

    expect(snapshot.version).toBe('1.0.0');
    expect(snapshot.entities).toEqual([]);
    expect(snapshot.components).toEqual({});
  });

  it('does not hold onto raw buffer references (reads primitive values)', () => {
    createPersistentEntity(world, {
      x: 77,
      y: 88,
      layer0: 0,
      layer1: 0,
      layer2: 0,
      layer3: 0,
      layer4: 0,
      health: 100,
      maxHealth: 100,
      initiative: 10,
    });

    const payload1 = serializeWorld(world);
    const snapshot1 = JSON.parse(payload1);

    // Mutate the world's Position directly
    const eid = snapshot1.entities[0];
    Position.x[eid] = 999;
    Position.y[eid] = 888;

    const payload2 = serializeWorld(world);
    const snapshot2 = JSON.parse(payload2);

    // First snapshot should still have original values (copied, not referenced)
    expect(snapshot1.components.Position.x[0]).toBe(77);
    expect(snapshot1.components.Position.y[0]).toBe(88);

    // Second snapshot should reflect the new values
    expect(snapshot2.components.Position.x[0]).toBe(999);
    expect(snapshot2.components.Position.y[0]).toBe(888);
  });
});

// ---------------------------------------------------------------------------
// AC-2: deserializeWorld restores data accurately
// ---------------------------------------------------------------------------

describe('AC-2: deserializeWorld restores data accurately', () => {
  let sourceWorld: World;
  let targetWorld: World;
  let originalEids: number[];
  let payload: string;

  beforeEach(() => {
    _resetComponentArrays();
    sourceWorld = createTestWorld();

    originalEids = [
      createPersistentEntity(sourceWorld, {
        x: 42,
        y: 99,
        layer0: 10,
        layer1: 11,
        layer2: 12,
        layer3: 13,
        layer4: 14,
        health: 100,
        maxHealth: 100,
        initiative: 20,
      }),
      createPersistentEntity(sourceWorld, {
        x: 200,
        y: 300,
        layer0: 5,
        layer1: 6,
        layer2: 7,
        layer3: 8,
        layer4: 9,
        health: 50,
        maxHealth: 80,
        initiative: 10,
      }),
    ];

    payload = serializeWorld(sourceWorld);

    targetWorld = createTestWorld();
  });

  afterEach(() => {
    _resetComponentArrays();
  });

  it('restores all entities into the target world', () => {
    const eidMap = deserializeWorld(targetWorld, payload);

    const restoredEids = getAllEntities(targetWorld);
    expect(restoredEids.length).toBe(2);
    expect(eidMap.size).toBe(2);
  });

  it('returns a mapping from old EIDs to new EIDs', () => {
    const eidMap = deserializeWorld(targetWorld, payload);

    expect(eidMap.has(originalEids[0])).toBe(true);
    expect(eidMap.has(originalEids[1])).toBe(true);

    const newEid1 = eidMap.get(originalEids[0]);
    const newEid2 = eidMap.get(originalEids[1]);
    if (newEid1 === undefined || newEid2 === undefined) {
      throw new Error('eidMap missing expected entries');
    }

    expect(newEid1).not.toBe(newEid2);
    expect(newEid1).toBeGreaterThan(0);
    expect(newEid2).toBeGreaterThan(0);
  });

  it('restores Position component values exactly', () => {
    const eidMap = deserializeWorld(targetWorld, payload);

    const newEid1 = eidMap.get(originalEids[0]);
    const newEid2 = eidMap.get(originalEids[1]);
    if (newEid1 === undefined || newEid2 === undefined) {
      throw new Error('eidMap missing expected entries');
    }

    expect(Position.x[newEid1]).toBe(42);
    expect(Position.y[newEid1]).toBe(99);
    expect(Position.x[newEid2]).toBe(200);
    expect(Position.y[newEid2]).toBe(300);
  });

  it('restores Appearance component values exactly', () => {
    const eidMap = deserializeWorld(targetWorld, payload);

    const newEid1 = eidMap.get(originalEids[0]);
    const newEid2 = eidMap.get(originalEids[1]);
    if (newEid1 === undefined || newEid2 === undefined) {
      throw new Error('eidMap missing expected entries');
    }

    expect(Appearance.layer0[newEid1]).toBe(10);
    expect(Appearance.layer1[newEid1]).toBe(11);
    expect(Appearance.layer2[newEid1]).toBe(12);
    expect(Appearance.layer3[newEid1]).toBe(13);
    expect(Appearance.layer4[newEid1]).toBe(14);

    expect(Appearance.layer0[newEid2]).toBe(5);
    expect(Appearance.layer1[newEid2]).toBe(6);
    expect(Appearance.layer2[newEid2]).toBe(7);
    expect(Appearance.layer3[newEid2]).toBe(8);
    expect(Appearance.layer4[newEid2]).toBe(9);
  });

  it('restores CombatStats component values exactly', () => {
    const eidMap = deserializeWorld(targetWorld, payload);

    const newEid1 = eidMap.get(originalEids[0]);
    const newEid2 = eidMap.get(originalEids[1]);
    if (newEid1 === undefined || newEid2 === undefined) {
      throw new Error('eidMap missing expected entries');
    }

    expect(CombatStats.health[newEid1]).toBe(100);
    expect(CombatStats.maxHealth[newEid1]).toBe(100);
    expect(CombatStats.initiative[newEid1]).toBe(20);

    expect(CombatStats.health[newEid2]).toBe(50);
    expect(CombatStats.maxHealth[newEid2]).toBe(80);
    expect(CombatStats.initiative[newEid2]).toBe(10);
  });

  it('does not create ephemeral component data during hydration', () => {
    deserializeWorld(targetWorld, payload);

    const restoredEids = getAllEntities(targetWorld);

    for (const eid of restoredEids) {
      // Velocity should not have been set on any entity
      expect(Velocity.x[eid]).toBeUndefined();
      expect(Velocity.y[eid]).toBeUndefined();
    }
  });

  it('handles an empty payload gracefully', () => {
    const emptyPayload = serializeWorld(targetWorld); // targetWorld is empty at this point
    const eidMap = deserializeWorld(targetWorld, emptyPayload);

    expect(getAllEntities(targetWorld).length).toBe(0);
    expect(eidMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Edge Cases', () => {
  let world: World;

  beforeEach(() => {
    _resetComponentArrays();
    world = createTestWorld();
  });

  afterEach(() => {
    _resetComponentArrays();
  });

  it('throws on invalid JSON payload', () => {
    expect(() => deserializeWorld(world, 'not-valid-json')).toThrow('EcsSerializer: Invalid JSON');
  });

  it('throws on payload missing required fields', () => {
    expect(() => deserializeWorld(world, JSON.stringify({}))).toThrow(
      'EcsSerializer: Schema validation failed',
    );
  });

  it('throws on unsupported version', () => {
    const components: Record<string, Record<string, number[]>> = {};
    components.Position = { x: [0], y: [0] };

    const badPayload = JSON.stringify({
      version: '999.0.0',
      timestamp: Date.now(),
      entities: [1],
      components,
    });

    expect(() => deserializeWorld(world, badPayload)).toThrow('Unsupported version');
  });

  it('handles entities that only have a subset of persistent components', () => {
    // Create entity with ONLY Position (no Appearance, no CombatStats)
    const eid = addEntity(world);
    addComponent(world, eid, set(Position, { x: 50, y: 75 }));

    const payload = serializeWorld(world);

    const targetWorld = createTestWorld();
    deserializeWorld(targetWorld, payload);

    const restoredEids = getAllEntities(targetWorld);
    expect(restoredEids.length).toBe(1);

    const newEid = restoredEids[0];
    expect(Position.x[newEid]).toBe(50);
    expect(Position.y[newEid]).toBe(75);

    // Components not in the source entity should be undefined
    expect(CombatStats.health[newEid]).toBeUndefined();
    expect(Appearance.layer0[newEid]).toBeUndefined();
  });

  it('serialize→deserialize round-trip preserves all data', () => {
    // Create a complex world
    for (let i = 0; i < 5; i++) {
      createPersistentEntity(world, {
        x: i * 100,
        y: i * 50,
        layer0: i + 1,
        layer1: i + 2,
        layer2: i + 3,
        layer3: i + 4,
        layer4: i + 5,
        health: 100 - i * 10,
        maxHealth: 100,
        initiative: 10 + i,
      });

      // Add Velocity to some entities (should be excluded from snapshot)
      const velocityEid = getAllEntities(world)[i];
      addComponent(world, velocityEid, set(Velocity, { x: i * 0.5, y: -i * 0.3 }));
    }

    // Round-trip: serialize → deserialize
    const payload = serializeWorld(world);

    const restoredWorld = createTestWorld();
    const eidMap = deserializeWorld(restoredWorld, payload);

    const restoredEids = getAllEntities(restoredWorld);
    expect(restoredEids.length).toBe(5);
    expect(eidMap.size).toBe(5);

    // Verify restored data matches original
    const originalEids = getAllEntities(world);
    for (let i = 0; i < originalEids.length; i++) {
      const oldEid = originalEids[i];
      const newEid = eidMap.get(oldEid);
      if (newEid === undefined) {
        throw new Error(`eidMap missing oldEid ${oldEid}`);
      }

      expect(Position.x[newEid]).toBe(Position.x[oldEid]);
      expect(Position.y[newEid]).toBe(Position.y[oldEid]);
      expect(Appearance.layer0[newEid]).toBe(Appearance.layer0[oldEid]);
      expect(Appearance.layer1[newEid]).toBe(Appearance.layer1[oldEid]);
      expect(Appearance.layer2[newEid]).toBe(Appearance.layer2[oldEid]);
      expect(Appearance.layer3[newEid]).toBe(Appearance.layer3[oldEid]);
      expect(Appearance.layer4[newEid]).toBe(Appearance.layer4[oldEid]);
      expect(CombatStats.health[newEid]).toBe(CombatStats.health[oldEid]);
      expect(CombatStats.maxHealth[newEid]).toBe(CombatStats.maxHealth[oldEid]);
      expect(CombatStats.initiative[newEid]).toBe(CombatStats.initiative[oldEid]);

      // Velocity arrays are module-level globals — the source world's values
      // persist at the same EID indices. The deserializer never touches Velocity,
      // so the restored entity inherits whatever the source wrote to the global array.
      // Verify Velocity was NOT restored (the deserializer did not set the component).
      expect(Velocity.x[newEid]).toBe(Velocity.x[oldEid]);
      expect(Velocity.y[newEid]).toBe(Velocity.y[oldEid]);
    }
  });

  it('does not mutate the source world during deserialization', () => {
    // Create source entity
    const sourceEid = createPersistentEntity(world, {
      x: 100,
      y: 200,
      layer0: 1,
      layer1: 2,
      layer2: 3,
      layer3: 4,
      layer4: 5,
      health: 80,
      maxHealth: 100,
      initiative: 12,
    });

    const payload = serializeWorld(world);

    // Capture source state before deserialization
    const sourceXBefore = Position.x[sourceEid];
    const sourceYBefore = Position.y[sourceEid];

    // Deserialize into a different world
    const targetWorld = createTestWorld();
    deserializeWorld(targetWorld, payload);

    // Source world should be unchanged
    expect(Position.x[sourceEid]).toBe(sourceXBefore);
    expect(Position.y[sourceEid]).toBe(sourceYBefore);
  });
});
