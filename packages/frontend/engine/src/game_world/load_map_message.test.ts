// packages/frontend/engine/src/game_world/load_map_message.test.ts
//
// The LOAD_MAP payload is the worker's entire view of a new map, and it has
// to survive structured cloning. These tests pin both properties.

import { describe, expect, test } from 'bun:test';
import { buildLoadMapMessage, type LoadMapScene } from './load_map_message.ts';

const makeScene = (overrides: Partial<LoadMapScene> = {}): LoadMapScene => ({
  spawnPoints: [
    {
      id: '1',
      type: 'spawn',
      x: 32,
      y: 64,
      properties: { npcId: 'guard' },
    },
  ],
  transitionZones: [],
  collisionGrid: undefined,
  terrainGrid: {
    width: 2,
    height: 2,
    tileSize: 32,
    cost: new Uint8Array(4),
    blocksSight: new Uint8Array(4),
  },
  packConfig: undefined,
  mapPixelWidth: 64,
  mapPixelHeight: 64,
  spawnPointEntities: [],
  mapId: 'room',
  ...overrides,
});

const OPTIONS = { mapUrl: 'maps:room.json', targetX: 64, targetY: 64 };

describe('buildLoadMapMessage', () => {
  test('carries the scene geometry the worker spawns from', () => {
    const message = buildLoadMapMessage(makeScene(), OPTIONS);

    expect(message.type).toBe('LOAD_MAP');
    expect(message.mapId).toBe('room');
    expect(message.mapPixelWidth).toBe(64);
    expect(message.mapPixelHeight).toBe(64);
    expect(message.spawnPointEntities).toEqual([]);
  });

  test('carries the cross-scene progress from the load options', () => {
    const message = buildLoadMapMessage(makeScene(), {
      ...OPTIONS,
      targetX: 16,
      targetY: 32,
      defeatedEnemies: ['slime-1'],
      collectedPickups: ['coin-2'],
      interactableStates: { 'door-1': { isOpen: true } },
      targetSpawnHash: 42,
      defaultSpawnHash: 7,
      disableClamping: true,
    });

    expect(message.targetX).toBe(16);
    expect(message.targetY).toBe(32);
    expect(message.defeatedEnemies).toEqual(['slime-1']);
    expect(message.collectedPickups).toEqual(['coin-2']);
    expect(message.interactableStates).toEqual({ 'door-1': { isOpen: true } });
    expect(message.targetSpawnHash).toBe(42);
    expect(message.defaultSpawnHash).toBe(7);
    expect(message.disableClamping).toBe(true);
  });

  test('normalises Tiled properties into plain JSON', () => {
    // A Proxy-wrapped property (Python export) is not structurally clonable;
    // the message must carry JSON, not the proxy.
    const properties = new Proxy({ npcId: 'guard' }, {});
    const message = buildLoadMapMessage(
      makeScene({
        spawnPoints: [{ id: '1', type: 'spawn', x: 0, y: 0, properties }],
      }),
      OPTIONS,
    );

    const spawnPoints = message.spawnPoints as Array<{ properties: unknown }>;
    expect(spawnPoints[0]?.properties).toEqual({ npcId: 'guard' });
    // Structured-cloneable in practice.
    expect(() => structuredClone(spawnPoints[0])).not.toThrow();
  });

  test('sends the collision grid as a plain array', () => {
    const grid: boolean[] = [false, true, true, false];
    const message = buildLoadMapMessage(
      makeScene({
        collisionGrid: { width: 2, height: 2, tileSize: 32, grid },
      }),
      OPTIONS,
    );

    const collision = message.collisionGrid as { grid: unknown };
    expect(Array.isArray(collision.grid)).toBe(true);
    expect(collision.grid).not.toBe(grid);
    expect(() => structuredClone(message.collisionGrid)).not.toThrow();
  });

  test('omits the collision grid entirely when the scene has none', () => {
    expect(buildLoadMapMessage(makeScene(), OPTIONS).collisionGrid).toBeUndefined();
  });

  test('passes the terrain grid through untouched', () => {
    const terrainGrid = {
      width: 2,
      height: 2,
      tileSize: 32,
      cost: new Uint8Array(4),
      blocksSight: new Uint8Array(4),
    };
    const message = buildLoadMapMessage(makeScene({ terrainGrid }), OPTIONS);
    // The worker owns the authoritative copy; sharing the reference here is
    // deliberate, so identity is what the test pins.
    expect(message.terrainGrid).toBe(terrainGrid);
  });
});
