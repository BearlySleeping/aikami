// scripts/src/lib/ops/emberwatch_house_assembly.test.ts
//
// C-550 — raised-house layout, collision, navigation, layer, and pixel-art
// regression tests. The tests use the pure authoring/build/pack functions so
// they exercise the authored source rather than a hand-maintained fixture.

import { describe, expect, test } from 'bun:test';
import { doorPlacement, G, HOUSE_FRAMES, placeHouse } from './emberwatch_authoring.ts';
import { type MapData, makeMap } from './emberwatch_map_shared.ts';
import { buildVillage } from './emberwatch_map_village.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';
import { buildMapJson } from './generate_emberwatch_maps.ts';

const at = (map: MapData, c: number, r: number): number => r * map.width + c;
const contribution = (
  entries: Array<[number, number, number]> | undefined,
  c: number,
  r: number,
): number | undefined => entries?.find(([entryC, entryR]) => entryC === c && entryR === r)?.[2];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value instanceof Object;

const readLayer = (json: unknown, name: string): number[] => {
  if (!isRecord(json) || !Array.isArray(json.layers)) {
    throw new Error('compiled map has no layers array');
  }
  const layer = json.layers.find((candidate) => isRecord(candidate) && candidate.name === name);
  if (!isRecord(layer) || !Array.isArray(layer.data)) {
    throw new Error(`compiled map has no numeric ${name} layer`);
  }
  if (!layer.data.every((value) => typeof value === 'number')) {
    throw new Error(`compiled map ${name} layer contains non-numeric data`);
  }
  return layer.data;
};

const readTerrain = (json: unknown): string[] => {
  if (!isRecord(json) || !isRecord(json.aikami) || !Array.isArray(json.aikami.terrain)) {
    throw new Error('compiled map has no terrain channel');
  }
  if (!json.aikami.terrain.every((value) => typeof value === 'string')) {
    throw new Error('compiled map terrain channel contains non-string data');
  }
  return json.aikami.terrain;
};

const makeHouseMap = (): MapData => makeMap(10, 12);

const placeTestHouse = (map: MapData): { c: number; r: number } =>
  placeHouse(map, {
    region: { c0: 2, r0: 2, c1: 7, r1: 6 },
    door: { c: 4 },
    facing: 's',
    mapId: 'house_test',
  });

const isStandable = (map: MapData, c: number, r: number): boolean => {
  if (c < 0 || c >= map.width || r < 1 || r >= map.height) {
    return false;
  }
  return map.collision[at(map, c, r)] === 0 && map.collision[at(map, c, r - 1)] === 0;
};

const CARDINAL_NEIGHBORS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const enqueueNeighbors = (options: {
  map: MapData;
  current: { c: number; r: number };
  queue: Array<{ c: number; r: number }>;
  seen: Set<number>;
}): void => {
  const { map, current, queue, seen } = options;
  for (const [dc, dr] of CARDINAL_NEIGHBORS) {
    const c = current.c + dc;
    const r = current.r + dr;
    const index = at(map, c, r);
    if (seen.has(index) || !isStandable(map, c, r)) {
      continue;
    }
    seen.add(index);
    queue.push({ c, r });
  }
};

const reachable = (
  map: MapData,
  start: { c: number; r: number },
  goal: { c: number; r: number },
): boolean => {
  if (!isStandable(map, start.c, start.r) || !isStandable(map, goal.c, goal.r)) {
    return false;
  }
  const queue = [start];
  const seen = new Set<number>([at(map, start.c, start.r)]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (!current) {
      continue;
    }
    if (current.c === goal.c && current.r === goal.r) {
      return true;
    }
    enqueueNeighbors({ map, current, queue, seen });
  }
  return false;
};

const allowedAssemblyCells = (map: MapData): Set<number> => {
  const cells = new Set<number>();
  for (let r = 2; r <= 6; r++) {
    for (let c = 2; c <= 7; c++) {
      cells.add(at(map, c, r));
    }
  }
  for (let r = 7; r <= 8; r++) {
    for (let c = 2; c <= 7; c++) {
      cells.add(at(map, c, r));
    }
  }
  return cells;
};

const expectAssemblyDelta = (options: {
  map: MapData;
  beforeGround: number[];
  beforeCollision: number[];
}): void => {
  const { map, beforeGround, beforeCollision } = options;
  const allowed = allowedAssemblyCells(map);
  for (let index = 0; index < map.ground.length; index++) {
    const groundChanged = map.ground[index] !== beforeGround[index];
    const collisionChanged = map.collision[index] !== beforeCollision[index];
    if (groundChanged || collisionChanged) {
      expect(allowed.has(index), `cell ${index} changed`).toBe(true);
    }
  }
};

describe('C-550 — placeHouse layout and collision', () => {
  test('authors the exact south-facing frame grid and returns the door anchor', () => {
    const map = makeHouseMap();
    const groundBefore = [...map.ground];
    const collisionBefore = [...map.collision];
    const door = placeTestHouse(map);

    expect(door).toEqual({ c: 4, r: 6 });
    expect(contribution(map.overheadExtra, 2, 2)).toBe(HOUSE_FRAMES.roofGableLeft);
    expect(contribution(map.overheadExtra, 3, 2)).toBe(HOUSE_FRAMES.roofBack);
    expect(contribution(map.overheadExtra, 7, 2)).toBe(HOUSE_FRAMES.roofGableRight);
    expect(contribution(map.overheadExtra, 2, 3)).toBe(HOUSE_FRAMES.roofEaveOverhead);
    expect(contribution(map.overheadExtra, 3, 3)).toBe(HOUSE_FRAMES.roofRidge);
    expect(contribution(map.overheadExtra, 6, 3)).toBe(HOUSE_FRAMES.roofRidge);

    expect(contribution(map.groundExtra, 2, 4)).toBe(HOUSE_FRAMES.roofEaveEdge);
    expect(contribution(map.groundExtra, 3, 4)).toBe(HOUSE_FRAMES.roofFront);
    expect(contribution(map.groundExtra, 7, 4)).toBe(HOUSE_FRAMES.roofEaveEdge);
    for (let c = 2; c <= 7; c++) {
      expect(contribution(map.groundExtra, c, 5), `foundation (${c},5)`).toBe(
        HOUSE_FRAMES.foundation,
      );
    }
    expect(contribution(map.groundExtra, 2, 6)).toBe(HOUSE_FRAMES.facadeCornerLeft);
    expect(contribution(map.groundExtra, 3, 6)).toBe(HOUSE_FRAMES.facadeWall);
    expect(contribution(map.groundExtra, 4, 6)).toBe(HOUSE_FRAMES.doorOpen);
    expect(contribution(map.groundExtra, 5, 6)).toBe(HOUSE_FRAMES.doorOpen);
    expect(contribution(map.groundExtra, 6, 6)).toBe(HOUSE_FRAMES.facadeWindow);
    expect(contribution(map.groundExtra, 7, 6)).toBe(HOUSE_FRAMES.facadeCornerRight);

    for (let c = 2; c <= 7; c++) {
      if (c === 4 || c === 5) {
        continue;
      }
      expect(contribution(map.decorExtra, c, 7), `contact shadow (${c},7)`).toBe(
        HOUSE_FRAMES.foundationShadow,
      );
    }
    expect(contribution(map.groundExtra, 4, 7)).toBeUndefined();
    expect(contribution(map.groundExtra, 5, 7)).toBeUndefined();

    expect(map.ground[at(map, 2, 2)]).toBe(groundBefore[at(map, 2, 2)]);
    expect(map.collision[at(map, 2, 2)]).toBe(collisionBefore[at(map, 2, 2)]);
    expect(map.ground[at(map, 4, 4)]).toBe(HOUSE_FRAMES.roofFront);
    expect(map.collision[at(map, 4, 4)]).toBe(1);
    expect(map.collision[at(map, 4, 5)]).toBe(1);
    expect(map.collision[at(map, 4, 6)]).toBe(0);
    expect(map.collision[at(map, 4, 7)]).toBe(0);
    expect(map.collision[at(map, 4, 8)]).toBe(0);
  });

  test('doorPlacement keeps the legacy two-cell threshold and two-row landing', () => {
    expect(doorPlacement({ c0: 2, r0: 2, w: 6, h: 5, doorSide: 'south' })).toEqual({
      doorCells: [
        [4, 6],
        [5, 6],
      ],
      landingCells: [
        [4, 7],
        [4, 8],
        [5, 7],
        [5, 8],
      ],
    });
  });

  test('collision leaves the upper roof walk-behind and the front threshold solid', () => {
    const map = makeHouseMap();
    placeTestHouse(map);

    expect(isStandable(map, 4, 3)).toBe(true);
    expect(isStandable(map, 4, 2)).toBe(true);
    expect(isStandable(map, 4, 4)).toBe(false);
    expect(isStandable(map, 4, 5)).toBe(false);
    expect(isStandable(map, 4, 6)).toBe(false);
    expect(isStandable(map, 4, 7)).toBe(true);
    expect(isStandable(map, 4, 8)).toBe(true);

    expect(reachable(map, { c: 4, r: 8 }, { c: 4, r: 7 })).toBe(true);
    expect(reachable(map, { c: 4, r: 1 }, { c: 4, r: 3 })).toBe(true);
    expect(reachable(map, { c: 4, r: 1 }, { c: 4, r: 4 })).toBe(false);
  });

  test('only the hut footprint and its authored approach change', () => {
    const map = makeHouseMap();
    const beforeGround = [...map.ground];
    const beforeCollision = [...map.collision];
    placeTestHouse(map);
    expectAssemblyDelta({ map, beforeGround, beforeCollision });
  });
});

describe('C-550 — assertions and stable identities', () => {
  test('invalid input throws before mutating the map', () => {
    const cases = [
      {
        name: 'out of bounds',
        options: {
          region: { c0: -1, r0: 2, c1: 4, r1: 6 },
          door: { c: 1 },
          facing: 's' as const,
          mapId: 'bad_bounds',
        },
        pattern: /outside the 10×12 map/,
      },
      {
        name: 'facing',
        options: {
          region: { c0: 2, r0: 2, c1: 7, r1: 6 },
          door: { c: 4 },
          facing: 'n' as const,
          mapId: 'bad_facing',
        },
        pattern: /supports south-facing houses/,
      },
      {
        name: 'door column',
        options: {
          region: { c0: 2, r0: 2, c1: 7, r1: 6 },
          door: { c: 3 },
          facing: 's' as const,
          mapId: 'bad_door',
        },
        pattern: /not on the derived two-cell south facade/,
      },
    ] as const;
    for (const testCase of cases) {
      const map = makeHouseMap();
      const ground = [...map.ground];
      const collision = [...map.collision];
      expect(() => placeHouse(map, testCase.options), testCase.name).toThrow(testCase.pattern);
      expect(map.ground).toEqual(ground);
      expect(map.collision).toEqual(collision);
      expect(map.groundExtra).toBeUndefined();
      expect(map.decorExtra).toBeUndefined();
      expect(map.overheadExtra).toBeUndefined();
    }
  });

  test('blocked approach and contact-shadow cells fail atomically', () => {
    const blockedApproach = makeHouseMap();
    blockedApproach.collision[at(blockedApproach, 4, 7)] = 1;
    const approachGround = [...blockedApproach.ground];
    const approachCollision = [...blockedApproach.collision];
    expect(() => placeTestHouse(blockedApproach)).toThrow(/approach cell\(s\).*\(4,7\)/);
    expect(blockedApproach.ground).toEqual(approachGround);
    expect(blockedApproach.collision).toEqual(approachCollision);

    const blockedShadow = makeHouseMap();
    blockedShadow.collision[at(blockedShadow, 2, 7)] = 1;
    const shadowGround = [...blockedShadow.ground];
    const shadowCollision = [...blockedShadow.collision];
    expect(() => placeTestHouse(blockedShadow)).toThrow(/contact-shadow cell\(s\).*\(2,7\)/);
    expect(blockedShadow.ground).toEqual(shadowGround);
    expect(blockedShadow.collision).toEqual(shadowCollision);
  });

  test('solid terrain overrides reject walk-behind and approach cells before mutation', () => {
    const cases = [
      { cell: [3, 2] as const, pattern: /walk-behind\/threshold cell\(s\).*\(3,2\)/ },
      { cell: [4, 7] as const, pattern: /approach cell\(s\).*\(4,7\)/ },
    ] as const;
    for (const testCase of cases) {
      const map = makeHouseMap();
      map.terrainOverrides = [[testCase.cell[0], testCase.cell[1], 'water']];
      const ground = [...map.ground];
      const collision = [...map.collision];
      expect(() => placeTestHouse(map)).toThrow(testCase.pattern);
      expect(map.ground).toEqual(ground);
      expect(map.collision).toEqual(collision);
      expect(map.groundExtra).toBeUndefined();
      expect(map.overheadExtra).toBeUndefined();
    }
  });

  test('the village keeps its existing transition graph and other building shells', () => {
    const { map, objectLayers } = buildVillage();
    const transitions = objectLayers
      .flatMap((layer) => layer.objects)
      .filter((object) => object.type === 'transition')
      .map((object) => object.id);
    expect(transitions).toEqual([1005, 1006, 1007]);
    expect(
      objectLayers
        .flatMap((layer) => layer.objects)
        .filter((object) => object.type === 'transition')
        .some((object) => object.properties.some((property) => property.value === 'hut')),
    ).toBe(false);
    expect(map.ground[at(map, 18, 13)]).toBe(G.WOOD_WALL);
    expect(map.collision[at(map, 18, 13)]).toBe(1);
    expect(contribution(map.groundExtra, 51, 7)).toBe(HOUSE_FRAMES.roofEaveEdge);
    expect(contribution(map.overheadExtra, 51, 5)).toBe(HOUSE_FRAMES.roofGableLeft);
    expect(contribution(map.decorExtra, 51, 10)).toBe(HOUSE_FRAMES.foundationShadow);
  });
});

describe('C-550 — compiled map layers', () => {
  test('facade/foundation use ground, contact shadow uses decor, and upper roof uses overhead', () => {
    const map = makeHouseMap();
    placeTestHouse(map);
    const json = buildMapJson({ map, objectLayers: [] }).json;
    const ground = readLayer(json, 'ground');
    const decor = readLayer(json, 'decor');
    const overhead = readLayer(json, 'overhead');
    const collision = readLayer(json, 'collision');
    const terrain = readTerrain(json);

    expect(ground[at(map, 3, 6)]).toBe(HOUSE_FRAMES.facadeWall);
    expect(decor[at(map, 3, 6)]).toBe(0);
    expect(overhead[at(map, 3, 6)]).toBe(0);
    expect(collision[at(map, 3, 6)]).toBe(1);
    expect(terrain[at(map, 3, 6)]).toBe('');

    expect(ground[at(map, 2, 5)]).toBe(HOUSE_FRAMES.foundation);
    expect(overhead[at(map, 2, 5)]).toBe(0);
    expect(ground[at(map, 3, 2)]).toBe(G.GRASS);
    expect(decor[at(map, 3, 2)]).toBe(0);
    expect(overhead[at(map, 3, 2)]).toBe(HOUSE_FRAMES.roofBack);
    expect(terrain[at(map, 3, 2)]).toBe('grass');

    expect(ground[at(map, 2, 7)]).toBe(G.GRASS);
    expect(decor[at(map, 2, 7)]).toBe(HOUSE_FRAMES.foundationShadow);
    expect(overhead[at(map, 2, 7)]).toBe(0);
    expect(collision[at(map, 2, 7)]).toBe(0);
  });
});

describe('C-550 — house atlas frames', () => {
  const atlas = packAtlas();
  const pixel = (key: string, x: number, y: number): [number, number, number, number] => {
    const frame = atlas.frames[key]?.frame;
    if (!frame) {
      throw new Error(`missing atlas frame ${key}`);
    }
    const index = ((frame.y + y) * atlas.width + frame.x + x) * 4;
    return [
      atlas.rgba[index] ?? 0,
      atlas.rgba[index + 1] ?? 0,
      atlas.rgba[index + 2] ?? 0,
      atlas.rgba[index + 3] ?? 0,
    ];
  };

  test('house GIDs append after the bridge family without renumbering', () => {
    expect(Object.values(HOUSE_FRAMES).sort((a, b) => a - b)).toEqual([
      146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160,
    ]);
    expect(atlas.frames['house_roof_front.png']?.frame).toEqual({ x: 35, y: 307, w: 32, h: 32 });
    expect(atlas.frames['house_foundation_shadow.png']?.frame).toEqual({
      x: 511,
      y: 307,
      w: 32,
      h: 32,
    });
  });

  test('all house frames are opaque and contain their distinguishing pixels', () => {
    const keys = [
      'house_roof_front.png',
      'house_roof_back.png',
      'house_roof_ridge.png',
      'house_roof_gable_left.png',
      'house_roof_gable_right.png',
      'house_roof_eave_overhead.png',
      'house_roof_eave_edge.png',
      'house_facade_wall.png',
      'house_facade_window.png',
      'house_facade_corner_left.png',
      'house_facade_corner_right.png',
      'house_door_closed.png',
      'house_door_open.png',
      'house_foundation.png',
      'house_foundation_shadow.png',
    ];
    for (const key of keys) {
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          expect(pixel(key, x, y)[3], `${key} (${x},${y})`).toBe(255);
        }
      }
    }
    expect(pixel('house_door_open.png', 16, 16)).not.toEqual(
      pixel('house_door_closed.png', 16, 16),
    );
    expect(pixel('house_facade_window.png', 16, 16)).not.toEqual(
      pixel('house_facade_wall.png', 16, 16),
    );
    expect(pixel('house_roof_ridge.png', 16, 16)).not.toEqual(pixel('house_roof_back.png', 16, 16));
    expect(pixel('house_foundation_shadow.png', 16, 24)).toEqual([48, 47, 45, 255]);
  });
});
