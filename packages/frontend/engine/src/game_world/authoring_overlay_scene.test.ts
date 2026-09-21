// packages/frontend/engine/src/game_world/authoring_overlay_scene.test.ts

import { describe, expect, test } from 'bun:test';
import type { PackConfig } from '@aikami/types';
import { buildAuthoringOverlayInput } from './authoring_overlay_scene.ts';
import { prepareScene } from './scene_transition.ts';
import { makeMinimalTilemap, makeStaticLoader } from './testing/scene_transition_harness.ts';

describe('buildAuthoringOverlayInput', () => {
  test('derives blocked cells from terrain cost and solid prop origins before reachability', async () => {
    const width = 4;
    const tilemap = makeMinimalTilemap({
      width,
      height: 1,
      layers: [
        {
          name: 'ground',
          width,
          height: 1,
          data: [1, 1, 1, 1],
          visible: true,
          band: 'ground',
        },
        {
          name: 'collision',
          width,
          height: 1,
          data: [0, 0, 0, 0],
          visible: false,
        },
      ],
      terrain: undefined,
      objectLayers: [
        {
          name: 'entities',
          objects: [
            {
              id: 1,
              name: 'start',
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              type: 'spawn',
              properties: { spawnId: 'start' },
            },
            {
              id: 2,
              name: 'crate',
              x: 64,
              y: 0,
              width: 0,
              height: 0,
              type: 'prop',
              properties: { propId: 'crate', frame: 'crate.png' },
            },
            {
              id: 3,
              name: 'gate',
              x: 96,
              y: 0,
              width: 0,
              height: 0,
              type: 'prop',
              properties: { propId: 'gate', frame: 'gate.png' },
            },
            {
              id: 4,
              name: 'outside',
              x: 160,
              y: 0,
              width: 0,
              height: 0,
              type: 'prop',
              properties: { propId: 'outside', frame: 'outside.png' },
            },
          ],
        },
      ],
    });
    const packConfig: PackConfig = {
      tiles: { '1': { name: 'grass', frame: 'grass.png', isWalkable: true } },
      props: {
        crate: { name: 'Crate', frame: 'crate.png', isWalkable: false },
        gate: { name: 'Gate', frame: 'gate.png', isWalkable: true },
        outside: { name: 'Outside', frame: 'outside.png' },
      },
    };
    const scene = await prepareScene({
      mapUrl: 'maps:emberwatch/overlay.json',
      packConfig,
      loadMap: makeStaticLoader(tilemap),
    });
    scene.terrainGrid.cost.set([16, 0, 16, 16]);

    const input = buildAuthoringOverlayInput(scene);

    expect(Array.from(input.blocked ?? [])).toEqual([0, 1, 1, 0]);
    expect(Array.from(input.reachable ?? [])).toEqual([1, 0, 0, 0]);
  });
});
