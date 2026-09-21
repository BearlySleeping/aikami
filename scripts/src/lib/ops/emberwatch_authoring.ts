// scripts/src/lib/ops/emberwatch_authoring.ts
//
// Semantic authoring API for the Emberwatch maps.
//
// What this is: a small, readable surface over the existing deterministic map
// builders. It consolidates the primitives an author (human or LLM) needs —
// terrain regions, paths, water, decoration, collision, and named object
// placements — and speaks in CELL coordinates so a natural-language statement
// like "move the inn two cells east" maps to an obvious numeric edit.
//
// What this is NOT: a second map model, a region/biome compiler, or a runtime
// concept. `docs/architecture/semantic_map_authoring.md` records the maintainer
// decision (foundation now; compiler later). These primitives compile
// deterministically into the SAME `MapData` + object layers the builders have
// always produced, and `generate_emberwatch_maps.ts` still serializes those to
// the committed Tiled JSON. The renderer never sees an authoring-only concept.
//
// Locked vs polishable (see `emberwatch_locked_identity.ts`):
//   LOCKED      map ids, transition ids/targets, spawn/npc/prop ids, dialogue
//               keys, story/evidence object ids, quest ids.
//   POLISHABLE  x/y, terrain shape, path geometry, prop frame, render size,
//               anchor, shadow, decoration, tree density, building footprint,
//               non-gameplay clutter, NPC position that preserves semantics.

import {
  block,
  blockRect,
  fillRect,
  type MapData,
  makeMap,
  makeRng,
  npc,
  OLD_ROAD_ARRIVAL,
  prop,
  scatter,
  setTile,
  spawn,
  transition,
} from './emberwatch_map_shared.ts';
import { buildG } from './generate_emberwatch_tables.ts';

export type { MapData, MapObjectLayer, SpawnObject } from './emberwatch_map_shared.ts';

/** World pixels per authored cell. The Emberwatch ground grid is 32px. */
export const CELL_SIZE = 32;

/** Convert a cell count to world pixels. */
export const cell = (n: number): number => n * CELL_SIZE;

export { block, blockRect, fillRect, makeMap, makeRng, scatter, setTile };

/** The Emberwatch solidity/GID table, derived from `manifest.json`. */
export const G = buildG();

// ---------------------------------------------------------------------------
// Geometry primitives (regions, paths, water, collision, decoration)
// ---------------------------------------------------------------------------

/** A half-open-inclusive cell rectangle, authored the way a tile map reads. */
export type Region = {
  /** Left column (inclusive). */
  c0: number;
  /** Top row (inclusive). */
  r0: number;
  /** Right column (inclusive). */
  c1: number;
  /** Bottom row (inclusive). */
  r1: number;
};

/** Fill a rectangular region with a ground GID (grass, floor, path, …). */
export const terrainRegion = (map: MapData, region: Region, gid: number): void => {
  fillRect(map, region.c0, region.r0, region.c1, region.r1, gid);
};

/**
 * Lay a water region: water tiles plus matching solidity. Water is never a
 * decoration — a crossing must be authored explicitly with `terrainRegion`
 * over the channel plus a collision clear.
 */
export const waterRegion = (map: MapData, region: Region): void => {
  terrainRegion(map, region, G.WATER);
  blockRect(map, region.c0, region.r0, region.c1, region.r1);
};

/**
 * Set or clear collision across a region. `blocked` defaults to true; pass
 * false to carve a doorway or a bridge crossing.
 */
export const collisionRegion = (map: MapData, region: Region, blocked = true): void => {
  for (let r = region.r0; r <= region.r1; r++) {
    for (let c = region.c0; c <= region.c1; c++) {
      if (blocked) {
        block(map, c, r);
      } else {
        const index = r * map.width + c;
        if (index >= 0 && index < map.collision.length) {
          map.collision[index] = 0;
        }
      }
    }
  }
};

/** A single decorative ground cell (a rug, a scatter variant, a puddle). */
export const decor = (map: MapData, c: number, r: number, gid: number): void => {
  setTile(map, c, r, gid);
};

/**
 * An axis-aligned path corridor, `width` cells across, centred on its line.
 *
 * `from`/`to` name the inclusive centre line; the corridor extends
 * `floor((width-1)/2)` cells before and `ceil((width-1)/2)` after it, so a
 * width-3 path has one cell on the centre and one either side. Only one axis
 * may vary — a diagonal "path" is not a path.
 */
export const path = (options: {
  map: MapData;
  from: { c: number; r: number };
  to: { c: number; r: number };
  gid: number;
  width?: number;
}): void => {
  const { map, from, to, gid } = options;
  const width = options.width ?? 1;
  if (width < 1) {
    throw new Error(`emberwatch_authoring.path: width must be >= 1 (got ${width})`);
  }
  const before = Math.floor((width - 1) / 2);
  const after = Math.ceil((width - 1) / 2);
  const varyingC = from.c !== to.c;
  const varyingR = from.r !== to.r;
  if (varyingC && varyingR) {
    throw new Error(
      `emberwatch_authoring.path: a path must be axis-aligned (from ${from.c},${from.r} to ${to.c},${to.r})`,
    );
  }
  // `fillRect(map, c0, r0, c1, r1, gid)`: columns first, then rows.
  if (varyingC) {
    fillRect(
      map,
      Math.min(from.c, to.c),
      from.r - before,
      Math.max(from.c, to.c),
      from.r + after,
      gid,
    );
    return;
  }
  if (varyingR) {
    fillRect(
      map,
      from.c - before,
      Math.min(from.r, to.r),
      from.c + after,
      Math.max(from.r, to.r),
      gid,
    );
    return;
  }
  // Degenerate: a single cell.
  fillRect(map, from.c - before, from.r - before, from.c + after, from.r + after, gid);
};

// ---------------------------------------------------------------------------
// Object placements
// ---------------------------------------------------------------------------

/** Extra authored property on a placement (kept for vendor/affordance data). */
export type AuthoredProperty = { name: string; type: string; value: unknown };

/** Semantic prop ids authored through {@link placeLandmark}. */
export const EMBERWATCH_LANDMARK_PROP_IDS: ReadonlySet<string> = new Set([
  'village_well',
  'notice_board',
  'village_gate',
  'ward_tree_landmark',
  'road_notice',
  'ward_socket',
  'shrine_arch',
]);

/**
 * Place a prop at a cell. `frame` is a logical frame name resolved through the
 * installed pack lock; logical size/anchor/shadow live in the manifest prop
 * table, not here (see `sync_emberwatch_props.ts`).
 */
export const placeProp = (
  id: number,
  propId: string,
  propName: string,
  frame: string,
  c: number,
  r: number,
  extra: AuthoredProperty[] = [],
) => prop(id, propId, propName, frame, cell(c), cell(r), extra);

/** Place an NPC at a cell. `npcId` and `dialogueKey` are locked identities. */
export const placeNpc = (
  id: number,
  npcId: string,
  npcName: string,
  dialogueKey: string,
  c: number,
  r: number,
  extra: AuthoredProperty[] = [],
) => npc(id, npcId, npcName, dialogueKey, cell(c), cell(r), extra);

/**
 * Place a landmark (a prop whose composition role is a landmark). Same wire
 * shape as `placeProp`; the distinct name keeps intent readable.
 */
export const placeLandmark = (
  id: number,
  propId: string,
  propName: string,
  frame: string,
  c: number,
  r: number,
  extra: AuthoredProperty[] = [],
) => {
  if (!EMBERWATCH_LANDMARK_PROP_IDS.has(propId)) {
    throw new Error(`Unknown Emberwatch landmark prop id: ${propId}`);
  }
  return placeProp(id, propId, propName, frame, c, r, extra);
};

/** Place a named arrival spawn marker at a cell. */
export const placeSpawn = (id: number, spawnId: string, c: number, r: number) =>
  spawn(id, spawnId, cell(c), cell(r));

/** Place a transition trigger. Source geometry is authored in cells. */
export const placeTransition = (options: {
  id: number;
  targetMap: string;
  targetSpawnId: string;
  /** Numeric fallback landing point, in WORLD PIXELS (may be sub-cell). */
  target: { x: number; y: number };
  /** Trigger rectangle, in cells. */
  at: { c: number; r: number; width: number; height: number };
}) =>
  transition(
    options.id,
    options.targetMap,
    options.targetSpawnId,
    options.target.x,
    options.target.y,
    cell(options.at.c),
    cell(options.at.r),
    cell(options.at.width),
    cell(options.at.height),
  );

export { OLD_ROAD_ARRIVAL };

// ---------------------------------------------------------------------------
// Locked vs polishable classification
// ---------------------------------------------------------------------------

/**
 * Object-layer property names whose change alters gameplay identity, a save
 * reference, or a transition graph edge. A visual-polish edit must not change
 * these; the identity guard fails loudly when one moves.
 */
export const LOCKED_OBJECT_PROPERTY_KEYS = [
  'propId',
  'npcId',
  'spawnId',
  'dialogueKey',
  'targetMap',
  'targetSpawnId',
  'isVendor',
  'vendorInventory',
  'affordanceId',
] as const;

/** Object-layer property names a polish pass may change freely. */
export const POLISHABLE_OBJECT_PROPERTY_KEYS = ['frame', 'propName', 'interactionRadius'] as const;

/** The five Emberwatch map ids — locked by saves and transitions. */
export const EMBERWATCH_MAP_IDS = [
  'village',
  'inn',
  'merchant_shop',
  'old_road',
  'ruined_shrine',
] as const;

export type EmberwatchMapId = (typeof EMBERWATCH_MAP_IDS)[number];
