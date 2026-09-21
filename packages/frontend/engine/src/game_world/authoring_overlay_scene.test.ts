// packages/frontend/engine/src/game_world/authoring_overlay_scene.test.ts
//
// The overlay's blocked/reachable model must match the prepared scene's actual
// gameplay walkability: terrain, the explicit collision grid, and solid placed
// props all block; walkable props do not; reachability follows. No PNG alpha is
// ever consulted.

import { describe, expect, test } from 'bun:test';
import type { PackConfig } from '@aikami/types';
import type { TilemapData } from '../assets/map_loader.ts';
import { buildAuthoringOverlayInput } from './authoring_overlay_scene.ts';
import { prepareScene } from './scene_transition.ts';
import { makeMinimalTilemap, makeStaticLoader } from './testing/scene_transition_harness.ts';

type ObjectSpec = {
  id: number;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  type: string;
  properties: Record<string, unknown>;
};

const sceneFor = async (options: {
  width: number;
  collision?: number[];
  objects: ObjectSpec[];
  packConfig?: PackConfig;
}) => {
  const width = options.width;
  const height = 1;
  const cells = width * height;
  const tilemap: TilemapData = makeMinimalTilemap({
    width,
    height,
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
        data: options.collision ?? new Array<number>(cells).fill(0),
        visible: false,
      },
    ],
    terrain: undefined,
    objectLayers: [{ name: 'entities', objects: options.objects }],
  });
  return prepareScene({
    mapUrl: 'maps:emberwatch/overlay-test.json',
    packConfig: options.packConfig,
    loadMap: makeStaticLoader(tilemap),
  });
};

const spawn = (id: number, name: string, c: number): ObjectSpec => ({
  id,
  name,
  x: c * 32,
  y: 0,
  type: 'spawn',
  properties: { spawnId: name },
});

const prop = (id: number, name: string, propId: string, frame: string, c: number): ObjectSpec => ({
  id,
  name,
  x: c * 32,
  y: 0,
  type: 'prop',
  properties: { propId, frame },
});

describe('buildAuthoringOverlayInput', () => {
  test('terrain cost 0 blocks a route before reachability', async () => {
    const scene = await sceneFor({
      width: 3,
      objects: [spawn(1, 'start', 0)],
    });
    scene.terrainGrid.cost.set([16, 0, 16]);

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 1, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 0, 0]);
  });

  test('the explicit collision grid blocks independently of the terrain cost', async () => {
    // Collision says cell 2 is solid while the terrain cost was (artificially)
    // left walkable: the overlay must still treat the collision cell as blocked.
    const scene = await sceneFor({
      width: 5,
      collision: [0, 0, 1, 0, 0],
      objects: [spawn(1, 'start', 0)],
    });
    scene.terrainGrid.cost.fill(16);

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 0, 1, 0, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 1, 0, 0, 0]);
  });

  test('a solid placed prop blocks and changes reachability', async () => {
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      props: { crate: { name: 'Crate', frame: 'crate.png', isWalkable: false } },
    };
    const scene = await sceneFor({
      width: 4,
      objects: [spawn(1, 'start', 0), prop(2, 'crate', 'crate', 'crate.png', 2)],
      packConfig,
    });

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 0, 1, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 1, 0, 0]);
  });

  test('a walkable placed prop does not block and preserves reachability', async () => {
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      props: { gate: { name: 'Gate', frame: 'gate.png', isWalkable: true } },
    };
    const scene = await sceneFor({
      width: 4,
      objects: [spawn(1, 'start', 0), prop(2, 'gate', 'gate', 'gate.png', 2)],
      packConfig,
    });

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 1, 1, 1]);
  });

  test('a missing isWalkable definition blocks conservatively', async () => {
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      // No `isWalkable` — the runtime spawner defaults props to solid.
      props: { rock: { name: 'Rock', frame: 'rock.png' } },
    };
    const scene = await sceneFor({
      width: 3,
      objects: [spawn(1, 'start', 0), prop(2, 'rock', 'rock', 'rock.png', 1)],
      packConfig,
    });

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 1, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 0, 0]);
  });

  test('an out-of-bounds prop origin cannot corrupt the grid', async () => {
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      props: { crate: { name: 'Crate', frame: 'crate.png', isWalkable: false } },
    };
    const scene = await sceneFor({
      width: 3,
      objects: [spawn(1, 'start', 0), prop(2, 'crate', 'crate', 'crate.png', 99)],
      packConfig,
    });

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 0, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 1, 1]);
  });

  test('props, spawns and transitions are surfaced with authored metadata', async () => {
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      props: {
        crate: {
          name: 'Crate',
          frame: 'crate.png',
          isWalkable: false,
          renderSize: { width: 64, height: 80 },
          collision: { type: 'rect', width: 22, height: 14 },
        },
      },
    };
    const scene = await sceneFor({
      width: 4,
      objects: [
        spawn(1, 'start', 0),
        prop(2, 'crate', 'crate', 'crate.png', 1),
        {
          id: 3,
          name: 'to_hall',
          x: 96,
          y: 0,
          width: 32,
          height: 32,
          type: 'transition',
          properties: {
            targetMap: 'maps:emberwatch/hall.json',
            targetSpawnId: 'hall_door',
            targetX: 64,
            targetY: 64,
          },
        },
      ],
      packConfig,
    });

    const input = buildAuthoringOverlayInput(scene);
    const crate = input.props.find((entry) => entry.propId === 'crate');

    expect(crate?.renderWidth).toBe(64);
    expect(crate?.renderHeight).toBe(80);
    expect(crate?.collisionWidth).toBe(22);
    expect(input.spawns.map((entry) => entry.spawnId)).toContain('start');
    expect(input.transitions[0]?.targetSpawnId).toBe('hall_door');
  });
});
