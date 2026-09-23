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
import { buildG, readManifestTiles } from './generate_emberwatch_tables.ts';

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
// Bridge assembly (C-546)
// ---------------------------------------------------------------------------

/** Which way a crossing is travelled. */
export type BridgeAxis = 'ns' | 'ew';

/**
 * Bridge frame name per assembly role. The legacy `bridge.png` (GID 42) is the
 * north–south deck interior — kept, not renumbered; the rest are appended
 * frames. GIDs are resolved from `manifest.tiles` below, so the manifest stays
 * the single GID↔frame source of truth.
 */
const BRIDGE_FRAME_NAMES = {
  deckNs: 'bridge.png',
  deckEw: 'bridge_deck_ew.png',
  railW: 'bridge_rail_w.png',
  railE: 'bridge_rail_e.png',
  railN: 'bridge_rail_n.png',
  railS: 'bridge_rail_s.png',
  endN: 'bridge_end_n.png',
  endS: 'bridge_end_s.png',
  endW: 'bridge_end_w.png',
  endE: 'bridge_end_e.png',
  cornerNwNs: 'bridge_corner_nw_ns.png',
  cornerNeNs: 'bridge_corner_ne_ns.png',
  cornerSwNs: 'bridge_corner_sw_ns.png',
  cornerSeNs: 'bridge_corner_se_ns.png',
  cornerNwEw: 'bridge_corner_nw_ew.png',
  cornerNeEw: 'bridge_corner_ne_ew.png',
  cornerSwEw: 'bridge_corner_sw_ew.png',
  cornerSeEw: 'bridge_corner_se_ew.png',
} as const;

/** A bridge assembly role. */
export type BridgeFrameRole = keyof typeof BRIDGE_FRAME_NAMES;

/** role → GID, resolved from the manifest. Throws if a frame is undeclared. */
export const BRIDGE_FRAMES: Record<BridgeFrameRole, number> = (() => {
  const gidByFrame = new Map<string, number>();
  for (const [gid, def] of Object.entries(readManifestTiles())) {
    if (def.frame) {
      gidByFrame.set(def.frame, Number(gid));
    }
  }
  const result = {} as Record<BridgeFrameRole, number>;
  for (const [role, frame] of Object.entries(BRIDGE_FRAME_NAMES)) {
    const gid = gidByFrame.get(frame);
    if (gid === undefined) {
      throw new Error(
        `emberwatch_authoring: manifest.tiles has no bridge frame "${frame}" (for ${role})`,
      );
    }
    result[role as BridgeFrameRole] = gid;
  }
  return result;
})();

/** Every bridge-assembly GID (legacy + appended frames). */
export const BRIDGE_GIDS: ReadonlySet<number> = new Set(Object.values(BRIDGE_FRAMES));

/**
 * True when a ground GID belongs to the bridge assembly. Every reader that used
 * to compare against the single `G.BRIDGE` must use this instead — a span now
 * draws end/rail/corner frames as well as the deck interior.
 */
export const isBridgeGid = (gid: number): boolean => BRIDGE_GIDS.has(gid);

/**
 * Corner role lookup, indexed by `(west ? 1 : 0) | (north ? 2 : 0)` so the
 * four quadrants read as data instead of a branch ladder.
 */
const BRIDGE_CORNER_ROLES: Record<
  BridgeAxis,
  readonly [BridgeFrameRole, BridgeFrameRole, BridgeFrameRole, BridgeFrameRole]
> = {
  ns: ['cornerSeNs', 'cornerSwNs', 'cornerNeNs', 'cornerNwNs'],
  ew: ['cornerSeEw', 'cornerSwEw', 'cornerNeEw', 'cornerNwEw'],
};

/** Corner role for a cell on both the travel end and a long side. */
const bridgeCornerRole = (axis: BridgeAxis, west: boolean, north: boolean): BridgeFrameRole =>
  BRIDGE_CORNER_ROLES[axis][(west ? 1 : 0) | (north ? 2 : 0)];

/** End role for a cell on the travel edge only. */
const bridgeEndRole = (
  axis: BridgeAxis,
  c: number,
  r: number,
  c0: number,
  r0: number,
): BridgeFrameRole => {
  if (axis === 'ns') {
    return r === r0 ? 'endN' : 'endS';
  }
  return c === c0 ? 'endW' : 'endE';
};

/** Rail role for a cell on a long side only. */
const bridgeRailRole = (
  axis: BridgeAxis,
  c: number,
  r: number,
  c0: number,
  r0: number,
): BridgeFrameRole => {
  if (axis === 'ns') {
    return c === c0 ? 'railW' : 'railE';
  }
  return r === r0 ? 'railN' : 'railS';
};

/** Picks the bridge role for a span cell from its position and travel axis. */
const bridgeRoleForCell = (options: {
  axis: BridgeAxis;
  c: number;
  r: number;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}): BridgeFrameRole => {
  const { axis, c, r, c0, r0, c1, r1 } = options;
  const onEnd = axis === 'ns' ? r === r0 || r === r1 : c === c0 || c === c1;
  const onSide = axis === 'ns' ? c === c0 || c === c1 : r === r0 || r === r1;
  if (onEnd && onSide) {
    return bridgeCornerRole(axis, c === c0, r === r0);
  }
  if (onEnd) {
    return bridgeEndRole(axis, c, r, c0, r0);
  }
  if (onSide) {
    return bridgeRailRole(axis, c, r, c0, r0);
  }
  return axis === 'ns' ? 'deckNs' : 'deckEw';
};

/** Ground GID + collision for a span cell. */
const applyBridgeCell = (options: {
  map: MapData;
  axis: BridgeAxis;
  c: number;
  r: number;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}): void => {
  const { map, axis, c, r, c0, r0, c1, r1 } = options;
  setTile(map, c, r, BRIDGE_FRAMES[bridgeRoleForCell({ axis, c, r, c0, r0, c1, r1 })]);
  const index = r * map.width + c;
  if (index >= 0 && index < map.collision.length) {
    map.collision[index] = 0;
  }
};

const isMapCell = (map: MapData, c: number, r: number): boolean =>
  Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < map.width && r >= 0 && r < map.height;

const isWaterGround = (map: MapData, c: number, r: number): boolean =>
  isMapCell(map, c, r) && map.ground[r * map.width + c] === G.WATER;

const isWalkableLand = (map: MapData, c: number, r: number): boolean => {
  if (!isMapCell(map, c, r)) {
    return false;
  }
  const index = r * map.width + c;
  return map.collision[index] === 0 && map.ground[index] !== G.WATER;
};

const formatCells = (cells: ReadonlyArray<[number, number]>): string =>
  cells.map(([c, r]) => `(${c},${r})`).join(', ');

/** Collects the approach-end and long-side cells just outside a span. */
const bridgeBankCells = (options: {
  axis: BridgeAxis;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}): { ends: Array<[number, number]>; sides: Array<[number, number]> } => {
  const { axis, c0, r0, c1, r1 } = options;
  const ends: Array<[number, number]> = [];
  const sides: Array<[number, number]> = [];
  if (axis === 'ns') {
    for (let c = c0; c <= c1; c++) {
      ends.push([c, r0 - 1], [c, r1 + 1]);
    }
    for (let r = r0; r <= r1; r++) {
      sides.push([c0 - 1, r], [c1 + 1, r]);
    }
    return { ends, sides };
  }
  for (let r = r0; r <= r1; r++) {
    ends.push([c0 - 1, r], [c1 + 1, r]);
  }
  for (let c = c0; c <= c1; c++) {
    sides.push([c, r0 - 1], [c, r1 + 1]);
  }
  return { ends, sides };
};

/**
 * Strict bank check: both approach ends must be walkable land and every cell
 * beside a long side must be water. Throws with the map id and the offending
 * cells so an author can fix the crossing at author time.
 */
const assertBridgeBanks = (options: {
  map: MapData;
  axis: BridgeAxis;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  mapId?: string;
}): void => {
  const { map, axis, c0, r0, c1, r1, mapId } = options;
  const name = mapId ?? 'map';
  const { ends, sides } = bridgeBankCells({ axis, c0, r0, c1, r1 });
  const badEnds = ends.filter(([c, r]) => !isWalkableLand(map, c, r));
  if (badEnds.length > 0) {
    throw new Error(
      `emberwatch_authoring.placeBridge: ${name} bridge end(s) at ${formatCells(badEnds)} ` +
        'are not walkable land — a crossing must meet land at both travel ends',
    );
  }
  const badSides = sides.filter(([c, r]) => !isWaterGround(map, c, r));
  if (badSides.length > 0) {
    throw new Error(
      `emberwatch_authoring.placeBridge: ${name} bridge side(s) at ${formatCells(badSides)} ` +
        'are not water — rails belong over the channel',
    );
  }
};

/**
 * Authors a crossing as ONE structure. Every span cell gets a frame chosen by
 * its position (deck interior / long side rail / travel end abutment / corner)
 * and the span's travel axis; collision is cleared on exactly those cells and
 * water outside the span stays blocked. The footprint is identical to the
 * per-cell stamp it replaces, so saves and navigation are unaffected.
 *
 * `assertBanks` (default true) throws at author time when an approach end is
 * not walkable land or a long side is not water. C-549 moved the village
 * crossing off the stream's inside corner onto the straight E–W reach, so both
 * Emberwatch crossings now satisfy the strict check and no call site opts out.
 */
export const placeBridge = (
  map: MapData,
  options: {
    region: Region;
    axis: BridgeAxis;
    /** Name used in validation errors (`MapData` carries no id). */
    mapId?: string;
    assertBanks?: boolean;
  },
): void => {
  const c0 = Math.min(options.region.c0, options.region.c1);
  const c1 = Math.max(options.region.c0, options.region.c1);
  const r0 = Math.min(options.region.r0, options.region.r1);
  const r1 = Math.max(options.region.r0, options.region.r1);
  if (!isMapCell(map, c0, r0) || !isMapCell(map, c1, r1)) {
    const name = options.mapId ?? 'map';
    throw new Error(
      `emberwatch_authoring.placeBridge: ${name} span endpoints (${c0},${r0}) and (${c1},${r1}) ` +
        `must be inside the ${map.width}×${map.height} map`,
    );
  }
  if (c1 - c0 < 1 || r1 - r0 < 1) {
    throw new Error(
      `emberwatch_authoring.placeBridge: a span must be at least 2×2 (got ${c1 - c0 + 1}×${r1 - r0 + 1})`,
    );
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      applyBridgeCell({ map, axis: options.axis, c, r, c0, r0, c1, r1 });
    }
  }
  if (options.assertBanks ?? true) {
    assertBridgeBanks({ map, axis: options.axis, c0, r0, c1, r1, mapId: options.mapId });
  }
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
