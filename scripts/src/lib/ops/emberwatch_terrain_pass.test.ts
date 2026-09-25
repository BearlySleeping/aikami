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
import {
  autotileLayers,
  resolveTerrainGrid,
} from '../../../../packages/frontend/engine/src/assets/autotile.ts';
import { G } from './emberwatch_authoring.ts';
import { packAtlas } from './generate_emberwatch_atlas.ts';
import { buildMapJson, EMBERWATCH_MAP_BUILDERS } from './generate_emberwatch_maps.ts';
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

const CORNER_TERRAINS = ['dirt', 'water', 'gravel', 'earth', 'cobblestone', 'path'] as const;
const RESERVED_CORNER_TERRAINS = ['dirt', 'water', 'gravel', 'earth', 'cobblestone'] as const;
const INTERIOR_MAP_IDS = ['inn', 'merchant_shop'] as const;
const OUTDOOR_MAP_IDS = ['village', 'old_road', 'ruined_shrine'] as const;

/** Endpoint material means used to classify real intermediate pixels. */
const CLASSIFICATION_FRAMES = {
  dirt: { base: 'dirt_0.png', overlay: 'dirt_15.png' },
  water: { base: 'water_0.png', overlay: 'water_15.png' },
  gravel: { base: 'gravel_0.png', overlay: 'gravel_15.png' },
  earth: { base: 'earth_0.png', overlay: 'earth_15.png' },
  cobblestone: { base: 'cobblestone_0.png', overlay: 'cobblestone_15.png' },
  path: { base: 'path_0.png', overlay: 'path_15.png' },
} as const;

// C-552 leaves the four retained-map collision layers unchanged. C-553 then
// adds the explicit village-house delta; its village digest is the post-C-553
// value, not a loosened C-552 baseline.
const EXPECTED_COLLISION_SHA256: Readonly<Record<string, string>> = {
  inn: 'e0334e3d214c755173a637245b00ee037e186b559c8726029af7b86b4817260d',
  merchant_shop: '11d9b9b16de7ac3cd6cf83edd16258131e75efc94b96dcef69ac8218337c91a6',
  old_road: '83bb92ecf8def467fc1271b61f7f7f3d4a15bc2620ae2f972b20065399b97db9',
  ruined_shrine: '16b8b021c07f0c91abe7dc2dd4bd95d499d88aa343d74d9c3ab686a2fffc5a7f',
  village: '09d2397f021163a6e6dac712d9d732489452848865ae0c18ca90cddfde209ffc',
} as const;

/** Origin/main visual-layer fingerprints, excluding atlas capacity metadata. */
const EXPECTED_INTERIOR_VISUAL_SHA256: Readonly<Record<string, string>> = {
  inn: '230afdedb957a1f0c76027360c1501e9c3b1ee46cfb132cd0124fc3aa8277a0e',
  merchant_shop: '6c55295cfc8beccfff53aa828b3fce4bc025bbb3c48a28b34ee9f1ed455836b9',
} as const;

type GrassTuftMetrics = { eligible: number; tufts: number; contaminated: number; excluded: number };

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
  const terrainNames = new Set(terrains.map((terrain) => terrain.name));
  const variantOwners = new Map<string, string>();
  for (const terrain of terrains) {
    for (const frame of terrain.variants ?? []) {
      variantOwners.set(frame, terrain.name);
    }
  }
  const result = new Map<number, string>();
  for (const [gid, tile] of Object.entries(readManifestTiles())) {
    const terrainName = terrainNames.has(tile.name) ? tile.name : variantOwners.get(tile.frame);
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
  const resolved = resolveTerrainGrid({
    width: options.width,
    height: options.height,
    terrain: options.terrain,
    terrains: options.terrains,
  });
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
  let excluded = 0;
  for (let index = 0; index < options.terrain.length; index++) {
    if (options.terrain[index] === 'grass') {
      eligible += 1;
      if (base.frames[index] === 'grass_variant.png') {
        tufts += 1;
      }
      continue;
    }
    if (base.frames[index] === 'grass_variant.png') {
      contaminated += 1;
      if (resolved.cells[index] === 0) {
        excluded += 1;
      }
    }
  }
  return { eligible, tufts, contaminated, excluded };
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

/** Matches the green-dominant hue band used by the grass material. */
const isGrassHue = (pixel: Pixel): boolean => pixel.g - pixel.r >= 20 && pixel.g - pixel.b >= 20;

const localContrastP95 = (pixels: readonly Pixel[]): number => {
  const contrast: number[] = [];
  for (const pixel of pixels) {
    const right = pixel.x + 1 < TILE ? pixels[pixel.y * TILE + pixel.x + 1] : undefined;
    const below = pixel.y + 1 < TILE ? pixels[(pixel.y + 1) * TILE + pixel.x] : undefined;
    if (right) {
      contrast.push(Math.abs(luminance(pixel) - luminance(right)));
    }
    if (below) {
      contrast.push(Math.abs(luminance(pixel) - luminance(below)));
    }
  }
  return percentile(contrast, 0.95);
};

type SeamStats = {
  pairCount: number;
  classMismatches: number;
  lumaDeltaSum: number;
  lumaDeltaCount: number;
};

type BoundaryProfile = {
  values: number[];
  monotonicRun: number;
  maxLagCorrelation: number;
};

/** Picks the material boundary nearest the middle of the inspected band. */
const transitionProfile = (options: {
  classification: readonly number[];
  width: number;
  height: number;
  centerY: number;
  rowLimit: number;
}): number[] => {
  const { classification, width, height, centerY, rowLimit } = options;
  const profile: number[] = [];
  const limit = Math.min(height, rowLimit);
  for (let x = 0; x < width; x++) {
    const transitions: number[] = [];
    for (let y = 1; y < limit; y++) {
      if (classification[y * width + x] !== classification[(y - 1) * width + x]) {
        transitions.push(y);
      }
    }
    const nearest = transitions.sort(
      (left, right) => Math.abs(left - centerY) - Math.abs(right - centerY),
    )[0];
    if (nearest !== undefined) {
      profile.push(nearest);
    }
  }
  return profile;
};

/** Longest same-direction run with small steps: a triangular fringe signature. */
const longestMonotonicRun = (values: readonly number[]): number => {
  let longest = 0;
  let run = 0;
  let previousSign = 0;
  for (let index = 1; index < values.length; index++) {
    const difference = (values[index] ?? 0) - (values[index - 1] ?? 0);
    const sign = Math.sign(difference);
    if (sign === 0 || Math.abs(difference) > 2) {
      run = 0;
      previousSign = 0;
      continue;
    }
    run = sign === previousSign ? run + 1 : 1;
    previousSign = sign;
    longest = Math.max(longest, run);
  }
  return longest;
};

const maxLagCorrelation = (values: readonly number[]): number => {
  if (values.length < 16) {
    return 0;
  }
  const average = mean(values);
  let maximum = 0;
  for (let lag = 4; lag < Math.min(16, values.length); lag++) {
    let numerator = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index + lag < values.length; index++) {
      const left = (values[index] ?? average) - average;
      const right = (values[index + lag] ?? average) - average;
      numerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    if (leftEnergy > 0 && rightEnergy > 0) {
      maximum = Math.max(maximum, Math.abs(numerator / Math.sqrt(leftEnergy * rightEnergy)));
    }
  }
  return maximum;
};

const measureBoundaryProfile = (values: readonly number[]): BoundaryProfile => ({
  values: [...values],
  monotonicRun: longestMonotonicRun(values),
  maxLagCorrelation: maxLagCorrelation(values),
});

/** Longest exact axis-aligned class boundary in a rendered placed composite. */
const maxAxisAlignedBoundaryRun = (
  classification: number[],
  width: number,
  height: number,
): number => {
  let longest = 0;
  for (let x = 1; x < width; x++) {
    let run = 0;
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (classification[index] !== classification[index - 1]) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
  }
  for (let y = 1; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (classification[index] !== classification[index - width]) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
  }
  return longest;
};

type TerrainLayer = ReturnType<typeof autotileLayers>[number];

const selectedFrameForCell = (layers: readonly TerrainLayer[], cellIndex: number): string => {
  let frame = 'grass.png';
  for (const layer of layers) {
    const candidate = layer.frames[cellIndex];
    if (typeof candidate === 'string') {
      frame = candidate;
    }
  }
  return frame;
};

const writeCompositeCell = (options: {
  frame: string;
  cellX: number;
  cellY: number;
  size: number;
  classification: number[];
  base: Rgb;
  overlay: Rgb;
}): void => {
  const pixels = framePixels(options.frame);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const pixel = pixels[y * TILE + x];
      if (!pixel) {
        continue;
      }
      const index = (options.cellY * TILE + y) * options.size + options.cellX * TILE + x;
      options.classification[index] =
        colorDistance(pixel, options.overlay) < colorDistance(pixel, options.base) ? 1 : 0;
    }
  }
};

/** Composites the exact terrain layers selected for placed map cells. */
const renderActualComposite = (options: {
  width: number;
  height: number;
  terrain: string[];
  terrains: ReturnType<typeof engineTerrains>;
  originX: number;
  originY: number;
  cells: number;
  base: Rgb;
  overlay: Rgb;
}): number[] => {
  const layers = autotileLayers({
    width: options.width,
    height: options.height,
    terrain: options.terrain,
    terrains: options.terrains,
  });
  const size = options.cells * TILE;
  const classification = new Array<number>(size * size).fill(0);
  for (let cellY = 0; cellY < options.cells; cellY++) {
    for (let cellX = 0; cellX < options.cells; cellX++) {
      const cellIndex = (options.originY + cellY) * options.width + options.originX + cellX;
      writeCompositeCell({
        frame: selectedFrameForCell(layers, cellIndex),
        cellX,
        cellY,
        size,
        classification,
        base: options.base,
        overlay: options.overlay,
      });
    }
  }
  return classification;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readSemanticTerrain = (mapId: string): string[] => {
  const builder = EMBERWATCH_MAP_BUILDERS[mapId];
  if (!builder) {
    throw new Error(`C-559 missing map builder ${mapId}`);
  }
  const json = buildMapJson({
    semanticMapping: mapId === 'inn' || mapId === 'merchant_shop' ? 'none' : 'outdoor',
    ...builder(),
  }).json;
  if (!isRecord(json) || !isRecord(json.aikami) || !Array.isArray(json.aikami.terrain)) {
    if (mapId !== 'inn' && mapId !== 'merchant_shop') {
      throw new Error(`C-559 outdoor map ${mapId} has no aikami.terrain array`);
    }
    return [];
  }
  return json.aikami.terrain.map((value) => (typeof value === 'string' ? value : ''));
};

const readLayer = (value: unknown, name: string): Record<string, unknown> => {
  if (!isRecord(value) || !Array.isArray(value.layers)) {
    throw new Error('Map JSON has no layers array');
  }
  const layer = value.layers.find((candidate) => isRecord(candidate) && candidate.name === name);
  if (!isRecord(layer)) {
    throw new Error(`Map JSON has no ${name} layer`);
  }
  return layer;
};

const readLayerData = (value: unknown, name: string): number[] => {
  const data = readLayer(value, name).data;
  if (!Array.isArray(data) || !data.every((entry) => typeof entry === 'number')) {
    throw new Error(`${name} layer has invalid data`);
  }
  return data;
};

const visualFingerprint = (value: unknown): string => {
  if (!isRecord(value) || !isRecord(value.aikami)) {
    throw new Error('Map JSON has no aikami metadata');
  }
  const semanticTerrain = Array.isArray(value.aikami.terrain) ? value.aikami.terrain : null;
  const fingerprint = {
    terrain: semanticTerrain,
    ground: readLayer(value, 'ground'),
    decor: readLayer(value, 'decor'),
    overhead: readLayer(value, 'overhead'),
    collision: readLayer(value, 'collision'),
  };
  return createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
};

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

const collectUsedFloorFrames = (): Map<number, string> => {
  const tiles = readManifestTiles();
  const floorGids = new Set(
    Object.entries(tiles)
      .filter(([, tile]) => /^(stone_floor|path_tough|flagstone)/.test(tile.name))
      .map(([gid]) => Number(gid)),
  );
  const usedFrames = new Map<number, string>();
  for (const builder of Object.values(EMBERWATCH_MAP_BUILDERS)) {
    for (const gid of builder().map.ground) {
      if (!floorGids.has(gid)) {
        continue;
      }
      const tile = tiles[String(gid)];
      if (tile) {
        usedFrames.set(gid, tile.frame);
      }
    }
  }
  return usedFrames;
};

describe('C-552 AC-1 — all corner16 cases are organic and seamless', () => {
  for (const terrain of CORNER_TERRAINS) {
    test(`${terrain} transition profiles break periodic triangular fringe runs`, () => {
      const palette = CLASSIFICATION_FRAMES[terrain];
      const base = meanRgb(palette.base);
      const overlay = meanRgb(palette.overlay);
      const profiles: BoundaryProfile[] = [];
      for (let mask = 1; mask < 15; mask++) {
        const values = transitionProfile({
          classification: classifyPixels(`${terrain}_${mask}.png`, base, overlay),
          width: TILE,
          height: TILE,
          centerY: TILE / 2,
          rowLimit: TILE,
        });
        profiles.push(measureBoundaryProfile(values));
      }
      const maxMonotonicRun = Math.max(...profiles.map((profile) => profile.monotonicRun));
      // Isolated frames are audited for their short-period signal; the
      // acceptance threshold below is intentionally applied to placed cells.
      expect(maxMonotonicRun, `${terrain} frame contour extent`).toBeLessThanOrEqual(16);
      for (const profile of profiles) {
        // A long, smooth ramp is not itself a sawtooth. The defect is a
        // near-linear run that also repeats at a sub-tile lag.
        if (profile.values.length >= 16) {
          expect(
            profile.maxLagCorrelation,
            `${terrain} short-period boundary correlation`,
          ).toBeLessThanOrEqual(0.99);
        }
      }
      for (let mask = 0; mask < 16; mask++) {
        expect(
          framePixels(`${terrain}_${mask}.png`).every((pixel) => pixel.a === 255),
          `${terrain}_${mask}.png remains opaque`,
        ).toBe(true);
      }
    });

    test(`${terrain} mask 15 is endpoint-pure across the complete frame`, () => {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          expect(
            cornerCoverageForPixel({
              mask: 15,
              x,
              y,
              seed: CORNER_TERRAIN_SEEDS[terrain],
            }),
            `${terrain} mask 15 coverage at ${x},${y}`,
          ).toBe(1);
        }
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

  test('the actual 3x3 crossing approach supports a non-periodic dirt boundary', () => {
    const map = EMBERWATCH_MAP_BUILDERS.village().map;
    const terrain = readSemanticTerrain('village');
    const terrains = engineTerrains();
    const base = meanRgb('grass.png');
    const overlay = meanRgb('dirt_15.png');
    for (const origin of [{ x: 36, y: 9 }]) {
      const classification = renderActualComposite({
        width: map.width,
        height: map.height,
        terrain,
        terrains,
        originX: origin.x,
        originY: origin.y,
        cells: 3,
        base,
        overlay,
      });
      const values = transitionProfile({
        classification,
        width: TILE * 3,
        height: TILE * 3,
        centerY: TILE * 1.5,
        rowLimit: TILE * 3,
      });
      const profile = measureBoundaryProfile(values);
      const axisAlignedRun = maxAxisAlignedBoundaryRun(classification, TILE * 3, TILE * 3);
      expect(values.length, `crossing ${origin.x},${origin.y} profile samples`).toBeGreaterThan(16);
      expect(
        axisAlignedRun,
        `crossing ${origin.x},${origin.y} straight axis-aligned boundary`,
      ).toBeLessThanOrEqual(32);
      expect(
        profile.monotonicRun,
        `crossing ${origin.x},${origin.y} fringe triangles`,
      ).toBeLessThanOrEqual(8);
      expect(
        profile.maxLagCorrelation,
        `crossing ${origin.x},${origin.y} short-period correlation`,
      ).toBeLessThanOrEqual(0.99);
    }
  });

  test('water corner frames contain no grass-hue pixels', () => {
    for (let mask = 0; mask < 16; mask++) {
      const frame = `water_${mask}.png`;
      const greenPixels = framePixels(frame).filter(isGrassHue);
      expect(greenPixels.length, `${frame} grass-hue pixels`).toBe(0);
    }
  });

  test('the reserved terrain block and appended path family keep every GID pinned', () => {
    const starts = {
      dirt: 48,
      water: 64,
      gravel: 80,
      earth: 96,
      cobblestone: 112,
      path: 176,
    } as const;
    expect(atlas.frames['landing_0.png']).toBeUndefined();
    for (const terrain of [...RESERVED_CORNER_TERRAINS, 'path'] as const) {
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

describe('C-559 semantic terrain edges', () => {
  test('every outdoor baked path, stone, and sand cell owns its corner16 terrain', () => {
    const tiles = readManifestTiles();
    const expectedTerrain = (tileName: string): string | undefined => {
      if (/^path_tough/.test(tileName)) {
        return 'path';
      }
      if (/^(stone_floor|flagstone)/.test(tileName)) {
        return 'earth';
      }
      if (tileName === 'sand') {
        return 'gravel';
      }
      return undefined;
    };
    let checkedCells = 0;
    for (const mapId of OUTDOOR_MAP_IDS) {
      const builder = EMBERWATCH_MAP_BUILDERS[mapId];
      if (!builder) {
        throw new Error(`C-559 missing outdoor map builder ${mapId}`);
      }
      const built = builder();
      const terrain = readSemanticTerrain(mapId);
      const visualCells = [
        ...built.map.ground.map((gid, index) => [index, gid] as const),
        ...(built.map.groundExtra?.map(([column, row, gid]) => [
          row * built.map.width + column,
          gid,
        ]) ?? []),
      ];
      for (const [index, gid] of visualCells) {
        const tileName = tiles[String(gid)]?.name;
        const expected = expectedTerrain(tileName ?? '');
        if (!expected) {
          continue;
        }
        checkedCells++;
        expect(terrain[index], `${mapId} cell ${index} ${tileName}`).toBe(expected);
      }
    }
    expect(checkedCells).toBeGreaterThan(500);
  });

  test('inn and merchant visual layers remain exactly origin/main', () => {
    for (const mapId of INTERIOR_MAP_IDS) {
      const builder = EMBERWATCH_MAP_BUILDERS[mapId];
      if (!builder) {
        throw new Error(`C-559 missing interior map builder ${mapId}`);
      }
      const { json } = buildMapJson({ semanticMapping: 'none', ...builder() });
      expect(visualFingerprint(json), `${mapId} origin/main visual fingerprint`).toBe(
        EXPECTED_INTERIOR_VISUAL_SHA256[mapId],
      );
    }
  });

  test('bridge cells retain origin/main ground and decor ownership without terrain semantics', () => {
    const tiles = readManifestTiles();
    let checkedCells = 0;
    for (const mapId of OUTDOOR_MAP_IDS) {
      const builder = EMBERWATCH_MAP_BUILDERS[mapId];
      if (!builder) {
        throw new Error(`C-559 missing outdoor map builder ${mapId}`);
      }
      const { json } = buildMapJson({ semanticMapping: 'outdoor', ...builder() });
      const ground = readLayerData(json, 'ground');
      const decor = readLayerData(json, 'decor');
      const overhead = readLayerData(json, 'overhead');
      const terrain = readSemanticTerrain(mapId);
      for (const [index, gid] of builder().map.ground.entries()) {
        const tileName = tiles[String(gid)]?.name ?? '';
        if (tileName !== 'bridge' && !tileName.startsWith('bridge_')) {
          continue;
        }
        checkedCells++;
        expect(ground[index], `${mapId} bridge ground ${index}`).toBe(gid);
        expect(decor[index], `${mapId} bridge decor ${index}`).toBe(gid);
        expect(overhead[index], `${mapId} bridge overhead ${index}`).toBe(0);
        expect(terrain[index], `${mapId} bridge terrain ${index}`).toBe('');
      }
    }
    expect(checkedCells).toBeGreaterThan(10);
  });

  test('crossing approach is asymmetric, bridge-aligned, and not the rejected 5x2 slab', () => {
    const { map } = EMBERWATCH_MAP_BUILDERS.village();
    const expectedDirtColumnsByRow = new Map<number, number[]>([
      [9, [36, 37, 38]],
      [10, [37, 38, 39]],
      [11, [38, 39]],
      [12, [39, 40]],
      [13, [39, 40]],
    ]);
    for (const [row, expectedColumns] of expectedDirtColumnsByRow) {
      const dirtColumns: number[] = [];
      for (let column = 35; column <= 40; column++) {
        if (map.ground[row * map.width + column] === G.DIRT) {
          dirtColumns.push(column);
        }
      }
      expect(dirtColumns, `crossing approach row ${row}`).toEqual(expectedColumns);
    }
    for (const bridgeColumn of [36, 37, 38]) {
      expect(map.ground[9 * map.width + bridgeColumn], `bridge column ${bridgeColumn}`).toBe(
        G.DIRT,
      );
    }
    expect(map.ground[9 * map.width + 35]).not.toBe(G.DIRT);
    expect(map.ground[9 * map.width + 40]).not.toBe(G.DIRT);
  });

  test('placed ward-square composites keep the C-552 perceptual boundary bound', () => {
    const map = EMBERWATCH_MAP_BUILDERS.village().map;
    const terrain = readSemanticTerrain('village');
    const terrains = engineTerrains();
    const base = meanRgb('grass.png');
    const overlay = meanRgb('dirt_15.png');
    for (const origin of [
      { x: 27, y: 22 },
      { x: 37, y: 22 },
    ]) {
      const classification = renderActualComposite({
        width: map.width,
        height: map.height,
        terrain,
        terrains,
        originX: origin.x,
        originY: origin.y,
        cells: 3,
        base,
        overlay,
      });
      const values = transitionProfile({
        classification,
        width: TILE * 3,
        height: TILE * 3,
        centerY: TILE / 2,
        rowLimit: TILE,
      });
      const profile = measureBoundaryProfile(values);
      const axisAlignedRun = maxAxisAlignedBoundaryRun(classification, TILE * 3, TILE * 3);
      expect(values.length, `square ${origin.x},${origin.y} profile samples`).toBeGreaterThan(16);
      expect(
        axisAlignedRun,
        `square ${origin.x},${origin.y} straight axis-aligned boundary`,
      ).toBeLessThanOrEqual(32);
      expect(profile.monotonicRun, `square ${origin.x},${origin.y} fringe`).toBeLessThanOrEqual(8);
      expect(
        profile.maxLagCorrelation,
        `square ${origin.x},${origin.y} short-period correlation`,
      ).toBeLessThanOrEqual(0.99);
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
    const localContrast = localContrastP95(stone);

    expect(stoneMean, 'stone mean luminance').toBeGreaterThanOrEqual(108);
    expect(stoneMean, 'stone mean luminance').toBeLessThanOrEqual(124);
    expect(
      Math.abs(stoneMean - terrainFamilyMean),
      'stone vs grass/dirt family mean',
    ).toBeLessThanOrEqual(10);
    expect(p90 - p10, 'stone p90-p10 luminance spread').toBeLessThanOrEqual(22);
    expect(localContrast, 'stone p95 local contrast').toBeLessThanOrEqual(20);
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

  test('outdoor cobble remains shared while interiors use their dedicated floor', () => {
    for (const [mapId, builder] of Object.entries(EMBERWATCH_MAP_BUILDERS)) {
      const ground = builder().map.ground;
      const outdoorCount = ground.filter((gid) => gid === G.STONE_FLOOR).length;
      const indoorFlagstoneCount = ground.filter((gid) => gid === G.STONE_VAR).length;
      const outdoorFlagstoneCount = ground.filter((gid) => gid === G.FLAGSTONE).length;
      if (mapId === 'merchant_shop' || mapId === 'inn') {
        expect(outdoorCount, `${mapId} outdoor stone cells`).toBe(0);
        expect(outdoorFlagstoneCount, `${mapId} outdoor flagstone cells`).toBe(0);
        expect(indoorFlagstoneCount, `${mapId} interior flagstone cells`).toBeGreaterThan(0);
      } else {
        expect(outdoorCount, `${mapId} shared stone_floor cells`).toBeGreaterThan(0);
      }
      if (mapId === 'inn') {
        const woodCount = ground.filter((gid) => gid === G.WOOD_FLOOR || gid === G.WOOD_VAR).length;
        expect(woodCount, `${mapId} common-room wood cells`).toBeGreaterThan(0);
        expect(indoorFlagstoneCount, `${mapId} indoor threshold cells`).toBeGreaterThan(0);
      }
    }
  });

  test('every used stone/cobble floor frame stays within the cobble contrast bound', () => {
    const usedFrames = collectUsedFloorFrames();
    expect(usedFrames.size, 'used stone/cobble frame count').toBeGreaterThan(0);
    for (const [gid, frame] of usedFrames) {
      const contrast = localContrastP95(framePixels(frame));
      expect(contrast, `GID ${gid} ${frame} p95 local contrast`).toBeLessThanOrEqual(20);
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
      expect(metrics.excluded, `${mapId} path/water/sand/bridge tuft exclusions`).toBe(0);
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

describe('C-552/C-553 AC-5 — collision identity is explicit', () => {
  test('pins retained C-550 layers and the intentional C-553 village delta', () => {
    for (const [mapId, builder] of Object.entries(EMBERWATCH_MAP_BUILDERS)) {
      const parsed: unknown = JSON.parse(
        readFileSync(join(mapsDirectory, `${mapId}.json`), 'utf8'),
      );
      const committed = readCollisionLayer(parsed);
      const built = builder().map;
      expect(committed.digest, `${mapId} collision digest`).toBe(EXPECTED_COLLISION_SHA256[mapId]);
      expect(built.width, `${mapId} collision width`).toBe(committed.width);
      expect(built.height, `${mapId} collision height`).toBe(committed.height);
      expect(built.collision, `${mapId} collision data`).toEqual(committed.data);
    }
  });
});
