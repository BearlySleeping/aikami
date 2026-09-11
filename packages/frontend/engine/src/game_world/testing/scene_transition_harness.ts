// packages/frontend/engine/src/game_world/testing/scene_transition_harness.ts
//
// Test-only harness for scene transitions. Lives under `testing/` so the
// `guard-test-boundary` script hard-fails any production import of it.
//
// It wires a real {@link SceneTransitionRunner} to recorded, controllable
// doubles, and provides minimal-but-valid tilemap / prepared-scene fixtures.
// Tests can then assert the exact effect sequence of a transition without a
// PixiJS application, a worker, or a network.

import type { TilemapData } from '../../assets/map_loader.ts';
import type { CanonicalMapLoad } from '../../assets/scene/scene_loader.ts';
import {
  type LoadMapOptions,
  type PreparedScene,
  prepareScene,
  type SceneLoader,
  type SceneTransitionDeps,
  SceneTransitionRunner,
} from '../scene_transition.ts';

/** Minimal valid tilemap with terrain, collision, and an object group. */
export const makeMinimalTilemap = (overrides: Partial<TilemapData> = {}): TilemapData => {
  const width = 4;
  const height = 4;
  const cells = width * height;
  return {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        firstgid: 1,
        name: 'atlas',
        image: '/game-data/sprites/tilesets/harness.png',
        imagewidth: 128,
        imageheight: 64,
        tilewidth: 32,
        tileheight: 32,
        columns: 4,
        tilecount: 8,
        spacing: 0,
        margin: 0,
      },
    ],
    layers: [
      {
        name: 'ground',
        width,
        height,
        data: new Array<number>(cells).fill(1),
        visible: true,
        band: 'ground',
      },
      {
        name: 'collision',
        width,
        height,
        data: new Array<number>(cells).fill(0),
        visible: false,
      },
    ],
    terrain: new Array<string>(cells).fill('grass'),
    objectLayers: [
      {
        name: 'entities',
        objects: [
          {
            id: 1,
            name: 'spawn_start',
            x: 32,
            y: 64,
            width: 0,
            height: 0,
            type: 'spawn',
            properties: { npcId: 'guard' },
          },
          {
            id: 2,
            name: 'to_hall',
            x: 96,
            y: 0,
            width: 32,
            height: 32,
            type: 'transition',
            properties: {
              targetMap: 'maps:harness/hall.json',
              targetSpawnId: 'spawn_start',
              targetX: 16,
              targetY: 16,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
};

/** A canonical loader that always resolves one fixed tilemap (network-free). */
export const makeStaticLoader =
  (tilemap: TilemapData = makeMinimalTilemap()): SceneLoader =>
  async (): Promise<CanonicalMapLoad> => ({ tilemap, source: 'tiled' });

/** A prepared scene derived through the real pipeline from a static loader. */
export const makePreparedScene = async (
  tilemap: TilemapData = makeMinimalTilemap(),
): Promise<PreparedScene> =>
  prepareScene({ mapUrl: 'maps:harness/room.json', loadMap: makeStaticLoader(tilemap) });

/** Resolvable-now or defer-able promise used to control async ordering. */
export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Recorded state + call log produced by a harness run. */
export type SceneTransitionHarness = {
  runner: SceneTransitionRunner;
  deps: SceneTransitionDeps;
  /** Ordered effect labels (`resetSurface`, `installScene`, `running:false`, …). */
  calls: string[];
  /** Bridge events emitted in order (`MAP_LOADED`, `MAP_ENTERED:…`, `GAME_ERROR:…`). */
  emitted: string[];
  state: {
    running: boolean;
    inputLocked: boolean;
    installed: PreparedScene | null;
    resetCount: number;
    discontinuityCount: number;
    rendered: number;
  };
  /** Convenience: clear the call log between assertions. */
  resetCalls: () => void;
};

/**
 * Builds a harness around a real runner. Every collaborator is overridable
 * through `overrides`, so a test can inject a deferred prepare, a failing
 * post, or a superseded render.
 */
export const createSceneTransitionHarness = (
  overrides: Partial<SceneTransitionDeps> = {},
): SceneTransitionHarness => {
  const calls: string[] = [];
  const emitted: string[] = [];
  const state: SceneTransitionHarness['state'] = {
    running: true,
    inputLocked: false,
    installed: null,
    resetCount: 0,
    discontinuityCount: 0,
    rendered: 0,
  };

  const deps: SceneTransitionDeps = {
    prepare: async () => makePreparedScene(),
    async render(_scene, isCurrent) {
      state.rendered++;
      calls.push('render');
      return isCurrent();
    },
    async postLoadMap() {
      calls.push('postLoadMap');
    },
    resetSurface: () => {
      state.resetCount++;
      calls.push('resetSurface');
    },
    installScene: (scene) => {
      state.installed = scene;
      calls.push('installScene');
    },
    onDiscontinuity: () => {
      state.discontinuityCount++;
      calls.push('onDiscontinuity');
    },
    setRunning: (running) => {
      state.running = running;
      calls.push(`running:${running}`);
    },
    setInputLocked: (locked) => {
      state.inputLocked = locked;
      calls.push(`locked:${locked}`);
    },
    emitMapLoaded: () => {
      emitted.push('MAP_LOADED');
    },
    emitMapEntered: (mapUrl) => {
      emitted.push(`MAP_ENTERED:${mapUrl}`);
    },
    emitError: (message) => {
      emitted.push(`GAME_ERROR:${message}`);
    },
    log: { debug: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };

  return {
    runner: new SceneTransitionRunner(deps),
    deps,
    calls,
    emitted,
    state,
    resetCalls: () => {
      calls.length = 0;
    },
  };
};

/** Convenience load options for harness calls. */
export const makeLoadOptions = (overrides: Partial<LoadMapOptions> = {}): LoadMapOptions => ({
  mapUrl: 'maps:harness/room.json',
  targetX: 64,
  targetY: 64,
  ...overrides,
});
