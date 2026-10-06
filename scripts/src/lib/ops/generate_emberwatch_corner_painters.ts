// scripts/src/lib/ops/generate_emberwatch_corner_painters.ts
//
// C-552 corner16 material routing. Keeping the painter table beside the
// extracted terrain module keeps the atlas packer focused on frame packing.

import { paintGrass } from './generate_emberwatch_grass_frames.ts';
import {
  CORNER_TERRAIN_SEEDS,
  paintCobble,
  paintCornerFrame,
  paintDirt,
  paintDirtFringe,
  paintSand,
  paintStoneFloor,
  paintWater,
  paintWaterUnderlay,
  paintWoodFloor,
  type TerrainPaint,
} from './generate_emberwatch_terrain_frames.ts';

type CornerPainters = {
  base: TerrainPaint;
  overlay: TerrainPaint;
  fringe: TerrainPaint;
  seed: number;
};

const CORNER_PAINTERS: Readonly<Record<string, CornerPainters>> = {
  dirt: {
    base: paintGrass,
    overlay: paintDirt,
    fringe: paintDirtFringe,
    seed: CORNER_TERRAIN_SEEDS.dirt,
  },
  water: {
    base: paintWaterUnderlay,
    overlay: paintWater,
    fringe: paintWaterUnderlay,
    seed: CORNER_TERRAIN_SEEDS.water,
  },
  gravel: {
    base: paintGrass,
    overlay: paintSand,
    fringe: paintSand,
    seed: CORNER_TERRAIN_SEEDS.gravel,
  },
  earth: {
    base: paintGrass,
    overlay: paintStoneFloor,
    fringe: paintStoneFloor,
    seed: CORNER_TERRAIN_SEEDS.earth,
  },
  cobblestone: {
    base: paintWoodFloor,
    overlay: paintCobble,
    fringe: paintCobble,
    seed: CORNER_TERRAIN_SEEDS.cobblestone,
  },
  path: {
    base: paintGrass,
    overlay: paintCobble,
    fringe: paintCobble,
    seed: CORNER_TERRAIN_SEEDS.path,
  },
};

/** Paints a registered terrain mask; returns false for non-corner frame keys. */
export const paintTerrainCornerFrame = (options: {
  terrainName: string;
  col: number;
  row: number;
  mask: number;
}): boolean => {
  const painters = CORNER_PAINTERS[options.terrainName];
  if (!painters || options.mask < 0 || options.mask >= 16) {
    return false;
  }
  paintCornerFrame({
    col: options.col,
    row: options.row,
    mask: options.mask,
    base: painters.base,
    overlay: painters.overlay,
    fringe: painters.fringe,
    seed: painters.seed,
  });
  return true;
};
