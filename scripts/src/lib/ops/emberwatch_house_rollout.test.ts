// scripts/src/lib/ops/emberwatch_house_rollout.test.ts
//
// C-553 — accepted house-kit refinement and village-wide rollout regressions.
// Tests consume the authored builders and packed atlas, not copied frame data.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  assertNoHousePropOverlaps,
  HOUSE_FACADE_ROWS,
  HOUSE_FRAMES,
  HOUSE_MAX_VISIBLE_ROOF_ROWS,
  HOUSE_ROOF_FRAMES,
  type HouseDoorState,
  type HouseRoofMaterial,
  houseDoorPlacement,
  houseVisibleRoofRows,
  placeHouse,
} from './emberwatch_authoring.ts';
import { buildInn, buildShop, buildVillage } from './emberwatch_map_retained.ts';
import { type MapData, type MapObjectLayer, makeMap } from './emberwatch_map_shared.ts';
import beforeCollision from './fixtures/emberwatch_village_collision_before_c553.json';
import { packAtlas } from './generate_emberwatch_atlas.ts';

type HouseDefinition = {
  role: string;
  region: { c0: number; r0: number; c1: number; r1: number };
  doorColumn: number;
  doorState: HouseDoorState;
  roofMaterial: HouseRoofMaterial;
  legacyOpenDoor?: ReadonlyArray<readonly [number, number]>;
};

const VILLAGE_HOUSES: readonly HouseDefinition[] = [
  {
    role: 'inn',
    region: { c0: 47, r0: 12, c1: 55, r1: 19 },
    doorColumn: 51,
    doorState: 'open',
    roofMaterial: 'slate',
    legacyOpenDoor: [
      [50, 19],
      [51, 19],
    ],
  },
  {
    role: 'shop',
    region: { c0: 47, r0: 26, c1: 55, r1: 32 },
    doorColumn: 51,
    doorState: 'open',
    roofMaterial: 'thatch',
    legacyOpenDoor: [
      [50, 32],
      [51, 32],
    ],
  },
  {
    role: 'smithy',
    region: { c0: 4, r0: 30, c1: 12, r1: 36 },
    doorColumn: 8,
    doorState: 'closed',
    roofMaterial: 'slate',
    legacyOpenDoor: [
      [7, 30],
      [8, 30],
    ],
  },
  {
    role: 'north-west cottage',
    region: { c0: 5, r0: 15, c1: 12, r1: 20 },
    doorColumn: 9,
    doorState: 'closed',
    roofMaterial: 'cedar',
    legacyOpenDoor: [
      [8, 20],
      [9, 20],
    ],
  },
  {
    role: 'north cottage',
    region: { c0: 18, r0: 13, c1: 24, r1: 18 },
    doorColumn: 21,
    doorState: 'closed',
    roofMaterial: 'cedar',
    legacyOpenDoor: [
      [20, 18],
      [21, 18],
    ],
  },
  {
    role: 'south-west shed',
    region: { c0: 24, r0: 36, c1: 30, r1: 41 },
    doorColumn: 27,
    doorState: 'closed',
    roofMaterial: 'thatch',
    legacyOpenDoor: [
      [26, 36],
      [27, 36],
    ],
  },
  {
    role: 'north-east hut',
    region: { c0: 51, r0: 5, c1: 56, r1: 9 },
    doorColumn: 54,
    doorState: 'closed',
    roofMaterial: 'cedar',
  },
];

const at = (map: MapData, c: number, r: number): number => r * map.width + c;

const contribution = (
  entries: Array<[number, number, number]> | undefined,
  c: number,
  r: number,
): number | undefined => entries?.find(([entryC, entryR]) => entryC === c && entryR === r)?.[2];

const propertyValue = (object: MapObjectLayer['objects'][number], name: string): unknown =>
  object.properties.find((property) => property.name === name)?.value;

const objectById = (
  layers: readonly MapObjectLayer[],
  id: number,
): MapObjectLayer['objects'][number] => {
  const object = layers.flatMap((layer) => layer.objects).find((candidate) => candidate.id === id);
  if (!object) {
    throw new Error(`missing object ${id}`);
  }
  return object;
};

const spawnById = (layers: readonly MapObjectLayer[], spawnId: string) => {
  const object = layers
    .flatMap((layer) => layer.objects)
    .find(
      (candidate) => candidate.type === 'spawn' && propertyValue(candidate, 'spawnId') === spawnId,
    );
  if (!object) {
    throw new Error(`missing spawn ${spawnId}`);
  }
  return object;
};

const expectedRoofFrame = (definition: HouseDefinition, c: number, r: number): number => {
  const frames = HOUSE_ROOF_FRAMES[definition.roofMaterial];
  const frontRow = definition.region.r1 - 2;
  const ridgeRow = frontRow - 1;
  if (r === definition.region.r0) {
    if (c === definition.region.c0) {
      return frames.gableLeft;
    }
    if (c === definition.region.c1) {
      return frames.gableRight;
    }
    return frames.back;
  }
  if (r === ridgeRow) {
    return c === definition.region.c0 || c === definition.region.c1
      ? frames.eaveOverhead
      : frames.ridge;
  }
  return frames.back;
};

type CollisionChange = {
  index: number;
  c: number;
  r: number;
  before: 0 | 1;
  after: 0 | 1;
  role: string;
};

const collisionChangesForHouse = (map: MapData, definition: HouseDefinition): CollisionChange[] => {
  if (definition.role === 'north-east hut') {
    return [];
  }
  const changes: CollisionChange[] = [];
  const legacyOpen = new Set((definition.legacyOpenDoor ?? []).map(([c, r]) => `${c},${r}`));
  for (let r = definition.region.r0; r < definition.region.r1 - 2; r++) {
    for (let c = definition.region.c0; c <= definition.region.c1; c++) {
      if (legacyOpen.has(`${c},${r}`)) {
        continue;
      }
      changes.push({ index: at(map, c, r), c, r, before: 1, after: 0, role: definition.role });
    }
  }
  for (const [c, r] of definition.legacyOpenDoor ?? []) {
    if (
      r === definition.region.r1 &&
      (c === definition.doorColumn - 1 || c === definition.doorColumn)
    ) {
      changes.push({ index: at(map, c, r), c, r, before: 0, after: 1, role: definition.role });
    }
  }
  return changes;
};

const expectedVillageCollisionDelta = (map: MapData): CollisionChange[] =>
  VILLAGE_HOUSES.flatMap((definition) => collisionChangesForHouse(map, definition)).toSorted(
    (left, right) => left.index - right.index,
  );

const NEIGHBORS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const enqueueNeighbors = (options: {
  map: MapData;
  index: number;
  queue: number[];
  seen: Set<number>;
}): void => {
  const c = options.index % options.map.width;
  const r = Math.floor(options.index / options.map.width);
  for (const [dc, dr] of NEIGHBORS) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nc >= options.map.width || nr < 0 || nr >= options.map.height) {
      continue;
    }
    const next = at(options.map, nc, nr);
    if (options.map.collision[next] === 1 || options.seen.has(next)) {
      continue;
    }
    options.seen.add(next);
    options.queue.push(next);
  }
};

const reachable = (
  map: MapData,
  start: readonly [number, number],
  goal: readonly [number, number],
): boolean => {
  const goalIndex = at(map, goal[0], goal[1]);
  const queue = [at(map, start[0], start[1])];
  const seen = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    if (index === undefined) {
      continue;
    }
    if (index === goalIndex) {
      return true;
    }
    enqueueNeighbors({ map, index, queue, seen });
  }
  return false;
};

const actorStandable = (map: MapData, c: number, r: number): boolean => {
  if (c < 0 || c >= map.width || r < 0 || r >= map.height) {
    return false;
  }
  if (map.collision[at(map, c, r)] === 1) {
    return false;
  }
  return r === 0 || map.collision[at(map, c, r - 1)] === 0;
};

const actorReachable = (
  map: MapData,
  start: readonly [number, number],
  goal: readonly [number, number],
): boolean => {
  if (!actorStandable(map, ...start) || !actorStandable(map, ...goal)) {
    return false;
  }
  const goalIndex = at(map, goal[0], goal[1]);
  const queue = [at(map, start[0], start[1])];
  const seen = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    if (index === undefined) {
      continue;
    }
    if (index === goalIndex) {
      return true;
    }
    const c = index % map.width;
    const r = Math.floor(index / map.width);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      const next = at(map, nc, nr);
      if (actorStandable(map, nc, nr) && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

const villageRoofCells = (definition: HouseDefinition): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let r = definition.region.r0; r < definition.region.r1 - 2; r++) {
    for (let c = definition.region.c0; c <= definition.region.c1; c++) {
      cells.push([c, r]);
    }
  }
  return cells;
};

const VILLAGE_ARRIVALS: readonly (readonly [number, number])[] = [
  [3, 24],
  [60, 24],
  [32, 44],
  [32, 3],
  [51, 36],
];

const expectHouseDoors = (map: MapData, definition: HouseDefinition): void => {
  const upperDoor =
    definition.doorState === 'open' ? HOUSE_FRAMES.doorUpperOpen : HOUSE_FRAMES.doorUpperClosed;
  const lowerDoor =
    definition.doorState === 'open' ? HOUSE_FRAMES.doorLowerOpen : HOUSE_FRAMES.doorLowerClosed;
  expect(
    contribution(map.groundExtra, definition.doorColumn, definition.region.r1 - 1),
    `${definition.role} upper door`,
  ).toBe(upperDoor);
  expect(
    contribution(map.groundExtra, definition.doorColumn, definition.region.r1),
    `${definition.role} lower door`,
  ).toBe(lowerDoor);
};

const expectHouseRoof = (map: MapData, definition: HouseDefinition): void => {
  const roofFrames = HOUSE_ROOF_FRAMES[definition.roofMaterial];
  for (let r = definition.region.r0; r < definition.region.r1 - 2; r++) {
    for (let c = definition.region.c0; c <= definition.region.c1; c++) {
      expect(
        contribution(map.overheadExtra, c, r),
        `${definition.role} ${definition.roofMaterial} roof (${c},${r})`,
      ).toBe(expectedRoofFrame(definition, c, r));
      expect(map.collision[at(map, c, r)], `${definition.role} roof (${c},${r})`).toBe(0);
    }
  }
  for (let c = definition.region.c0; c <= definition.region.c1; c++) {
    const frame =
      c === definition.region.c0 || c === definition.region.c1
        ? roofFrames.eaveEdge
        : roofFrames.front;
    expect(contribution(map.groundExtra, c, definition.region.r1 - 2)).toBe(frame);
  }
};

const expectHouseFacade = (map: MapData, definition: HouseDefinition): void => {
  for (let r = definition.region.r1 - 2; r <= definition.region.r1; r++) {
    for (let c = definition.region.c0; c <= definition.region.c1; c++) {
      expect(map.collision[at(map, c, r)], `${definition.role} facade (${c},${r})`).toBe(1);
    }
  }
};

const expectVillageHouses = (map: MapData): void => {
  for (const definition of VILLAGE_HOUSES) {
    expectHouseDoors(map, definition);
    expectHouseRoof(map, definition);
    expectHouseFacade(map, definition);
  }
};

describe('C-553 — shared placeHouse options and layouts', () => {
  test('uses one geometry with explicit roof palette and two-row door state', () => {
    const map = makeMap(12, 14);
    const door = placeHouse(map, {
      region: { c0: 2, r0: 3, c1: 9, r1: 8 },
      door: { c: 6, state: 'open' },
      facing: 's',
      roofMaterial: 'slate',
      mapId: 'rollout_test',
    });

    expect(door).toEqual({ c: 6, r: 8 });
    expect(contribution(map.overheadExtra, 2, 3)).toBe(HOUSE_ROOF_FRAMES.slate.gableLeft);
    expect(contribution(map.overheadExtra, 3, 3)).toBe(HOUSE_ROOF_FRAMES.slate.back);
    expect(contribution(map.overheadExtra, 9, 3)).toBe(HOUSE_ROOF_FRAMES.slate.gableRight);
    expect(contribution(map.groundExtra, 2, 6)).toBe(HOUSE_ROOF_FRAMES.slate.eaveEdge);
    expect(contribution(map.groundExtra, 6, 7)).toBe(HOUSE_FRAMES.doorUpperOpen);
    expect(contribution(map.groundExtra, 6, 8)).toBe(HOUSE_FRAMES.doorLowerOpen);
    expect(contribution(map.groundExtra, 5, 8)).toBe(HOUSE_FRAMES.facadeWindow);
    expect(contribution(map.groundExtra, 7, 8)).toBe(HOUSE_FRAMES.facadeWindow);
    expect(map.collision[at(map, 6, 7)]).toBe(1);
    expect(map.collision[at(map, 6, 8)]).toBe(1);
    expect(map.collision[at(map, 6, 5)]).toBe(0);

    expect(
      houseDoorPlacement({
        c0: 2,
        r0: 3,
        w: 8,
        h: 6,
        doorSide: 'south',
        doorColumn: 6,
      }),
    ).toEqual({
      doorCells: [
        [6, 7],
        [6, 8],
      ],
      landingCells: [
        [6, 9],
        [6, 10],
      ],
    });
  });

  test('caps front roof depth at three rows with one pale band and one ridge row', () => {
    const map = makeMap(20, 16);
    const region = { c0: 2, r0: 2, c1: 12, r1: 12 };
    placeHouse(map, {
      region,
      door: { c: 7, state: 'closed' },
      facing: 's',
      roofMaterial: 'slate',
      mapId: 'roof_cap_test',
    });
    const frames = HOUSE_ROOF_FRAMES.slate;
    const frontRow = region.r1 - HOUSE_FACADE_ROWS;
    const ridgeRow = frontRow - 1;
    expect(houseVisibleRoofRows(region.r1 - region.r0 + 1)).toBe(HOUSE_MAX_VISIBLE_ROOF_ROWS);
    for (let c = region.c0 + 1; c < region.c1; c += 1) {
      const frontBands: number[] = [];
      const ridgeRows: number[] = [];
      for (let r = region.r0; r <= frontRow; r += 1) {
        if (contribution(map.groundExtra, c, r) === frames.front) {
          frontBands.push(r);
        }
        if (contribution(map.overheadExtra, c, r) === frames.ridge) {
          ridgeRows.push(r);
        }
      }
      expect(frontBands, `pale front bands at column ${c}`).toEqual([frontRow]);
      expect(ridgeRows, `ridge highlights at column ${c}`).toEqual([ridgeRow]);
    }
  });

  test('C-553 appended GIDs stay outside the C-552 repaint and corner16 block', () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL('../../../../content/packs/emberwatch/manifest.json', import.meta.url),
        'utf8',
      ),
    ) as { tiles?: Record<string, { frame?: string }> };
    const c553Frames = new Set([
      'house_door_upper_closed.png',
      'house_door_upper_open.png',
      'house_roof_slate_front.png',
      'house_roof_slate_back.png',
      'house_roof_slate_ridge.png',
      'house_roof_slate_gable_left.png',
      'house_roof_slate_gable_right.png',
      'house_roof_slate_eave_overhead.png',
      'house_roof_slate_eave_edge.png',
      'house_roof_thatch_front.png',
      'house_roof_thatch_back.png',
      'house_roof_thatch_ridge.png',
      'house_roof_thatch_gable_left.png',
      'house_roof_thatch_gable_right.png',
      'house_roof_thatch_eave_overhead.png',
      'house_roof_thatch_eave_edge.png',
    ]);
    const c553Gids = Object.entries(manifest.tiles ?? {})
      .filter(([, definition]) => c553Frames.has(definition.frame ?? ''))
      .map(([gid]) => Number(gid))
      .sort((left, right) => left - right);
    expect(c553Gids).toEqual(Array.from({ length: 16 }, (_, index) => 161 + index));
    expect(
      c553Gids.some((gid) => gid === 34 || gid === 47 || (gid >= 48 && gid < 128)),
      'C-553 GIDs collide with C-552 terrain/corner16 allocations',
    ).toBe(false);
  });
});

describe('C-553 — packed door/window/roof pixel geometry', () => {
  const atlas = packAtlas();
  type Pixel = [number, number, number, number];
  const pixel = (key: string, x: number, y: number): Pixel => {
    const rect = atlas.frames[key]?.frame;
    if (!rect) {
      throw new Error(`missing atlas frame ${key}`);
    }
    const index = ((rect.y + y) * atlas.width + rect.x + x) * 4;
    return [
      atlas.rgba[index] ?? 0,
      atlas.rgba[index + 1] ?? 0,
      atlas.rgba[index + 2] ?? 0,
      atlas.rgba[index + 3] ?? 0,
    ];
  };
  const doorPixelColors = new Set(['48,32,27', '108,67,38', '145,94,52', '42,36,31', '58,45,37']);
  const doorPixel = (color: Pixel): boolean => doorPixelColors.has(color.slice(0, 3).join(','));
  const alphaMask = (key: string): string => {
    let mask = '';
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        mask += pixel(key, x, y)[3] > 0 ? '1' : '0';
      }
    }
    return mask;
  };
  const roofKey = (material: HouseRoofMaterial, suffix: string): string =>
    material === 'cedar' ? `house_roof_${suffix}.png` : `house_roof_${material}_${suffix}.png`;
  const roofSuffix = (x: number, width: number): string => {
    if (x < 32) {
      return 'gable_left';
    }
    if (x >= (width - 1) * 32) {
      return 'gable_right';
    }
    return 'back';
  };
  const roofHeights = (material: HouseRoofMaterial, width: number): number[] => {
    const heights: number[] = [];
    for (let x = 0; x < width * 32; x++) {
      const top = Array.from(
        { length: 32 },
        (_, y) => pixel(roofKey(material, roofSuffix(x, width)), x % 32, y)[3],
      ).findIndex((alpha) => alpha > 0);
      heights.push(top);
    }
    return heights;
  };
  const expectRoofPaletteMasks = (): void => {
    for (const suffix of [
      'front',
      'back',
      'ridge',
      'gable_left',
      'gable_right',
      'eave_overhead',
      'eave_edge',
    ]) {
      expect(alphaMask(roofKey('slate', suffix))).toBe(alphaMask(roofKey('cedar', suffix)));
      expect(alphaMask(roofKey('thatch', suffix))).toBe(alphaMask(roofKey('cedar', suffix)));
    }
  };
  const expectMonotonicRoof = (material: HouseRoofMaterial, width: number): void => {
    const heights = roofHeights(material, width);
    const center = Math.floor((width - 1) / 2) * 32;
    expect(heights[0], `${material} width ${width} left end`).toBeGreaterThanOrEqual(12);
    expect(heights.at(-1), `${material} width ${width} right end`).toBeGreaterThanOrEqual(12);
    expect(heights[center], `${material} width ${width} centre`).toBe(0);
    for (let x = 1; x < heights.length; x++) {
      expect(
        Math.abs((heights[x] ?? 0) - (heights[x - 1] ?? 0)),
        `${material} width ${width} diagonal step at ${x}`,
      ).toBeLessThanOrEqual(1);
    }
    for (let x = 0; x < center; x++) {
      expect(heights[x + 1]).toBeLessThanOrEqual(heights[x] ?? 0);
    }
    for (let x = center; x < heights.length - 1; x++) {
      expect(heights[x + 1]).toBeGreaterThanOrEqual(heights[x] ?? 0);
    }
  };

  test('closed and open doors keep a continuous >=44px opening across both facade rows', () => {
    for (const state of ['closed', 'open'] as const) {
      const lowerKey = state === 'closed' ? 'house_door_closed.png' : 'house_door_open.png';
      const run = Array.from({ length: 64 }, (_, y) =>
        doorPixel(
          y < 32 ? pixel(`house_door_upper_${state}.png`, 16, y) : pixel(lowerKey, 16, y - 32),
        ),
      );
      const first = run.findIndex(Boolean);
      const last = run.lastIndexOf(true);
      expect(first, `${state} upper seam pixel`).toBeGreaterThanOrEqual(0);
      expect(run.slice(first, last + 1).every(Boolean), `${state} contiguous opening`).toBe(true);
      expect(last - first + 1, `${state} door opening height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('windows remain materially smaller than the actor-height doorway', () => {
    const colors = new Set(['75,116,127', '153,183,174']);
    const points: Array<[number, number]> = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const color = pixel('house_facade_window.png', x, y);
        if (colors.has(color.slice(0, 3).join(','))) {
          points.push([x, y]);
        }
      }
    }
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const width = Math.max(...xs) - Math.min(...xs) + 1;
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    expect(width).toBe(8);
    expect(height).toBe(10);
  });

  test('all roof palettes share one monotonic gable silhouette at every village width', () => {
    expectRoofPaletteMasks();
    expect(alphaMask(roofKey('cedar', 'gable_left'))[0]).toBe('0');
    expect(alphaMask(roofKey('cedar', 'gable_right'))[31]).toBe('0');
    for (const material of ['cedar', 'slate', 'thatch'] as const) {
      for (const width of [6, 7, 8, 9]) {
        expectMonotonicRoof(material, width);
      }
    }
  });

  test('back-slope pixels stay darker than the single front band', () => {
    const peakLuminance = (key: string): number => {
      let peak = 0;
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          const [red, green, blue, alpha] = pixel(key, x, y);
          if (alpha === 0) {
            continue;
          }
          peak = Math.max(peak, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
        }
      }
      return peak;
    };
    for (const material of ['cedar', 'slate', 'thatch'] as const) {
      expect(peakLuminance(roofKey(material, 'back')), `${material} back slope`).toBeLessThan(
        peakLuminance(roofKey(material, 'front')),
      );
    }
  });

  test('stable facade-corner frames no longer add a dark side column', () => {
    const rgba = (key: string): string[] =>
      Array.from({ length: 32 * 32 }, (_, index) => {
        const x = index % 32;
        const y = Math.floor(index / 32);
        return pixel(key, x, y).join(',');
      });
    expect(rgba('house_facade_corner_left.png')).toEqual(rgba('house_facade_wall.png'));
    expect(rgba('house_facade_corner_right.png')).toEqual(rgba('house_facade_wall.png'));
  });
});

describe('C-553 — village rollout and transition truth', () => {
  test('every village structure uses the shared two-row kit', () => {
    expectVillageHouses(buildVillage().map);
  });

  test('keeps prop visual footprints off house cells and door approaches', () => {
    const village = buildVillage();
    expect(() =>
      assertNoHousePropOverlaps({ map: village.map, objectLayers: village.objectLayers }),
    ).not.toThrow();
    for (const [id, c, r] of [
      [16, 15, 20],
      [24, 56, 22],
      [28, 55, 22],
      [61, 53, 22],
    ] as const) {
      expect(objectById(village.objectLayers, id)).toMatchObject({ x: c * 32, y: r * 32 });
    }
    const brazier = objectById(village.objectLayers, 61);
    brazier.x = 51 * 32;
    brazier.y = 20 * 32;
    expect(() =>
      assertNoHousePropOverlaps({ map: village.map, objectLayers: village.objectLayers }),
    ).toThrow(/inn_brazier/);
  });

  test('the village source has no legacy building() calls', () => {
    const source = readFileSync(new URL('./emberwatch_map_village.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bbuilding\(/);
  });

  test('inn/shop transitions and arrivals align to the visible doors without changing identities', () => {
    const village = buildVillage();
    const inn = buildInn();
    const shop = buildShop();
    const innTransition = objectById(village.objectLayers, 1006);
    const shopTransition = objectById(village.objectLayers, 1005);
    const northTransition = objectById(village.objectLayers, 1007);

    expect(innTransition).toMatchObject({
      x: 51 * 32,
      y: 20 * 32,
      width: 32,
      height: 64,
    });
    expect(propertyValue(innTransition, 'targetMap')).toBe('inn');
    expect(propertyValue(innTransition, 'targetSpawnId')).toBe('inn_entrance');
    expect(propertyValue(innTransition, 'targetX')).toBe(14 * 32);
    expect(propertyValue(innTransition, 'targetY')).toBe(17 * 32);

    expect(shopTransition).toMatchObject({
      x: 51 * 32,
      y: 33 * 32,
      width: 32,
      height: 64,
    });
    expect(propertyValue(shopTransition, 'targetMap')).toBe('merchant_shop');
    expect(propertyValue(shopTransition, 'targetSpawnId')).toBe('shop_entrance');
    expect(propertyValue(shopTransition, 'targetX')).toBe(12 * 32);
    expect(propertyValue(shopTransition, 'targetY')).toBe(15 * 32);

    expect(northTransition).toMatchObject({ x: 31 * 32, y: 0, width: 96, height: 64 });
    expect(spawnById(village.objectLayers, 'from_inn')).toMatchObject({
      x: 51 * 32,
      y: 23 * 32,
    });
    expect(spawnById(village.objectLayers, 'from_merchant')).toMatchObject({
      x: 51 * 32,
      y: 36 * 32,
    });
    expect(23 * 32).toBeGreaterThan(20 * 32 + 64);
    expect(36 * 32).toBeGreaterThan(33 * 32 + 64);
    expect(spawnById(inn.objectLayers, 'inn_entrance')).toMatchObject({ x: 14 * 32, y: 17 * 32 });
    expect(spawnById(shop.objectLayers, 'shop_entrance')).toMatchObject({ x: 12 * 32, y: 15 * 32 });

    const innReturn = objectById(inn.objectLayers, 1005);
    const shopReturn = objectById(shop.objectLayers, 1005);
    expect(propertyValue(innReturn, 'targetMap')).toBe('village');
    expect(propertyValue(innReturn, 'targetSpawnId')).toBe('from_inn');
    expect(propertyValue(innReturn, 'targetX')).toBe(51 * 32);
    expect(propertyValue(innReturn, 'targetY')).toBe(23 * 32);
    expect(propertyValue(shopReturn, 'targetMap')).toBe('village');
    expect(propertyValue(shopReturn, 'targetSpawnId')).toBe('from_merchant');
    expect(propertyValue(shopReturn, 'targetX')).toBe(51 * 32);
    expect(propertyValue(shopReturn, 'targetY')).toBe(36 * 32);
  });

  test('every door trigger and walk-behind roof is reachable from every village arrival', () => {
    const { map } = buildVillage();
    for (const arrival of [
      [3, 24],
      [60, 24],
      [32, 44],
      [32, 3],
    ] as const) {
      expect(reachable(map, arrival, [51, 21]), `arrival ${arrival} → inn trigger`).toBe(true);
      expect(reachable(map, arrival, [51, 34]), `arrival ${arrival} → shop trigger`).toBe(true);
    }
    for (const definition of VILLAGE_HOUSES) {
      const center = Math.floor((definition.region.c0 + definition.region.c1) / 2);
      expect(
        reachable(map, [32, 23], [center, definition.region.r0 + 1]),
        `${definition.role} walk-behind roof`,
      ).toBe(true);
    }
  });

  test('every house has an actor-standable roof row reachable from every arrival', () => {
    const { map } = buildVillage();
    for (const definition of VILLAGE_HOUSES) {
      const standableCells = villageRoofCells(definition).filter(([c, r]) =>
        actorStandable(map, c, r),
      );
      expect(
        standableCells.length,
        `${definition.role} actor-standable roof cells`,
      ).toBeGreaterThan(0);
      for (const arrival of VILLAGE_ARRIVALS) {
        const unreachable = standableCells.filter(
          ([c, r]) => !actorReachable(map, arrival, [c, r]),
        );
        expect(
          unreachable.map(([c, r]) => `${c},${r}`),
          `${definition.role} roof cells from ${arrival.join(',')}`,
        ).toEqual([]);
      }
    }
  });

  test('documents the raw-clear roof cells made non-standable by adjacent terrain', () => {
    const { map } = buildVillage();
    const expectedInaccessible = new Map<string, string[]>([
      ['north cottage', ['18,13', '19,13', '20,13', '21,13', '22,13', '23,13', '24,13']],
    ]);
    for (const definition of VILLAGE_HOUSES) {
      const rawClearCells = villageRoofCells(definition).filter(
        ([c, r]) => map.collision[at(map, c, r)] === 0,
      );
      const inaccessible = rawClearCells
        .filter(([c, r]) => !actorReachable(map, [32, 23], [c, r]))
        .map(([c, r]) => `${c},${r}`);
      expect(inaccessible, `${definition.role} inaccessible raw-clear roof cells`).toEqual(
        expectedInaccessible.get(definition.role) ?? [],
      );
      for (const [c, r] of rawClearCells) {
        if (inaccessible.includes(`${c},${r}`)) {
          expect(map.collision[at(map, c, r - 1)], `${definition.role} ${c},${r} above`).toBe(1);
        }
      }
    }
  });
});

describe('C-553 — exact generated collision delta', () => {
  test('groups every changed cell under one building and pins the eight newly blocked cells', () => {
    const { map } = buildVillage();
    const expected = expectedVillageCollisionDelta(map);
    expect(beforeCollision.width).toBe(map.width);
    expect(beforeCollision.height).toBe(map.height);
    expect(beforeCollision.rows).toHaveLength(map.height);
    expect(
      beforeCollision.rows.every((row) => /^[01]+$/.test(row) && row.length === map.width),
    ).toBe(true);
    const baseline = beforeCollision.rows.flatMap((row) => Array.from(row, Number));
    expect(map.collision).toHaveLength(baseline.length);
    const actual = map.collision.flatMap((value, index) =>
      value === baseline[index] ? [] : [{ index, before: baseline[index], after: value }],
    );
    expect(actual).toEqual(
      expected.map((change) => ({
        index: change.index,
        before: change.before,
        after: change.after,
      })),
    );

    const newlyBlocked = expected.filter((change) => change.before === 0 && change.after === 1);
    expect(newlyBlocked.map(({ c, r, role }) => `${role}:${c},${r}`)).toEqual([
      'north cottage:20,18',
      'north cottage:21,18',
      'inn:50,19',
      'inn:51,19',
      'north-west cottage:8,20',
      'north-west cottage:9,20',
      'shop:50,32',
      'shop:51,32',
    ]);
  });
});
