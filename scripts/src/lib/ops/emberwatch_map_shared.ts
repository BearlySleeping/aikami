// scripts/src/lib/ops/emberwatch_map_shared.ts
//
// Shared helpers for the Emberwatch map builders (gate 3 resize).
//
// The retained scenes were expanded to the plan's proposed extents
// (village 64×48, inn 28×20, merchant_shop 24×18). The builders live in
// their own modules to stay within the source-size budget; this module
// owns the geometry and object constructors they share.

import { buildG } from './generate_emberwatch_tables.ts';

const G = buildG();

export type MapData = {
  width: number;
  height: number;
  ground: number[];
  collision: number[];
  overheadExtra?: Array<[col: number, row: number, gid: number]>;
  terrainOverrides?: Array<[col: number, row: number, terrain: string]>;
};

export type SpawnObject = {
  id: number;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Array<{ name: string; type: string; value: unknown }>;
};

export type MapObjectLayer = {
  name: string;
  type: string;
  visible: boolean;
  objects: SpawnObject[];
};

/** Deterministic PRNG (mulberry32). */
export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const makeMap = (width: number, height: number): MapData => ({
  width,
  height,
  ground: new Array<number>(width * height).fill(G.GRASS),
  collision: new Array<number>(width * height).fill(0),
});

export const idx = (m: MapData, col: number, row: number): number => row * m.width + col;

export const setTile = (m: MapData, col: number, row: number, gid: number): void => {
  if (col < 0 || col >= m.width || row < 0 || row >= m.height) {
    return;
  }
  m.ground[idx(m, col, row)] = gid;
};

export const fillRect = (
  m: MapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  gid: number,
): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      setTile(m, c, r, gid);
    }
  }
};

export const block = (m: MapData, col: number, row: number): void => {
  if (col < 0 || col >= m.width || row < 0 || row >= m.height) {
    return;
  }
  m.collision[idx(m, col, row)] = 1;
};

export const blockRect = (m: MapData, c0: number, r0: number, c1: number, r1: number): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      block(m, c, r);
    }
  }
};

/**
 * Scatters `gid` across cells currently holding `baseGid`, using a
 * deterministic mask. `baseGid` is explicit so variant tiles apply to the
 * actual interior floor instead of hard-coding a base that silently no-ops.
 */
export const scatter = (
  m: MapData,
  rng: () => number,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  baseGid: number,
  gid: number,
  probability: number,
): void => {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (m.ground[idx(m, c, r)] === baseGid && rng() < probability) {
        setTile(m, c, r, gid);
      }
    }
  }
};

type GateGaps = {
  /** Gate columns on the north (top) edge, left walkable through row 0. */
  north?: number[];
  /** Gate columns on the south (bottom) edge, left walkable through row H-1. */
  south?: number[];
  /** Gate rows on the west (left) edge, left walkable through col 0. */
  west?: number[];
  /** Gate rows on the east (right) edge, left walkable through col W-1. */
  east?: number[];
};

/**
 * Draws a stone border wall with a one-tile wall-top rim and carves the
 * given gate gaps down to walkable path. Gate columns/rows keep the rim
 * and collision open so an actor can pass through.
 */
export const border = (m: MapData, gaps: GateGaps = {}): void => {
  const { width: W, height: H } = m;
  const north = new Set(gaps.north ?? []);
  const south = new Set(gaps.south ?? []);
  const west = new Set(gaps.west ?? []);
  const east = new Set(gaps.east ?? []);

  for (let c = 0; c < W; c++) {
    setTile(m, c, 0, G.STONE_WALL);
    setTile(m, c, H - 1, G.STONE_WALL);
    block(m, c, 0);
    block(m, c, H - 1);
  }
  for (let r = 1; r < H - 1; r++) {
    setTile(m, 0, r, G.STONE_WALL);
    setTile(m, W - 1, r, G.STONE_WALL);
    block(m, 0, r);
    block(m, W - 1, r);
  }

  // Carve north/south gate columns through both border rows they occupy.
  for (const c of north) {
    setTile(m, c, 0, G.PATH);
    m.collision[idx(m, c, 0)] = 0;
  }
  for (const c of south) {
    setTile(m, c, H - 1, G.PATH);
    m.collision[idx(m, c, H - 1)] = 0;
  }
  for (const r of west) {
    setTile(m, 0, r, G.PATH);
    m.collision[idx(m, 0, r)] = 0;
  }
  for (const r of east) {
    setTile(m, W - 1, r, G.PATH);
    m.collision[idx(m, W - 1, r)] = 0;
  }

  // Wall-top rim one tile inside the border, opened at each gate.
  for (let c = 1; c < W - 1; c++) {
    if (!north.has(c)) {
      setTile(m, c, 1, G.WALL_TOP);
      block(m, c, 1);
    }
    if (!south.has(c)) {
      setTile(m, c, H - 2, G.WALL_TOP);
      block(m, c, H - 2);
    }
  }
  for (let r = 2; r < H - 2; r++) {
    if (!west.has(r)) {
      setTile(m, 1, r, G.WALL_TOP);
      block(m, 1, r);
    }
    if (!east.has(r)) {
      setTile(m, W - 2, r, G.WALL_TOP);
      block(m, W - 2, r);
    }
  }
};

/** A standalone prop placement. */
export const prop = (
  id: number,
  propId: string,
  propName: string,
  frame: string,
  x: number,
  y: number,
  extra: Array<{ name: string; type: string; value: unknown }> = [],
): SpawnObject => ({
  id,
  type: 'prop',
  x,
  y,
  width: 0,
  height: 0,
  properties: [
    { name: 'propId', type: 'string', value: propId },
    { name: 'propName', type: 'string', value: propName },
    { name: 'frame', type: 'string', value: frame },
    ...extra,
  ],
});

/** An NPC placement. */
export const npc = (
  id: number,
  npcId: string,
  npcName: string,
  dialogueKey: string,
  x: number,
  y: number,
  extra: Array<{ name: string; type: string; value: unknown }> = [],
): SpawnObject => ({
  id,
  type: 'npc',
  x,
  y,
  width: 0,
  height: 0,
  properties: [
    { name: 'npcId', type: 'string', value: npcId },
    { name: 'npcName', type: 'string', value: npcName },
    { name: 'dialogueKey', type: 'string', value: dialogueKey },
    { name: 'interactionRadius', type: 'int', value: 48 },
    ...extra,
  ],
});

/** A named arrival spawn marker. */
export const spawn = (id: number, spawnId: string, x: number, y: number): SpawnObject => ({
  id,
  type: 'spawn',
  x,
  y,
  width: 0,
  height: 0,
  properties: [{ name: 'spawnId', type: 'string', value: spawnId }],
});

/**
 * A map transition. `targetX`/`targetY` are required by the loader even when
 * `targetSpawnId` is present (the spawn marker wins at runtime; the numeric
 * pair is the fallback).
 */
export const transition = (
  id: number,
  targetMap: string,
  targetSpawnId: string,
  targetX: number,
  targetY: number,
  x: number,
  y: number,
  width: number,
  height: number,
): SpawnObject => ({
  id,
  type: 'transition',
  x,
  y,
  width,
  height,
  properties: [
    { name: 'targetMap', type: 'string', value: targetMap },
    { name: 'targetX', type: 'int', value: targetX },
    { name: 'targetY', type: 'int', value: targetY },
    { name: 'targetSpawnId', type: 'string', value: targetSpawnId },
  ],
});
