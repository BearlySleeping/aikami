// packages/frontend/engine/src/systems/entity_spawner.test.ts
//
// Contract C-136 Task 4: Unit tests for entity_spawner system

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { createWorld, getAllEntities } from 'bitecs';
import type { SpawnPoint } from '../assets/map_loader.ts';
import { Appearance, registerAppearanceObservers } from '../components/appearance.ts';
import { NPCDialog, registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { Position, registerPositionObservers } from '../components/position.ts';
import { AssetAlias, registerVisualObservers, Visual } from '../components/visual.ts';
import { spawnEntities } from './entity_spawner.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resets all module-level SoA arrays to empty state.
 */
const _resetComponentArrays = (): void => {
  Position.x.length = 0;
  Position.y.length = 0;
  Visual.assetIndex.length = 0;
  Visual.tint.length = 0;
  Visual.visible.length = 0;
  NPCDialog.npcId.length = 0;
  NPCDialog.npcName.length = 0;
  NPCDialog.dialog.length = 0;
  NPCDialog.interactionRadius.length = 0;
  NPCDialog.playerInRange.length = 0;
  Appearance.layer0.length = 0;
  Appearance.layer1.length = 0;
  Appearance.layer2.length = 0;
  Appearance.layer3.length = 0;
  Appearance.layer4.length = 0;
};

/**
 * Creates a fresh bitECS world with all observers registered.
 */
const createTestWorld = (): World => {
  const world = createWorld();
  registerPositionObservers(world);
  registerVisualObservers(world);
  registerNPCDialogObservers(world);
  registerAppearanceObservers(world);
  return world;
};

/**
 * Creates a mock NPC spawn point.
 */
const createNpcSpawnPoint = (overrides?: Partial<SpawnPoint>): SpawnPoint => ({
  id: '1',
  type: 'npc',
  x: 320,
  y: 256,
  properties: {
    npcId: 'guard_town_1',
    npcName: 'Guard',
    dialogueKey: 'guard_greeting',
    interactionRadius: 60,
  },
  ...overrides,
});

/**
 * Creates a mock prop spawn point.
 */
const createPropSpawnPoint = (overrides?: Partial<SpawnPoint>): SpawnPoint => ({
  id: '2',
  type: 'prop',
  x: 128,
  y: 64,
  properties: {
    assetId: 'chest_01',
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('spawnEntities', () => {
  let world: World;

  beforeEach(() => {
    _resetComponentArrays();
    world = createTestWorld();
  });

  afterEach(() => {
    _resetComponentArrays();
  });

  // -------------------------------------------------------------------------
  // NPC spawning
  // -------------------------------------------------------------------------

  it('creates an NPC entity with Position, Visual, Appearance, and NPCDialog', () => {
    const spawnPoint = createNpcSpawnPoint();

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('npc');
    expect(results[0].spawnPoint).toBe(spawnPoint);

    const eid = results[0].eid;
    expect(eid).toBeGreaterThan(0);

    // Position
    expect(Position.x[eid]).toBe(320);
    expect(Position.y[eid]).toBe(256);

    // Visual
    expect(Visual.assetIndex[eid]).toBe(AssetAlias.NPC);
    expect(Visual.tint[eid]).toBe(0xffcc00);

    // Appearance
    expect(Appearance.layer0[eid]).toBe(10);
    expect(Appearance.layer1[eid]).toBe(11);
    expect(Appearance.layer2[eid]).toBe(12);
    expect(Appearance.layer3[eid]).toBe(13);
    expect(Appearance.layer4[eid]).toBe(14);

    // NPCDialog
    expect(NPCDialog.npcId[eid]).toBe('guard_town_1');
    expect(NPCDialog.npcName[eid]).toBe('Guard');
    expect(NPCDialog.dialog[eid]).toBe('guard_greeting');
    expect(NPCDialog.interactionRadius[eid]).toBe(60);
    expect(NPCDialog.playerInRange[eid]).toBe(false);
  });

  it('uses spawn point id as npcId when npcId property is missing', () => {
    const spawnPoint = createNpcSpawnPoint({
      properties: { npcName: 'Villager' },
    });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(NPCDialog.npcId[eid]).toBe('1'); // Falls back to spawnPoint.id
    expect(NPCDialog.npcName[eid]).toBe('Villager');
  });

  it('uses default dialog when dialogueKey property is missing', () => {
    const spawnPoint = createNpcSpawnPoint({
      properties: { npcId: 'npc_1' },
    });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(NPCDialog.dialog[eid]).toBe('Hello, traveler!');
  });

  it('uses default interaction radius when interactionRadius property is missing', () => {
    const spawnPoint = createNpcSpawnPoint({
      properties: { npcId: 'npc_1' },
    });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(NPCDialog.interactionRadius[eid]).toBe(50);
  });

  it('creates an NPC with default name when npcName property is missing', () => {
    const spawnPoint = createNpcSpawnPoint({
      id: '42',
      properties: { npcId: 'foo' },
    });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(NPCDialog.npcName[eid]).toBe('NPC 42');
  });

  // -------------------------------------------------------------------------
  // Prop spawning
  // -------------------------------------------------------------------------

  it('creates a prop entity with Position and Visual', () => {
    const spawnPoint = createPropSpawnPoint();

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('prop');

    const eid = results[0].eid;

    // Position
    expect(Position.x[eid]).toBe(128);
    expect(Position.y[eid]).toBe(64);

    // Visual
    expect(Visual.assetIndex[eid]).toBe(AssetAlias.PROP_CHEST);
    expect(Visual.tint[eid]).toBe(0xffffff);
  });

  it('uses default prop visual when assetId property is missing', () => {
    const spawnPoint = createPropSpawnPoint({
      properties: {},
    });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(Visual.assetIndex[eid]).toBe(AssetAlias.PROP_CHEST);
  });

  it('prop entities do NOT have NPCDialog or Appearance components', () => {
    const spawnPoint = createPropSpawnPoint();

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    expect(NPCDialog.npcId[eid]).toBeUndefined();
    expect(Appearance.layer0[eid]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Multiple spawn points
  // -------------------------------------------------------------------------

  it('spawns multiple entities from multiple spawn points', () => {
    const spawnPoints: SpawnPoint[] = [
      createNpcSpawnPoint({ id: '1', x: 100, y: 200 }),
      createNpcSpawnPoint({ id: '2', x: 300, y: 400 }),
      createPropSpawnPoint({ id: '3', x: 50, y: 150 }),
    ];

    const results = spawnEntities({ world, spawnPoints });

    expect(results).toHaveLength(3);
    expect(results[0].type).toBe('npc');
    expect(results[1].type).toBe('npc');
    expect(results[2].type).toBe('prop');

    const allEids = [...getAllEntities(world)];
    expect(allEids).toHaveLength(3);

    // Each entity should have a unique EID
    const eids = results.map((r) => r.eid);
    const uniqueEids = new Set(eids);
    expect(uniqueEids.size).toBe(3);
  });

  it('positions each entity at its spawn point coordinates', () => {
    const spawnPoints: SpawnPoint[] = [
      createNpcSpawnPoint({ id: '1', x: 42, y: 99 }),
      createPropSpawnPoint({ id: '2', x: 200, y: 300 }),
    ];

    const results = spawnEntities({ world, spawnPoints });

    expect(Position.x[results[0].eid]).toBe(42);
    expect(Position.y[results[0].eid]).toBe(99);
    expect(Position.x[results[1].eid]).toBe(200);
    expect(Position.y[results[1].eid]).toBe(300);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('returns empty array for empty spawn points', () => {
    const results = spawnEntities({ world, spawnPoints: [] });
    expect(results).toEqual([]);
  });

  it('skips spawn points with unknown type', () => {
    const spawnPoints: SpawnPoint[] = [
      createNpcSpawnPoint({ id: '1', type: 'npc' }),
      { id: '2', type: 'unknown', x: 0, y: 0, properties: {} },
      createPropSpawnPoint({ id: '3', type: 'prop' }),
    ];

    const results = spawnEntities({ world, spawnPoints });

    // Should only create npc and prop, skip 'unknown'
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('npc');
    expect(results[1].type).toBe('prop');
  });

  it('assigns unique entity IDs across spawn calls', () => {
    const results1 = spawnEntities({
      world,
      spawnPoints: [createNpcSpawnPoint({ id: '1' })],
    });

    const results2 = spawnEntities({
      world,
      spawnPoints: [createNpcSpawnPoint({ id: '2' })],
    });

    expect(results1[0].eid).not.toBe(results2[0].eid);
    expect([...getAllEntities(world)]).toHaveLength(2);
  });

  it('handles spawn points with empty properties object', () => {
    const spawnPoint = createNpcSpawnPoint({ properties: {} });

    const results = spawnEntities({ world, spawnPoints: [spawnPoint] });
    const eid = results[0].eid;

    // All defaults should be applied
    expect(Position.x[eid]).toBe(320);
    expect(Position.y[eid]).toBe(256);
    expect(NPCDialog.npcId[eid]).toBe('1'); // Falls back to spawnPoint.id
  });
});
