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
    barrel: {
      name: 'Barrel',
      frame: 'prop_barrel.png',
      isWalkable: false,
      renderSize: { width: 32, height: 48 },
      shadow: { kind: 'ellipse', width: 30, height: 12, opacity: 0.2 },
    },
    hearth: { name: 'Hearth', frame: 'prop_hearth.png', isWalkable: false, emissive: true },
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

  test('carries authored logical size and contact shadow per frame', async () => {
    const scene = await prepareScene({
      mapUrl: 'maps:emberwatch/hall.json',
      packConfig: makePackConfig(),
      loadMap: makeStaticLoader(),
    });

    // A prop declaring renderSize + shadow exposes both to the renderer so the
    // texture's packed frame size can never dictate the world footprint.
    expect(scene.propFrameMeta.get('prop_barrel.png')).toEqual({
      anchorX: 0.5,
      anchorY: 1.0,
      renderWidth: 32,
      renderHeight: 48,
      shadow: { kind: 'ellipse', width: 30, height: 12, opacity: 0.2 },
    });
    // A legacy prop (no authored presentation) carries neither field.
    expect(scene.propFrameMeta.get('well.png')).toEqual({ anchorX: 0.5, anchorY: 1.0 });
  });

  test('carries the C-545 emissive opt-out per frame', async () => {
    const scene = await prepareScene({
      mapUrl: 'maps:emberwatch/hall.json',
      packConfig: makePackConfig(),
      loadMap: makeStaticLoader(),
    });

    // A light-source prop exposes its ambient opt-out to the renderer.
    expect(scene.propFrameMeta.get('prop_hearth.png')?.emissive).toBe(true);
    // An ordinary prop omits the field entirely (defaults to tinted).
    expect(scene.propFrameMeta.get('well.png')?.emissive).toBeUndefined();
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

  test('a failed worker round-trip on first boot holds the engine locked', async () => {
    // Previously this resumed and unlocked an engine whose world was empty,
    // handing the player a live-but-nothing game. First boot has no previous
    // scene, so the honest outcome is a held, locked, reported failure.
    const harness = createSceneTransitionHarness({
      postLoadMap: async () => {
        throw new Error('boom');
      },
    });

    await expect(harness.runner.load(makeLoadOptions())).rejects.toThrow('boom');
    expect(harness.emitted).toEqual([
      'GAME_ERROR:Map load failed: boom. The engine is paused — reload the game to continue.',
    ]);
    expect(harness.state.running).toBe(false);
    expect(harness.state.inputLocked).toBe(true);
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

describe('SceneTransitionRunner — prepare before destructive teardown', () => {
  test('the previous surface survives an unparseable replacement', async () => {
    // The P0 ordering defect: the old surface was torn down BEFORE the new
    // map was even parsed, so a 404/parse failure left the player staring at
    // an empty world with the engine resumed and input unlocked.
    const gate = createDeferred<PreparedScene>();
    const harness = createSceneTransitionHarness({ prepare: () => gate.promise });

    const loading = harness.runner.load(makeLoadOptions({ mapUrl: 'maps:new.json' }));
    await Promise.resolve();

    // Still parsing: nothing has been destroyed yet.
    expect(harness.calls).not.toContain('resetSurface');
    expect(harness.state.resetCount).toBe(0);

    gate.reject(new Error('404 not found'));
    await expect(loading).rejects.toThrow('404 not found');

    // Nothing was torn down, so there is nothing to replay.
    expect(harness.state.resetCount).toBe(0);
    expect(harness.calls).not.toContain('render');
  });
});

describe('SceneTransitionRunner — genuine recovery', () => {
  test('a failed switch replays the previous scene instead of resuming an empty world', async () => {
    let failNextRender = false;
    let renders = 0;
    let posts = 0;
    const harness = createSceneTransitionHarness({
      render: async (_scene, isCurrent) => {
        renders++;
        if (failNextRender) {
          failNextRender = false;
          throw new Error('renderer exploded');
        }
        return isCurrent();
      },
      postLoadMap: async () => {
        posts++;
      },
    });

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    const committedScene = harness.state.installed;
    failNextRender = true;
    harness.resetCalls();
    harness.emitted.length = 0;

    await expect(
      harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' })),
    ).rejects.toThrow('renderer exploded');

    // The old scene came back: re-installed, re-rendered, and — crucially —
    // re-posted to the worker so both sides agree again.
    expect(harness.state.installed).toBe(committedScene);
    expect(renders).toBe(3);
    expect(posts).toBe(2);
    expect(harness.state.running).toBe(true);
    expect(harness.state.inputLocked).toBe(false);
    // The failure is still reported, and completion is NOT signalled.
    expect(harness.emitted).toEqual(['GAME_ERROR:Map load failed: renderer exploded']);
  });

  test('a failed parse after a commit replays the previous scene', async () => {
    let prepareShouldFail = false;
    const harness = createSceneTransitionHarness({
      prepare: async () => {
        if (prepareShouldFail) {
          throw new Error('new map is broken');
        }
        return makePreparedScene();
      },
    });

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    const committedScene = harness.state.installed;
    prepareShouldFail = true;
    harness.resetCalls();
    harness.emitted.length = 0;

    await expect(
      harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' })),
    ).rejects.toThrow('new map is broken');

    expect(harness.state.installed).toBe(committedScene);
    expect(harness.state.running).toBe(true);
    expect(harness.state.inputLocked).toBe(false);
    expect(harness.emitted).toEqual(['GAME_ERROR:Map load failed: new map is broken']);
  });

  test('a worker rejection replays the previous scene and re-posts the worker payload', async () => {
    let posts = 0;
    const harness = createSceneTransitionHarness({
      postLoadMap: async () => {
        posts++;
        if (posts === 2) {
          throw new Error('worker rejected LOAD_MAP');
        }
      },
    });

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    harness.resetCalls();
    harness.emitted.length = 0;

    await expect(
      harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' })),
    ).rejects.toThrow('worker rejected LOAD_MAP');

    // Three posts total: the first scene, the failed switch, and the replay.
    expect(posts).toBe(3);
    expect(harness.state.running).toBe(true);
    expect(harness.state.inputLocked).toBe(false);
    expect(harness.emitted).toEqual(['GAME_ERROR:Map load failed: worker rejected LOAD_MAP']);
  });

  test('a failed first boot stays paused and locked with an actionable error', async () => {
    // There is no previous scene to replay, so "recovery" would be a lie. The
    // engine must hold still and tell the player what to do.
    const harness = createSceneTransitionHarness({
      prepare: async () => {
        throw new Error('content pack unavailable');
      },
    });

    await expect(harness.runner.load(makeLoadOptions())).rejects.toThrow(
      'content pack unavailable',
    );

    expect(harness.state.running).toBe(false);
    expect(harness.state.inputLocked).toBe(true);
    expect(harness.emitted).toEqual([
      'GAME_ERROR:Map load failed: content pack unavailable. The engine is paused — reload the game to continue.',
    ]);
    expect(harness.calls).not.toContain('render');
  });

  test('a failed replay holds the engine locked instead of unlocking a void', async () => {
    let renders = 0;
    const harness = createSceneTransitionHarness({
      render: async (_scene, isCurrent) => {
        renders++;
        if (renders > 1) {
          throw new Error('replay render failed');
        }
        return isCurrent();
      },
    });

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    harness.emitted.length = 0;

    await expect(
      harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' })),
    ).rejects.toThrow('replay render failed');

    expect(harness.state.running).toBe(false);
    expect(harness.state.inputLocked).toBe(true);
    expect(harness.emitted[0]).toContain('recovery failed: replay render failed');
    expect(harness.emitted[0]).toContain('reload the game to continue');
  });

  test('a superseded stale operation neither recovers nor unlocks', async () => {
    const gate = createDeferred<PreparedScene>();
    let calls = 0;
    const harness = createSceneTransitionHarness({
      prepare: async () => {
        calls++;
        return calls === 1 ? gate.promise : makePreparedScene();
      },
    });

    const stale = harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));
    await Promise.resolve();
    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' }));
    harness.resetCalls();
    harness.emitted.length = 0;

    gate.reject(new Error('stale failure'));
    await expect(stale).resolves.toBeUndefined();

    // The stale failure owns nothing: no replay, no resume, no unlock, no UI.
    expect(harness.calls).toEqual([]);
    expect(harness.emitted).toEqual([]);
    expect(harness.state.inputLocked).toBe(false);
    expect(harness.state.running).toBe(true);
  });

  test('a replay superseded by a newer transition does not resume', async () => {
    let renders = 0;
    const recoveryGate = createDeferred<boolean>();
    const harness = createSceneTransitionHarness({
      prepare: async () => {
        if (renders === 1) {
          throw new Error('new map is broken');
        }
        return makePreparedScene();
      },
      render: async (_scene, isCurrent) => {
        renders++;
        if (renders === 2) {
          // The replay pauses here; a newer transition takes over.
          return recoveryGate.promise;
        }
        return isCurrent();
      },
    });

    await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:first.json' }));

    const failing = harness.runner.load(makeLoadOptions({ mapUrl: 'maps:second.json' }));
    await Promise.resolve();
    await Promise.resolve();

    harness.runner.invalidateInFlight();
    recoveryGate.resolve(true);
    await expect(failing).rejects.toThrow('new map is broken');

    // The replay released control instead of resuming on a stale generation.
    expect(harness.state.inputLocked).toBe(true);
  });
});

describe('SceneTransitionRunner — disposal', () => {
  test('dispose stops an in-flight load from resuming or unlocking', async () => {
    const gate = createDeferred<PreparedScene>();
    const harness = createSceneTransitionHarness({ prepare: () => gate.promise });

    const loading = harness.runner.load(makeLoadOptions());
    await Promise.resolve();

    harness.runner.dispose();
    gate.resolve(await makePreparedScene());
    await loading;

    expect(harness.calls).not.toContain('resetSurface');
    expect(harness.calls).not.toContain('render');
    expect(harness.calls).not.toContain('running:true');
    expect(harness.calls).not.toContain('locked:false');
    expect(harness.emitted).toEqual([]);
    expect(harness.state.running).toBe(false);
    expect(harness.state.inputLocked).toBe(true);
    expect(harness.runner.disposed).toBe(true);
  });

  test('a load requested after disposal is ignored outright', async () => {
    const harness = createSceneTransitionHarness();
    harness.runner.dispose();
    harness.resetCalls();

    await harness.runner.load(makeLoadOptions());

    expect(harness.calls).toEqual([]);
    expect(harness.emitted).toEqual([]);
  });

  test('a disposed runner does not replay the committed scene on failure', async () => {
    const harness = createSceneTransitionHarness();
    await harness.runner.load(makeLoadOptions());
    harness.runner.dispose();
    harness.resetCalls();
    harness.emitted.length = 0;

    let threw = false;
    try {
      await harness.runner.load(makeLoadOptions({ mapUrl: 'maps:later.json' }));
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(harness.calls).toEqual([]);
    expect(harness.emitted).toEqual([]);
  });
});
