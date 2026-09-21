// packages/frontend/engine/src/game_world/scene_transition.test.ts

import { describe, expect, test } from 'bun:test';
import type { PackConfig } from '@aikami/types';
import { type PreparedScene, prepareScene } from './scene_transition.ts';
import {
  createDeferred,
  createSceneTransitionHarness,
  makeLoadOptions,
  makeMinimalTilemap,
  makePreparedScene,
  makeStaticLoader,
} from './testing/scene_transition_harness.ts';

const makePackConfig = (): PackConfig => ({
  tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
  props: {
    well: { name: 'Well', frame: 'well.png', isWalkable: false },
    gate: {
      name: 'Gate',
      frame: 'gate.png',
      isWalkable: true,
      anchor: { x: 0.25, y: 0.75 },
    },
  },
});

describe('prepareScene', () => {
  test('derives grids, spawns, zones, and identifiers from the canonical tilemap', async () => {
    const scene = await prepareScene({
      mapUrl: 'maps:emberwatch/inn.json',
      loadMap: makeStaticLoader(),
    });

    expect(scene.tilemap.width).toBe(4);
    expect(scene.terrainGrid.width).toBe(4);
    expect(scene.terrainGrid.tileSize).toBe(32);
    expect(scene.activePathGrid.cost).toBeInstanceOf(Uint8Array);
    expect(scene.activePathGrid.cost.length).toBe(16);
    // The path grid is a distinct copy with a rebuilt cost channel.
    expect(scene.activePathGrid.cost).not.toBe(scene.terrainGrid.cost);

    // Both typed objects are spawn points; only the transition is a zone.
    expect(scene.spawnPoints).toHaveLength(2);
    expect(scene.transitionZones).toHaveLength(1);
    expect(scene.transitionZones[0]?.id).toBe('2');
    expect(scene.mapId).toBe('inn');
    expect(scene.mapPixelWidth).toBe(128);
    expect(scene.mapPixelHeight).toBe(128);
    expect(scene.propFrameMeta.size).toBe(0);
  });

  test('carries the packConfig, prop anchors, and a collision grid', async () => {
    const packConfig = makePackConfig();
    const scene = await prepareScene({
      mapUrl: 'maps:emberwatch/hall.json',
      packConfig,
      loadMap: makeStaticLoader(),
    });

    expect(scene.packConfig).toBe(packConfig);
    expect(scene.collisionGrid).toBeDefined();
    expect(scene.collisionGrid?.grid).toBeArrayOfSize(16);
    // Default anchor is bottom-centre; an explicit anchor is preserved.
    expect(scene.propFrameMeta.get('well.png')).toEqual({ anchorX: 0.5, anchorY: 1.0 });
    expect(scene.propFrameMeta.get('gate.png')).toEqual({ anchorX: 0.25, anchorY: 0.75 });
  });

  test('falls back to the explicit collision layer without a packConfig', async () => {
    const scene = await prepareScene({
      mapUrl: 'maps:dev/room.json',
      loadMap: makeStaticLoader(),
    });
    expect(scene.packConfig).toBeUndefined();
    // The zeroed collision layer still materializes a grid record.
    expect(scene.collisionGrid?.grid.every((solid) => solid === false)).toBe(true);
  });
});

describe('SceneTransitionRunner', () => {
  test('runs the transition effects in order and resumes the engine', async () => {
    const harness = createSceneTransitionHarness();
    await harness.runner.load(makeLoadOptions());

    expect(harness.calls).toEqual([
      'onDiscontinuity',
      'running:false',
      'locked:true',
      'resetSurface',
      'installScene',
      'render',
      'postLoadMap',
      'running:true',
      'locked:false',
    ]);
    expect(harness.emitted).toEqual(['MAP_LOADED', 'MAP_ENTERED:maps:harness/room.json']);
    expect(harness.state.installed).not.toBeNull();
    expect(harness.runner.generation).toBe(1);
  });

  test('a newer transition supersedes an in-flight parse', async () => {
    const gate = createDeferred<PreparedScene>();
    let prepareCalls = 0;
    const harness = createSceneTransitionHarness({
      prepare: () => {
        prepareCalls++;
        return prepareCalls === 1 ? gate.promise : makePreparedScene();
      },
    });

    const first = harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    await Promise.resolve(); // let the first load reach its prepare await

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' }));
    gate.resolve(await makePreparedScene());
    await first;

    // Only the newest transition posts, installs, and emits.
    expect(harness.calls.filter((call) => call === 'postLoadMap')).toHaveLength(1);
    expect(harness.emitted).toEqual(['MAP_LOADED', 'MAP_ENTERED:maps:second.json']);
    expect(harness.state.installed).not.toBeNull();
    expect(harness.runner.generation).toBe(2);
  });

  test('a render that reports superseded never posts or emits', async () => {
    const harness = createSceneTransitionHarness({
      render: async () => false,
    });

    await harness.runner.load(makeLoadOptions());

    expect(harness.calls).not.toContain('postLoadMap');
    expect(harness.emitted).toEqual([]);
    // The engine stays paused/locked until the newer transition completes.
    expect(harness.state.running).toBe(false);
    expect(harness.state.inputLocked).toBe(true);
  });

  test('invalidateInFlight supersedes a pending load', async () => {
    const gate = createDeferred<PreparedScene>();
    const harness = createSceneTransitionHarness({ prepare: () => gate.promise });

    const loading = harness.runner.load(makeLoadOptions());
    await Promise.resolve();
    harness.runner.invalidateInFlight();
    gate.resolve(await makePreparedScene());
    await loading;

    expect(harness.emitted).toEqual([]);
    expect(harness.state.installed).toBeNull();
    // load() bumped to 1; invalidateInFlight() bumped it again to 2.
    expect(harness.runner.generation).toBe(2);
  });

  test('a failed worker round-trip unlocks, emits an error, and rethrows', async () => {
    const harness = createSceneTransitionHarness({
      postLoadMap: async () => {
        throw new Error('boom');
      },
    });

    await expect(harness.runner.load(makeLoadOptions())).rejects.toThrow('boom');
    expect(harness.emitted).toEqual(['GAME_ERROR:Map load failed: boom']);
    expect(harness.state.running).toBe(true);
    expect(harness.state.inputLocked).toBe(false);
  });

  test('an error from a superseded load is swallowed', async () => {
    const gate = createDeferred<PreparedScene>();
    let prepareCalls = 0;
    const harness = createSceneTransitionHarness({
      prepare: () => {
        prepareCalls++;
        return prepareCalls === 1 ? gate.promise : makePreparedScene();
      },
    });

    const first = harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    await Promise.resolve();
    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' }));

    gate.reject(new Error('stale failure'));
    await expect(first).resolves.toBeUndefined();
    expect(harness.emitted).toEqual(['MAP_LOADED', 'MAP_ENTERED:maps:second.json']);
  });

  test('prepare receives the map URL and pack config', async () => {
    const seen: Array<{ mapUrl: string; hasPack: boolean }> = [];
    const harness = createSceneTransitionHarness({
      prepare: async (options) => {
        seen.push({ mapUrl: options.mapUrl, hasPack: options.packConfig !== undefined });
        return makePreparedScene(makeMinimalTilemap());
      },
    });

    await harness.runner.load(
      makeLoadOptions({ mapUrl: 'maps:x.json', packConfig: makePackConfig() }),
    );

    expect(seen).toEqual([{ mapUrl: 'maps:x.json', hasPack: true }]);
  });
});
