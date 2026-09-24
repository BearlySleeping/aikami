// scripts/src/lib/ops/emberwatch_terrain_pass.test.ts
//
// C-552 — organic corner16 terrain, calm stone, sparse grass tufts, and
// painter-only map identity. These tests read the real packed atlas and the
// real five map builders; they do not duplicate painter constants.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autotileLayers } from '../../../../packages/frontend/engine/src/assets/autotile.ts';
import { G } from './emberwatch_authoring.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';
import { EMBERWATCH_MAP_BUILDERS } from './generate_emberwatch_maps.ts';
import {
  ATLAS_CELL,
  ATLAS_COLS,
  ATLAS_PADDING,
  ATLAS_TILE_SIZE,
  readManifestTerrains,
  readManifestTiles,
} from './generate_emberwatch_tables.ts';
import {
  CORNER_TERRAIN_SEEDS,
  cornerCoverageForPixel,
} from './generate_emberwatch_terrain_frames.ts';

const TILE = ATLAS_TILE_SIZE;
const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mapsDirectory = join(repository, 'content/packs/emberwatch/maps');
const atlas = packAtlas();

const CORNER_TERRAINS = ['dirt', 'water', 'gravel', 'earth', 'cobblestone'] as const;

/** Endpoint material means used to classify real intermediate pixels. */
const CLASSIFICATION_FRAMES = {
  dirt: { base: 'dirt_0.png', overlay: 'dirt_15.png' },
  water: { base: 'water_0.png', overlay: 'water_15.png' },
  gravel: { base: 'gravel_0.png', overlay: 'gravel_15.png' },
  earth: { base: 'earth_0.png', overlay: 'earth_15.png' },
  cobblestone: { base: 'cobblestone_0.png', overlay: 'cobblestone_15.png' },
} as const;

const BASELINE_COLLISION_SHA256: Readonly<Record<string, string>> = {
  inn: 'e0334e3d214c755173a637245b00ee037e186b559c8726029af7b86b4817260d',
  merchant_shop: '11d9b9b16de7ac3cd6cf83edd16258131e75efc94b96dcef69ac8218337c91a6',
  old_road: '83bb92ecf8def467fc1271b61f7f7f3d4a15bc2620ae2f972b20065399b97db9',
  ruined_shrine: '16b8b021c07f0c91abe7dc2dd4bd95d499d88aa343d74d9c3ab686a2fffc5a7f',
  village: '7b9d42aae44f6adac468f6a8bbb6c191e965ccea1edc5b84936e5e0736f21db1',
} as const;

type GrassTuftMetrics = { eligible: number; tufts: number; contaminated: number };

const engineTerrains = () =>
  readManifestTerrains().map((terrain) => ({
    name: terrain.name,
    precedence: terrain.precedence,
    wang: terrain.wang === 'corner16' ? ('corner16' as const) : ('fill' as const),
    frameBase: terrain.frameBase,
    ...(terrain.variants === undefined ? {} : { variants: terrain.variants }),
    isWalkable: terrain.isWalkable,
  }));

const terrainNameByGid = (
  terrains: ReturnType<typeof engineTerrains>,
): ReadonlyMap<number, string> => {
  const frameToTerrain = new Map<string, string>();
  for (const terrain of terrains) {
    frameToTerrain.set(terrain.frameBase, terrain.name);
    for (const frame of terrain.variants ?? []) {
      frameToTerrain.set(frame, terrain.name);
    }
  }
  const result = new Map<number, string>();
  for (const [gid, tile] of Object.entries(readManifestTiles())) {
    const terrainName = frameToTerrain.get(tile.frame);
    if (terrainName) {
      result.set(Number(gid), terrainName);
    }
  }
  return result;
};

const measureGrassTufts = (options: {
  width: number;
  height: number;
  terrain: string[];
  terrains: ReturnType<typeof engineTerrains>;
}): GrassTuftMetrics => {
  const layers = autotileLayers({
    width: options.width,
    height: options.height,
    terrain: options.terrain,
    terrains: options.terrains,
  });
  const base = layers.find((layer) => layer.isBase);
  if (!base) {
    throw new Error('C-552 grass metric: missing base terrain layer');
  }
  let eligible = 0;
  let tufts = 0;
  let contaminated = 0;
  for (let index = 0; index < options.terrain.length; index++) {
    const isGrass = options.terrain[index] === 'grass';
    if (isGrass) {
      eligible += 1;
      if (base.frames[index] === 'grass_variant.png') {
        tufts += 1;
      }
      continue;
    }
    if (base.frames[index] === 'grass_variant.png') {
      contaminated += 1;
    }
  }
  return { eligible, tufts, contaminated };
};
type Pixel = { x: number; y: number; r: number; g: number; b: number; a: number };
type Rgb = readonly [number, number, number];
type CollisionLayer = { data: number[]; digest: string; height: number; width: number };

const luminance = (pixel: Pixel): number => 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

const framePixels = (key: string): Pixel[] => {
  const descriptor = atlas.frames[key]?.frame;
  if (!descriptor) {
    throw new Error(`Missing atlas frame ${key}`);
  }
  const pixels: Pixel[] = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const index = ((descriptor.y + y) * atlas.width + descriptor.x + x) * 4;
      pixels.push({
        x,
        y,
        r: atlas.rgba[index] ?? 0,
        g: atlas.rgba[index + 1] ?? 0,
        b: atlas.rgba[index + 2] ?? 0,
        a: atlas.rgba[index + 3] ?? 0,
      });
    }
  }
  return pixels;
};

const meanRgb = (key: string): Rgb => {
  const pixels = framePixels(key);
  return [
    mean(pixels.map((pixel) => pixel.r)),
    mean(pixels.map((pixel) => pixel.g)),
    mean(pixels.map((pixel) => pixel.b)),
  ];
};

const colorDistance = (pixel: Pixel, reference: Rgb): number => {
  const channels = [pixel.r - reference[0], pixel.g - reference[1], pixel.b - reference[2]];
  return channels.reduce((sum, channel) => sum + channel * channel, 0);
};

const classifyPixels = (key: string, base: Rgb, overlay: Rgb): number[] =>
  framePixels(key).map((pixel) =>
    colorDistance(pixel, overlay) < colorDistance(pixel, base) ? 1 : 0,
  );

type DiagonalPoint = { x: number; y: number };
type SeamStats = {
  pairCount: number;
  classMismatches: number;
  lumaDeltaSum: number;
  lumaDeltaCount: number;
};

const addDiagonalPoint = (groups: Map<string, DiagonalPoint[]>, point: DiagonalPoint): void => {
  for (const key of [`x-y:${point.x - point.y}`, `x+y:${point.x + point.y}`]) {
    const points = groups.get(key) ?? [];
    points.push(point);
    groups.set(key, points);
  }
};

const diagonalTransitionGroups = (
  classification: readonly number[],
): Map<string, DiagonalPoint[]> => {
  const transitions: DiagonalPoint[] = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 1; x < TILE; x++) {
      if (classification[y * TILE + x] !== classification[y * TILE + x - 1]) {
        transitions.push({ x, y });
      }
    }
  }
  const groups = new Map<string, DiagonalPoint[]>();
  for (const point of transitions) {
    addDiagonalPoint(groups, point);
  }
  return groups;
};

const longestRunInPoints = (points: readonly DiagonalPoint[]): number => {
  const rows = new Set(points.map((point) => point.y));
  let run = 0;
  let longest = 0;
  for (let y = 0; y < TILE; y++) {
    run = rows.has(y) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
};

/** Longest globally straight 45-degree transition line, not a local curve tangent. */
const longestDiagonalRun = (classification: readonly number[]): number => {
  const groups = diagonalTransitionGroups(classification);
  let longest = 0;
  for (const points of groups.values()) {
    longest = Math.max(longest, longestRunInPoints(points));
  }
  return longest;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readCollisionLayer = (value: unknown): CollisionLayer => {
  if (!isRecord(value) || !Array.isArray(value.layers)) {
    throw new Error('Map JSON has no layers array');
  }
  for (const layer of value.layers) {
    if (!isRecord(layer) || layer.name !== 'collision') {
      continue;
    }
    const { data, width, height } = layer;
    if (
      !Array.isArray(data) ||
      !data.every((entry) => typeof entry === 'number') ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) {
      throw new Error('Collision layer has an invalid shape');
    }
    return {
      data: [...data],
      digest: createHash('sha256').update(JSON.stringify(layer)).digest('hex'),
      width,
      height,
    };
  }
  throw new Error('Map JSON has no collision layer');
};

const horizontalPairMatches = (left: number, right: number): boolean =>
  (left & 0b0010) === (right & 0b0001) && (left & 0b0100) === (right & 0b1000);

const verticalPairMatches = (top: number, bottom: number): boolean =>
  (top & 0b1000) === (bottom & 0b0001) && (top & 0b0100) === (bottom & 0b0010);

const addSeamSample = (options: {
  stats: SeamStats;
  leftClass: number | undefined;
  rightClass: number | undefined;
  leftPixel: Pixel | undefined;
  rightPixel: Pixel | undefined;
}): void => {
  const { stats, leftClass, rightClass, leftPixel, rightPixel } = options;
  stats.classMismatches += leftClass === rightClass ? 0 : 1;
  if (!leftPixel || !rightPixel) {
    return;
  }
  stats.lumaDeltaSum += Math.abs(luminance(leftPixel) - luminance(rightPixel));
  stats.lumaDeltaCount += 1;
};

const accumulateHorizontalSeams = (options: {
  classes: number[][];
  pixels: Pixel[][];
  stats: SeamStats;
}): void => {
  const { classes, pixels, stats } = options;
  for (let left = 0; left < 16; left++) {
    for (let right = 0; right < 16; right++) {
      if (!horizontalPairMatches(left, right)) {
        continue;
      }
      stats.pairCount += 1;
      for (let y = 0; y < TILE; y++) {
        addSeamSample({
          stats,
          leftClass: classes[left]?.[y * TILE + TILE - 1],
          rightClass: classes[right]?.[y * TILE],
          leftPixel: pixels[left]?.[y * TILE + TILE - 1],
          rightPixel: pixels[right]?.[y * TILE],
        });
      }
    }
  }
};

const accumulateVerticalSeams = (options: {
  classes: number[][];
  pixels: Pixel[][];
  stats: SeamStats;
}): void => {
  const { classes, pixels, stats } = options;
  for (let top = 0; top < 16; top++) {
    for (let bottom = 0; bottom < 16; bottom++) {
      if (!verticalPairMatches(top, bottom)) {
        continue;
      }
      stats.pairCount += 1;
      for (let x = 0; x < TILE; x++) {
        addSeamSample({
          stats,
          leftClass: classes[top]?.[(TILE - 1) * TILE + x],
          rightClass: classes[bottom]?.[x],
          leftPixel: pixels[top]?.[(TILE - 1) * TILE + x],
          rightPixel: pixels[bottom]?.[x],
        });
      }
    }
  }
};

const measureSeamStats = (terrain: (typeof CORNER_TERRAINS)[number]): SeamStats => {
  const palette = CLASSIFICATION_FRAMES[terrain];
  const base = meanRgb(palette.base);
  const overlay = meanRgb(palette.overlay);
  const classes = Array.from({ length: 16 }, (_, mask) =>
    classifyPixels(`${terrain}_${mask}.png`, base, overlay),
  );
  const pixels = Array.from({ length: 16 }, (_, mask) => framePixels(`${terrain}_${mask}.png`));
  const stats: SeamStats = {
    pairCount: 0,
    classMismatches: 0,
    lumaDeltaSum: 0,
    lumaDeltaCount: 0,
  };
  accumulateHorizontalSeams({ classes, pixels, stats });
  accumulateVerticalSeams({ classes, pixels, stats });
  return stats;
};

describe('C-552 AC-1 — all corner16 cases are organic and seamless', () => {
  for (const terrain of CORNER_TERRAINS) {
    test(`${terrain} has no straight 45-degree boundary run longer than 4 px`, () => {
      const seed = CORNER_TERRAIN_SEEDS[terrain];
      const runs: number[] = [];
      for (let mask = 1; mask < 15; mask++) {
        const coverage = Array.from({ length: TILE * TILE }, (_, index) =>
          cornerCoverageForPixel({
            mask,
            x: index % TILE,
            y: Math.floor(index / TILE),
            seed,
          }) >= 0.5
            ? 1
            : 0,
        );
        runs.push(longestDiagonalRun(coverage));
      }
      expect(Math.max(...runs), `${terrain} diagonal runs ${runs.join(',')}`).toBeLessThanOrEqual(
        4,
      );
      for (let mask = 0; mask < 16; mask++) {
        expect(
          framePixels(`${terrain}_${mask}.png`).every((pixel) => pixel.a === 255),
          `${terrain}_${mask}.png remains opaque`,
        ).toBe(true);
      }
    });

    test(`${terrain} valid orthogonal neighbours share edge classifications and bounded luma`, () => {
      const stats = measureSeamStats(terrain);
      expect(stats.pairCount, `${terrain} valid neighbour pairs`).toBe(32);
      expect(stats.classMismatches, `${terrain} edge classification mismatches`).toBe(0);
      expect(
        stats.lumaDeltaSum / stats.lumaDeltaCount,
        `${terrain} mean seam luma delta`,
      ).toBeLessThanOrEqual(6);
    });
  }

  test('the reserved terrain block keeps every existing GID cell pinned', () => {
    const starts = { dirt: 48, water: 64, gravel: 80, earth: 96, cobblestone: 112 } as const;
    for (const terrain of CORNER_TERRAINS) {
      const start = starts[terrain];
      for (let mask = 0; mask < 16; mask++) {
        const cell = start + mask;
        const descriptor = atlas.frames[`${terrain}_${mask}.png`]?.frame;
        expect(descriptor, `${terrain}_${mask}.png`).toEqual({
          x: (cell % ATLAS_COLS) * ATLAS_CELL + ATLAS_PADDING,
          y: Math.floor(cell / ATLAS_COLS) * ATLAS_CELL + ATLAS_PADDING,
          w: TILE,
          h: TILE,
        });
      }
    }
  });
});

describe('C-552 AC-2 — stone is calm, irregular, and shared by all five maps', () => {
  test('stone luminance sits near grass/dirt and mortar contrast is bounded', () => {
    const stone = framePixels('stone_floor.png');
    const stoneLuminance = stone.map(luminance);
    const grassMean = mean(framePixels('grass.png').map(luminance));
    const dirtMean = mean(framePixels('dirt.png').map(luminance));
    const terrainFamilyMean = (grassMean + dirtMean) / 2;
    const stoneMean = mean(stoneLuminance);
    const p10 = percentile(stoneLuminance, 0.1);
    const p90 = percentile(stoneLuminance, 0.9);
    const localContrast: number[] = [];

    for (const pixel of stone) {
      const current = luminance(pixel);
      const right = pixel.x + 1 < TILE ? stone[pixel.y * TILE + pixel.x + 1] : undefined;
      const below = pixel.y + 1 < TILE ? stone[(pixel.y + 1) * TILE + pixel.x] : undefined;
      if (right) {
        localContrast.push(Math.abs(current - luminance(right)));
      }
      if (below) {
        localContrast.push(Math.abs(current - luminance(below)));
      }
    }

    expect(stoneMean, 'stone mean luminance').toBeGreaterThanOrEqual(108);
    expect(stoneMean, 'stone mean luminance').toBeLessThanOrEqual(124);
    expect(
      Math.abs(stoneMean - terrainFamilyMean),
      'stone vs grass/dirt family mean',
    ).toBeLessThanOrEqual(10);
    expect(p90 - p10, 'stone p90-p10 luminance spread').toBeLessThanOrEqual(22);
    expect(percentile(localContrast, 0.95), 'stone p95 local contrast').toBeLessThanOrEqual(20);
  });

  test('stone has no full-width or full-height 8 px bevel rows/columns', () => {
    const stone = framePixels('stone_floor.png');
    const stoneLuminance = stone.map(luminance);
    const stoneMean = mean(stoneLuminance);
    const bright = (pixel: Pixel): boolean => luminance(pixel) > stoneMean + 8;
    const maxRowBright = Math.max(
      ...Array.from(
        { length: TILE },
        (_, y) => stone.filter((pixel) => pixel.y === y && bright(pixel)).length,
      ),
    );
    const maxColumnBright = Math.max(
      ...Array.from(
        { length: TILE },
        (_, x) => stone.filter((pixel) => pixel.x === x && bright(pixel)).length,
      ),
    );
    expect(maxRowBright, 'bright pixels in one stone row').toBeLessThanOrEqual(12);
    expect(maxColumnBright, 'bright pixels in one stone column').toBeLessThanOrEqual(12);
  });

  test('every map places the shared stone_floor GID', () => {
    for (const [mapId, builder] of Object.entries(EMBERWATCH_MAP_BUILDERS)) {
      const count = builder().map.ground.filter((gid) => gid === G.STONE_FLOOR).length;
      expect(count, `${mapId} stone_floor cells`).toBeGreaterThan(0);
    }
  });
});

describe('C-552 AC-3/4 — sparse tufts and a warm sand base', () => {
  test('grass tufts stay below three percent and never contaminate authored terrain cells', () => {
    const terrains = engineTerrains();
    const namesByGid = terrainNameByGid(terrains);
    for (const [mapId, builder] of Object.entries(EMBERWATCH_MAP_BUILDERS)) {
      const map = builder().map;
      const terrain = map.ground.map((gid) => namesByGid.get(gid) ?? '');
      const metrics = measureGrassTufts({
        width: map.width,
        height: map.height,
        terrain,
        terrains,
      });
      if (metrics.eligible > 0) {
        expect(metrics.tufts / metrics.eligible, `${mapId} tuft share`).toBeLessThanOrEqual(0.03);
      }
      expect(metrics.contaminated, `${mapId} non-grass tuft contamination`).toBe(0);
    }
  });

  test('sand stays warm and gains enough yellow separation to avoid a mauve read', () => {
    const sand = framePixels('sand.png');
    const red = mean(sand.map((pixel) => pixel.r));
    const green = mean(sand.map((pixel) => pixel.g));
    const blue = mean(sand.map((pixel) => pixel.b));
    expect(red - green, 'sand red-green separation').toBeGreaterThanOrEqual(15);
    expect(red - green, 'sand red-green separation').toBeLessThanOrEqual(30);
    expect(green - blue, 'sand green-blue separation').toBeGreaterThanOrEqual(60);
  });
});

describe('C-552 AC-5 — all five collision layers retain C-550 identity', () => {
  test('committed collision-layer digests and builder arrays are unchanged', () => {
    for (const [mapId, builder] of Object.entries(EMBERWATCH_MAP_BUILDERS)) {
      const parsed: unknown = JSON.parse(
        readFileSync(join(mapsDirectory, `${mapId}.json`), 'utf8'),
      );
      const committed = readCollisionLayer(parsed);
      const built = builder().map;
      expect(committed.digest, `${mapId} collision digest`).toBe(BASELINE_COLLISION_SHA256[mapId]);
      expect(built.width, `${mapId} collision width`).toBe(committed.width);
      expect(built.height, `${mapId} collision height`).toBe(committed.height);
      expect(built.collision, `${mapId} collision data`).toEqual(committed.data);
    }
  });
});
