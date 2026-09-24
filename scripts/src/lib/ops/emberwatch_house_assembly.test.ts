// scripts/src/lib/ops/emberwatch_house_assembly.test.ts
//
// C-550 — raised-house layout, collision, navigation, layer, and pixel-art
// regression tests. The tests use the pure authoring/build/pack functions so
// they exercise the authored source rather than a hand-maintained fixture.

import { describe, expect, test } from 'bun:test';
import {
  doorPlacement,
  G,
  HOUSE_FRAMES,
  houseDoorPlacement,
  placeHouse,
} from './emberwatch_authoring.ts';
import { type MapData, makeMap } from './emberwatch_map_shared.ts';
import { buildVillage } from './emberwatch_map_village.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';
import {
  HOUSE_PLINTH_HEIGHT,
  HOUSE_SHADOW_FADE_HEIGHT,
} from './generate_emberwatch_house_frames.ts';
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
    door: { c: 5 },
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
  test('authors three roof rows, two facade rows, and one closed door', () => {
    const map = makeHouseMap();
    const groundBefore = [...map.ground];
    const collisionBefore = [...map.collision];
    const door = placeTestHouse(map);

    expect(door).toEqual({ c: 5, r: 6 });
    expect(contribution(map.overheadExtra, 2, 2)).toBe(HOUSE_FRAMES.roofGableLeft);
    expect(contribution(map.overheadExtra, 3, 2)).toBe(HOUSE_FRAMES.roofBack);
    expect(contribution(map.overheadExtra, 7, 2)).toBe(HOUSE_FRAMES.roofGableRight);
    expect(contribution(map.overheadExtra, 2, 3)).toBe(HOUSE_FRAMES.roofEaveOverhead);
    expect(contribution(map.overheadExtra, 3, 3)).toBe(HOUSE_FRAMES.roofRidge);
    expect(contribution(map.overheadExtra, 6, 3)).toBe(HOUSE_FRAMES.roofRidge);

    expect(contribution(map.groundExtra, 2, 4)).toBe(HOUSE_FRAMES.roofEaveEdge);
    expect(contribution(map.groundExtra, 3, 4)).toBe(HOUSE_FRAMES.roofFront);
    expect(contribution(map.groundExtra, 7, 4)).toBe(HOUSE_FRAMES.roofEaveEdge);
    expect(contribution(map.groundExtra, 2, 5)).toBe(HOUSE_FRAMES.facadeCornerLeft);
    expect(contribution(map.groundExtra, 3, 5)).toBe(HOUSE_FRAMES.facadeWall);
    expect(contribution(map.groundExtra, 7, 5)).toBe(HOUSE_FRAMES.facadeCornerRight);
    expect(contribution(map.groundExtra, 2, 6)).toBe(HOUSE_FRAMES.foundation);
    expect(contribution(map.groundExtra, 3, 6)).toBe(HOUSE_FRAMES.foundation);
    expect(contribution(map.groundExtra, 4, 6)).toBe(HOUSE_FRAMES.facadeWindow);
    expect(contribution(map.groundExtra, 5, 6)).toBe(HOUSE_FRAMES.doorClosed);
    expect(contribution(map.groundExtra, 6, 6)).toBe(HOUSE_FRAMES.foundation);
    expect(contribution(map.groundExtra, 7, 6)).toBe(HOUSE_FRAMES.foundation);
    const doorFrames = (map.groundExtra ?? []).filter(
      ([, , gid]) => gid === HOUSE_FRAMES.doorClosed || gid === HOUSE_FRAMES.doorOpen,
    );
    expect(doorFrames).toEqual([[5, 6, HOUSE_FRAMES.doorClosed]]);

    for (let c = 2; c <= 7; c++) {
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
    expect(map.collision[at(map, 5, 6)]).toBe(1);
    expect(map.collision[at(map, 4, 7)]).toBe(0);
    expect(map.collision[at(map, 4, 8)]).toBe(0);
  });

  test('legacy shells keep two-cell doors while the hut gets one closed door', () => {
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
    expect(houseDoorPlacement({ c0: 2, r0: 2, w: 6, h: 5, doorSide: 'south' })).toEqual({
      doorCells: [[5, 6]],
      landingCells: [
        [5, 7],
        [5, 8],
      ],
    });
  });

  test('collision leaves the upper roof walk-behind and the front threshold solid', () => {
    const map = makeHouseMap();
    placeTestHouse(map);

    expect(isStandable(map, 5, 3)).toBe(true);
    expect(isStandable(map, 5, 2)).toBe(true);
    expect(isStandable(map, 5, 4)).toBe(false);
    expect(isStandable(map, 5, 5)).toBe(false);
    expect(isStandable(map, 5, 6)).toBe(false);
    expect(isStandable(map, 5, 7)).toBe(false);
    expect(isStandable(map, 5, 8)).toBe(true);

    expect(reachable(map, { c: 5, r: 8 }, { c: 4, r: 8 })).toBe(true);
    expect(reachable(map, { c: 5, r: 1 }, { c: 5, r: 3 })).toBe(true);
    expect(reachable(map, { c: 5, r: 1 }, { c: 5, r: 4 })).toBe(false);
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
          door: { c: 5 },
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
        pattern: /not on the derived single south door/,
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

  test('blocked walk-behind, approach, and contact-shadow cells fail atomically', () => {
    const blockedRoof = makeHouseMap();
    blockedRoof.collision[at(blockedRoof, 5, 3)] = 1;
    const roofGround = [...blockedRoof.ground];
    const roofCollision = [...blockedRoof.collision];
    expect(() => placeTestHouse(blockedRoof)).toThrow(/walk-behind cell\(s\).*\(5,3\)/);
    expect(blockedRoof.ground).toEqual(roofGround);
    expect(blockedRoof.collision).toEqual(roofCollision);

    const blockedApproach = makeHouseMap();
    blockedApproach.collision[at(blockedApproach, 5, 7)] = 1;
    const approachGround = [...blockedApproach.ground];
    const approachCollision = [...blockedApproach.collision];
    expect(() => placeTestHouse(blockedApproach)).toThrow(/approach cell\(s\).*\(5,7\)/);
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
      { cell: [3, 2] as const, pattern: /walk-behind cell\(s\).*\(3,2\)/ },
      { cell: [5, 7] as const, pattern: /approach cell\(s\).*\(5,7\)/ },
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

  test('terrain overrides cannot erase explicit facade ground art', () => {
    const map = makeHouseMap();
    map.terrainOverrides = [[3, 6, 'dirt']];
    const ground = [...map.ground];
    const collision = [...map.collision];
    expect(() => placeTestHouse(map)).toThrow(/terrain override cell\(s\).*\(3,6\).*ground art/);
    expect(map.ground).toEqual(ground);
    expect(map.collision).toEqual(collision);
    expect(map.groundExtra).toBeUndefined();
    expect(map.overheadExtra).toBeUndefined();
  });

  test('terrain overrides cannot replace the closed door leaf', () => {
    const map = makeHouseMap();
    map.terrainOverrides = [[5, 6, 'dirt']];
    const ground = [...map.ground];
    const collision = [...map.collision];
    expect(() => placeTestHouse(map)).toThrow(/terrain override cell\(s\).*\(5,6\).*ground art/);
    expect(map.ground).toEqual(ground);
    expect(map.collision).toEqual(collision);
    expect(map.groundExtra).toBeUndefined();
    expect(map.overheadExtra).toBeUndefined();
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

  test('the real village keeps the hut approach and upper roof reachable from the gate', () => {
    const { map } = buildVillage();
    const gate = { c: 32, r: 44 };
    expect(reachable(map, gate, { c: 54, r: 11 })).toBe(true);
    expect(reachable(map, gate, { c: 54, r: 6 })).toBe(true);
  });

  test('pins the exact 14-cell collision delta from merged C-549', () => {
    const { map } = buildVillage();
    const roofCells = [5, 6].flatMap((r) =>
      [51, 52, 53, 54, 55, 56].map((c) => ({ c, r, before: 1, after: 0 })),
    );
    const formerDoorCells = [
      { c: 53, r: 9, before: 0, after: 1 },
      { c: 54, r: 9, before: 0, after: 1 },
    ];
    const expectedDelta = [...roofCells, ...formerDoorCells];
    const mergedC549Collision = [...map.collision];
    for (const cell of expectedDelta) {
      mergedC549Collision[at(map, cell.c, cell.r)] = cell.before;
    }

    const changed = map.collision.flatMap((value, index) =>
      value === mergedC549Collision[index]
        ? []
        : [{ index, before: mergedC549Collision[index], after: value }],
    );
    expect(changed).toEqual(
      expectedDelta.map((cell) => ({
        index: at(map, cell.c, cell.r),
        before: cell.before,
        after: cell.after,
      })),
    );
  });
});

describe('C-550 — compiled map layers', () => {
  test('rejects terrain overrides on blocked non-terrain ground contributions', () => {
    const map = makeHouseMap();
    map.groundExtra = [[3, 6, HOUSE_FRAMES.facadeWall]];
    map.collision[at(map, 3, 6)] = 1;
    map.terrainOverrides = [[3, 6, 'dirt']];
    expect(() => buildMapJson({ map, objectLayers: [] })).toThrow(
      /cell \(3,6\) has both a blocked non-terrain ground contribution and terrain override "dirt"/,
    );
  });

  test('allows terrain overrides on walkable or terrain-owned ground cells', () => {
    const walkableMap = makeHouseMap();
    walkableMap.groundExtra = [[3, 6, HOUSE_FRAMES.doorClosed]];
    walkableMap.terrainOverrides = [[3, 6, 'dirt']];
    const walkableJson = buildMapJson({ map: walkableMap, objectLayers: [] }).json;
    expect(readTerrain(walkableJson)[at(walkableMap, 3, 6)]).toBe('dirt');

    const terrainOwnedMap = makeHouseMap();
    terrainOwnedMap.groundExtra = [[3, 6, G.DIRT]];
    terrainOwnedMap.collision[at(terrainOwnedMap, 3, 6)] = 1;
    terrainOwnedMap.terrainOverrides = [[3, 6, 'gravel']];
    const terrainOwnedJson = buildMapJson({ map: terrainOwnedMap, objectLayers: [] }).json;
    expect(readTerrain(terrainOwnedJson)[at(terrainOwnedMap, 3, 6)]).toBe('gravel');
  });

  test('facade/foundation use ground, contact shadow uses decor, and upper roof uses overhead', () => {
    const map = makeHouseMap();
    placeTestHouse(map);
    const json = buildMapJson({ map, objectLayers: [] }).json;
    const ground = readLayer(json, 'ground');
    const decor = readLayer(json, 'decor');
    const overhead = readLayer(json, 'overhead');
    const collision = readLayer(json, 'collision');
    const terrain = readTerrain(json);

    expect(ground[at(map, 3, 6)]).toBe(HOUSE_FRAMES.foundation);
    expect(decor[at(map, 3, 6)]).toBe(0);
    expect(overhead[at(map, 3, 6)]).toBe(0);
    expect(collision[at(map, 3, 6)]).toBe(1);
    expect(terrain[at(map, 3, 6)]).toBe('');

    expect(ground[at(map, 2, 5)]).toBe(HOUSE_FRAMES.facadeCornerLeft);
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

  type PixelReader = (key: string, x: number, y: number) => [number, number, number, number];
  const readShadowAlpha = (readPixel: PixelReader): number[][] => {
    const shadowAlpha: number[][] = [];
    for (let shadowY = 0; shadowY < 32; shadowY++) {
      const row: number[] = [];
      for (let shadowX = 0; shadowX < 32; shadowX++) {
        row.push(readPixel('house_foundation_shadow.png', shadowX, shadowY)[3]);
      }
      shadowAlpha.push(row);
    }
    return shadowAlpha;
  };
  const assertShadowFalloff = (shadowAlpha: number[][]): void => {
    for (let x = 0; x < 32; x++) {
      for (let y = 1; y < 32; y++) {
        expect(shadowAlpha[y]?.[x], `shadow vertical falloff (${x},${y})`).toBeLessThanOrEqual(
          shadowAlpha[y - 1]?.[x] ?? 0,
        );
      }
    }
    for (let y = 0; y < 32; y++) {
      for (let x = 1; x < 32; x++) {
        expect(
          Math.abs((shadowAlpha[y]?.[x] ?? 0) - (shadowAlpha[y]?.[x - 1] ?? 0)),
          `shadow horizontal seam (${x},${y})`,
        ).toBeLessThanOrEqual(1);
      }
    }
  };
  const assertContactShadow = (readPixel: PixelReader): void => {
    const shadowAlpha = readShadowAlpha(readPixel);
    assertShadowFalloff(shadowAlpha);
    expect(shadowAlpha[0]?.[0]).toBe(92);
    expect(shadowAlpha[HOUSE_SHADOW_FADE_HEIGHT]?.[0]).toBe(0);
    expect(shadowAlpha.flat().some((alpha) => alpha > 0 && alpha < 255)).toBe(true);
    expect(Math.max(...shadowAlpha.flat())).toBeLessThanOrEqual(92);
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

  test('all solid house frames are opaque and the contact shadow stays soft', () => {
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
    assertContactShadow(pixel);
  });

  test('roof value hierarchy, facade contrast, and bounded plinth are measurable', () => {
    const luminance = (color: [number, number, number, number]): number =>
      0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    const meanLuminance = (key: string, x0: number, y0: number, x1: number, y1: number): number => {
      let total = 0;
      let count = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          total += luminance(pixel(key, x, y));
          count++;
        }
      }
      return total / count;
    };

    const frontSlope = meanLuminance('house_roof_front.png', 4, 5, 27, 10);
    const ridgeShadow = meanLuminance('house_roof_ridge.png', 4, 14, 27, 17);
    const backPlane = meanLuminance('house_roof_back.png', 4, 5, 27, 10);
    const facade = meanLuminance('house_facade_wall.png', 4, 8, 27, 24);
    const leftGable = meanLuminance('house_roof_gable_left.png', 0, 4, 15, 27);
    const rightGable = meanLuminance('house_roof_gable_right.png', 16, 4, 31, 27);
    expect(frontSlope).toBeGreaterThan(ridgeShadow);
    expect(ridgeShadow).toBeGreaterThan(backPlane);
    expect(leftGable).toBeGreaterThan(backPlane);
    expect(leftGable).toBeLessThan(frontSlope);
    expect(rightGable).toBeGreaterThan(backPlane);
    expect(rightGable).toBeLessThan(frontSlope);
    expect(facade).toBeLessThan(frontSlope);

    const gableStrokeColor = [82, 55, 40] as const;
    const maxStrokeRun = (key: string): number => {
      let maximum = 0;
      for (let y = 0; y < 32; y++) {
        let run = 0;
        for (let x = 0; x < 32; x++) {
          const color = pixel(key, x, y);
          const isStroke =
            color[0] === gableStrokeColor[0] &&
            color[1] === gableStrokeColor[1] &&
            color[2] === gableStrokeColor[2];
          run = isStroke ? run + 1 : 0;
          maximum = Math.max(maximum, run);
        }
      }
      return maximum;
    };
    expect(maxStrokeRun('house_roof_gable_left.png')).toBe(0);
    expect(maxStrokeRun('house_roof_gable_right.png')).toBe(0);

    const plinthColor = pixel('house_foundation.png', 16, 32 - HOUSE_PLINTH_HEIGHT);
    let measuredPlinthHeight = 0;
    for (let y = 32 - HOUSE_PLINTH_HEIGHT; y < 32; y++) {
      const current = pixel('house_foundation.png', 16, y);
      if (
        current[0] !== plinthColor[0] ||
        current[1] !== plinthColor[1] ||
        current[2] !== plinthColor[2]
      ) {
        break;
      }
      measuredPlinthHeight++;
    }
    expect(measuredPlinthHeight).toBeGreaterThan(0);
    expect(measuredPlinthHeight).toBeLessThanOrEqual(8);
  });

  test('assembled hut uses exactly one closed door frame', () => {
    const map = makeHouseMap();
    placeTestHouse(map);
    const doorFrames = (map.groundExtra ?? []).filter(
      ([, , gid]) => gid === HOUSE_FRAMES.doorClosed || gid === HOUSE_FRAMES.doorOpen,
    );
    expect(doorFrames.filter(([, , gid]) => gid === HOUSE_FRAMES.doorClosed)).toHaveLength(1);
    expect(doorFrames.filter(([, , gid]) => gid === HOUSE_FRAMES.doorOpen)).toHaveLength(0);
  });
});
