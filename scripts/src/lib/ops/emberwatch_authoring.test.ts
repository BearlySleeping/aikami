// scripts/src/lib/ops/emberwatch_authoring.test.ts
//
// Semantic authoring primitives: they must speak in cells and compile into the
// same deterministic runtime structures the builders always produced.

import { describe, expect, test } from 'bun:test';
import {
  CELL_SIZE,
  cell,
  collisionRegion,
  decor,
  G,
  path,
  placeLandmark,
  placeNpc,
  placeProp,
  placeSpawn,
  placeTransition,
  terrainRegion,
  waterRegion,
} from './emberwatch_authoring.ts';
import { buildInn, buildShop, buildVillage } from './emberwatch_map_retained.ts';
import { makeMap } from './emberwatch_map_shared.ts';
import { buildOldRoad, buildRuinedShrine } from './generate_emberwatch_maps_extra.ts';

const at = (width: number, col: number, row: number): number => row * width + col;

describe('emberwatch_authoring primitives', () => {
  test('cell helpers convert to world pixels', () => {
    expect(CELL_SIZE).toBe(32);
    expect(cell(5)).toBe(160);
  });

  test('terrain, water, decor and collision regions author ground + solidity', () => {
    const map = makeMap(6, 4);
    terrainRegion(map, { c0: 1, r0: 1, c1: 2, r1: 2 }, G.STONE_FLOOR);
    expect(map.ground[at(6, 1, 1)]).toBe(G.STONE_FLOOR);
    expect(map.ground[at(6, 2, 2)]).toBe(G.STONE_FLOOR);

    waterRegion(map, { c0: 4, r0: 0, c1: 4, r1: 0 });
    expect(map.ground[at(6, 4, 0)]).toBe(G.WATER);
    expect(map.collision[at(6, 4, 0)]).toBe(1);

    decor(map, 0, 3, G.RUG);
    expect(map.ground[at(6, 0, 3)]).toBe(G.RUG);

    collisionRegion(map, { c0: 0, r0: 0, c1: 1, r1: 0 });
    expect(map.collision[at(6, 0, 0)]).toBe(1);
    collisionRegion(map, { c0: 4, r0: 0, c1: 4, r1: 0 }, false);
    expect(map.collision[at(6, 4, 0)]).toBe(0);
  });

  test('path paints an axis-aligned corridor of the requested width', () => {
    const map = makeMap(8, 6);
    path({ map, from: { c: 2, r: 0 }, to: { c: 2, r: 5 }, gid: G.PATH, width: 3 });
    expect(map.ground[at(8, 1, 3)]).toBe(G.PATH);
    expect(map.ground[at(8, 2, 3)]).toBe(G.PATH);
    expect(map.ground[at(8, 3, 3)]).toBe(G.PATH);
    expect(map.ground[at(8, 0, 3)]).toBe(G.GRASS);
    expect(map.ground[at(8, 4, 3)]).toBe(G.GRASS);

    expect(() => path({ map, from: { c: 0, r: 0 }, to: { c: 2, r: 2 }, gid: G.PATH })).toThrow();
  });

  test('placement primitives convert cells to pixels and preserve identities', () => {
    const prop = placeProp(7, 'p', 'Prop', 'p.png', 3, 4);
    expect(prop.x).toBe(cell(3));
    expect(prop.y).toBe(cell(4));
    expect(prop.type).toBe('prop');
    expect(prop.properties.find((entry) => entry.name === 'propId')?.value).toBe('p');

    const landmark = placeLandmark(8, 'l', 'Landmark', 'l.png', 1, 1);
    expect(landmark.type).toBe('prop');
    expect(landmark.x).toBe(32);

    const npc = placeNpc(9, 'n', 'Npc', 'key', 2, 2);
    expect(npc.type).toBe('npc');
    expect(npc.properties.find((entry) => entry.name === 'dialogueKey')?.value).toBe('key');

    const spawn = placeSpawn(10, 's', 5, 6);
    expect(spawn.type).toBe('spawn');
    expect(spawn.y).toBe(cell(6));

    const transition = placeTransition({
      id: 11,
      targetMap: 'inn',
      targetSpawnId: 'inn_entrance',
      target: { x: cell(14), y: cell(17) },
      at: { c: 13, r: 19, width: 2, height: 1 },
    });
    expect(transition.x).toBe(cell(13));
    expect(transition.width).toBe(64);
    expect(transition.height).toBe(32);
    expect(transition.properties.find((entry) => entry.name === 'targetMap')?.value).toBe('inn');
  });
});

describe('emberwatch map generation determinism', () => {
  test('building every map twice yields byte-identical structures', () => {
    const builds = [buildVillage, buildInn, buildShop, buildOldRoad, buildRuinedShrine];
    for (const build of builds) {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    }
  });
});
