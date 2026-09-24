// scripts/src/lib/ops/emberwatch_house_authoring.ts
//
// C-550 — deterministic authoring seam for the Emberwatch raised house.
// The helper writes the existing MapData fields and explicit contribution
// lists; it does not introduce a second runtime map model or a transition.

import type { Region } from './emberwatch_authoring.ts';
import { formatCells, isMapCell, isWalkableLand } from './emberwatch_map_authoring_helpers.ts';
import { idx, type MapData, setTile } from './emberwatch_map_shared.ts';
import { buildG, readManifestTiles } from './generate_emberwatch_tables.ts';

const G = buildG();

/** Cardinal side a house door faces. C-550 authors the south-facing slice. */
export type HouseFacing = 'n' | 's' | 'e' | 'w';

/** Long-form side names used by the legacy shell builder and door geometry. */
export type DoorSide = 'north' | 'south' | 'east' | 'west';

/** The two-cell door and landing geometry shared by legacy village shells. */
export type DoorPlacement = {
  doorCells: Array<[number, number]>;
  landingCells: Array<[number, number]>;
};

/** The single-boarded-door geometry used by the exterior-only C-550 hut. */
export type HouseDoorPlacement = {
  doorCells: Array<[number, number]>;
  landingCells: Array<[number, number]>;
};

/** Resolve a door pair and its two-row landing from a footprint. */
export const doorPlacement = (options: {
  c0: number;
  r0: number;
  w: number;
  h: number;
  doorSide: DoorSide;
}): DoorPlacement => {
  const { c0, r0, w, h, doorSide } = options;
  const doorCells: Array<[number, number]> = [];
  const landingCells: Array<[number, number]> = [];
  if (doorSide === 'south' || doorSide === 'north') {
    const doorRow = doorSide === 'south' ? r0 + h - 1 : r0;
    const step = doorSide === 'south' ? 1 : -1;
    const midC = c0 + Math.floor(w / 2);
    for (const c of [midC - 1, midC]) {
      doorCells.push([c, doorRow]);
      landingCells.push([c, doorRow + step], [c, doorRow + step * 2]);
    }
    return { doorCells, landingCells };
  }
  const doorCol = doorSide === 'east' ? c0 + w - 1 : c0;
  const step = doorSide === 'east' ? 1 : -1;
  const midR = r0 + Math.floor(h / 2);
  for (const r of [midR - 1, midR]) {
    doorCells.push([doorCol, r]);
    landingCells.push([doorCol + step, r], [doorCol + step * 2, r]);
  }
  return { doorCells, landingCells };
};

/**
 * Derive the hut's one closed door and its two-row exterior approach.
 *
 * The legacy village shells intentionally retain their wider two-cell door
 * geometry. The C-550 hut has no interior contract, so it gets one boarded
 * leaf and one narrow landing column instead of an implied second entrance.
 */
export const houseDoorPlacement = (options: {
  c0: number;
  r0: number;
  w: number;
  h: number;
  doorSide: DoorSide;
}): HouseDoorPlacement => {
  const { c0, r0, w, h, doorSide } = options;
  if (doorSide !== 'south') {
    throw new Error('houseDoorPlacement currently supports only a south-facing door');
  }
  const doorColumn = c0 + Math.floor(w / 2);
  const doorRow = r0 + h - 1;
  return {
    doorCells: [[doorColumn, doorRow]],
    landingCells: [
      [doorColumn, doorRow + 1],
      [doorColumn, doorRow + 2],
    ],
  };
};

const HOUSE_FRAME_NAMES = {
  roofFront: 'house_roof_front.png',
  roofBack: 'house_roof_back.png',
  roofRidge: 'house_roof_ridge.png',
  roofGableLeft: 'house_roof_gable_left.png',
  roofGableRight: 'house_roof_gable_right.png',
  roofEaveOverhead: 'house_roof_eave_overhead.png',
  roofEaveEdge: 'house_roof_eave_edge.png',
  facadeWall: 'house_facade_wall.png',
  facadeWindow: 'house_facade_window.png',
  facadeCornerLeft: 'house_facade_corner_left.png',
  facadeCornerRight: 'house_facade_corner_right.png',
  doorClosed: 'house_door_closed.png',
  doorOpen: 'house_door_open.png',
  foundation: 'house_foundation.png',
  foundationShadow: 'house_foundation_shadow.png',
} as const;

/** A named role in the C-550 house frame kit. */
export type HouseFrameRole = keyof typeof HOUSE_FRAME_NAMES;

const resolveHouseFrames = (): Record<HouseFrameRole, number> => {
  const gidByFrame = new Map<string, number>();
  for (const [gid, def] of Object.entries(readManifestTiles())) {
    if (def.frame) {
      gidByFrame.set(def.frame, Number(gid));
    }
  }
  const result = {} as Record<HouseFrameRole, number>;
  for (const [role, frame] of Object.entries(HOUSE_FRAME_NAMES)) {
    const gid = gidByFrame.get(frame);
    if (gid === undefined) {
      throw new Error(
        `emberwatch_authoring: manifest.tiles has no house frame "${frame}" (for ${role})`,
      );
    }
    result[role as HouseFrameRole] = gid;
  }
  return result;
};

/** House frame role → manifest GID. Resolved once from the authored manifest. */
export const HOUSE_FRAMES: Readonly<Record<HouseFrameRole, number>> = resolveHouseFrames();

/** The canonical door anchor returned by {@link placeHouse}. */
export type HouseDoorCell = { c: number; r: number };

type HouseCellRole = {
  layer: 'ground' | 'overhead';
  gid: number;
  blocked: boolean;
};

const normalizedRegion = (region: Region): Region => {
  const c0 = Math.min(region.c0, region.c1);
  const c1 = Math.max(region.c0, region.c1);
  const r0 = Math.min(region.r0, region.r1);
  const r1 = Math.max(region.r0, region.r1);
  if (![c0, r0, c1, r1].every(Number.isInteger)) {
    throw new Error('emberwatch_authoring.placeHouse: region coordinates must be integers');
  }
  return { c0, r0, c1, r1 };
};

const replaceContribution = (
  entries: Array<[number, number, number]>,
  c: number,
  r: number,
  gid: number,
): void => {
  const existing = entries.findIndex(([entryC, entryR]) => entryC === c && entryR === r);
  if (existing >= 0) {
    entries[existing] = [c, r, gid];
    return;
  }
  entries.push([c, r, gid]);
};

const setGroundContribution = (map: MapData, c: number, r: number, gid: number): void => {
  setTile(map, c, r, gid);
  map.groundExtra ??= [];
  replaceContribution(map.groundExtra, c, r, gid);
};

const setDecorContribution = (map: MapData, c: number, r: number, gid: number): void => {
  map.decorExtra ??= [];
  replaceContribution(map.decorExtra, c, r, gid);
};

const setOverheadContribution = (map: MapData, c: number, r: number, gid: number): void => {
  map.overheadExtra ??= [];
  replaceContribution(map.overheadExtra, c, r, gid);
};

const houseDoorHasCell = (
  doorCells: ReadonlyArray<[number, number]>,
  c: number,
  r: number,
): boolean => doorCells.some(([doorC, doorR]) => doorC === c && doorR === r);

/** Contact shadow spans the full facade width on the first approach row. */
const houseContactShadowCells = (options: {
  c0: number;
  c1: number;
  doorRow: number;
}): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let c = options.c0; c <= options.c1; c++) {
    cells.push([c, options.doorRow + 1]);
  }
  return cells;
};

const houseGroundCells = (options: {
  c0: number;
  c1: number;
  r1: number;
}): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let r = options.r1 - 2; r <= options.r1; r++) {
    for (let c = options.c0; c <= options.c1; c++) {
      cells.push([c, r]);
    }
  }
  return cells;
};

const terrainOverrideAt = (map: MapData, c: number, r: number): string | undefined => {
  const overrides = map.terrainOverrides;
  if (!overrides) {
    return undefined;
  }
  for (let index = overrides.length - 1; index >= 0; index--) {
    const entry = overrides[index];
    if (entry && entry[0] === c && entry[1] === r) {
      return entry[2];
    }
  }
  return undefined;
};

const assertNoBlockedGroundTerrainOverrides = (options: {
  map: MapData;
  name: string;
  c0: number;
  c1: number;
  r1: number;
}): void => {
  const badGroundOverrides = houseGroundCells({
    c0: options.c0,
    c1: options.c1,
    r1: options.r1,
  }).filter(([c, r]) => {
    const terrain = terrainOverrideAt(options.map, c, r);
    return terrain !== undefined && terrain !== '';
  });
  if (badGroundOverrides.length === 0) {
    return;
  }
  throw new Error(
    `emberwatch_authoring.placeHouse: ${options.name} terrain override cell(s) ${formatCells(badGroundOverrides)} overlap blocked house ground art`,
  );
};

const facadeRoleForCell = (options: {
  c: number;
  r: number;
  r1: number;
  c0: number;
  c1: number;
  doorCells: ReadonlyArray<[number, number]>;
}): HouseCellRole => {
  const { c, r, r1, c0, c1, doorCells } = options;
  const isLowerFacade = r === r1;
  if (isLowerFacade) {
    if (houseDoorHasCell(doorCells, c, r)) {
      return { layer: 'ground', gid: HOUSE_FRAMES.doorClosed, blocked: true };
    }
    const doorColumn = doorCells[0]?.[0];
    if (doorColumn !== undefined && c === doorColumn - 1 && c > c0) {
      return { layer: 'ground', gid: HOUSE_FRAMES.facadeWindow, blocked: true };
    }
    return { layer: 'ground', gid: HOUSE_FRAMES.foundation, blocked: true };
  }
  if (c === c0) {
    return { layer: 'ground', gid: HOUSE_FRAMES.facadeCornerLeft, blocked: true };
  }
  if (c === c1) {
    return { layer: 'ground', gid: HOUSE_FRAMES.facadeCornerRight, blocked: true };
  }
  return { layer: 'ground', gid: HOUSE_FRAMES.facadeWall, blocked: true };
};

const roofRoleForCell = (options: {
  c: number;
  r: number;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}): HouseCellRole => {
  const { c, r, c0, c1, r0, r1 } = options;
  if (r === r1 - 2) {
    const gid = c === c0 || c === c1 ? HOUSE_FRAMES.roofEaveEdge : HOUSE_FRAMES.roofFront;
    return { layer: 'ground', gid, blocked: true };
  }
  if (r === r0) {
    let gid = HOUSE_FRAMES.roofBack;
    if (c === c0) {
      gid = HOUSE_FRAMES.roofGableLeft;
    } else if (c === c1) {
      gid = HOUSE_FRAMES.roofGableRight;
    }
    return { layer: 'overhead', gid, blocked: false };
  }
  if (r === r0 + 1) {
    const gid = c === c0 || c === c1 ? HOUSE_FRAMES.roofEaveOverhead : HOUSE_FRAMES.roofRidge;
    return { layer: 'overhead', gid, blocked: false };
  }
  return { layer: 'overhead', gid: HOUSE_FRAMES.roofBack, blocked: false };
};

const houseCellRole = (options: {
  c: number;
  r: number;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  doorCells: ReadonlyArray<[number, number]>;
}): HouseCellRole => {
  const { c, r, c0, c1, r0, r1, doorCells } = options;
  if (r === r1 - 1 || r === r1) {
    return facadeRoleForCell({ c, r, r1, c0, c1, doorCells });
  }
  return roofRoleForCell({ c, r, c0, c1, r0, r1 });
};

const assertHouseInputs = (options: {
  map: MapData;
  region: Region;
  door: { c: number };
  facing: HouseFacing;
  mapId?: string;
}): {
  region: Region;
  doorCells: Array<[number, number]>;
  landingCells: Array<[number, number]>;
  contactShadowCells: Array<[number, number]>;
} => {
  const name = options.mapId ?? 'map';
  const region = normalizedRegion(options.region);
  const width = region.c1 - region.c0 + 1;
  const height = region.r1 - region.r0 + 1;
  if (width < 4 || height < 5) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} footprint must be at least 4×5 (got ${width}×${height})`,
    );
  }
  if (
    !isMapCell(options.map, region.c0, region.r0) ||
    !isMapCell(options.map, region.c1, region.r1)
  ) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} footprint (${region.c0},${region.r0})–(${region.c1},${region.r1}) is outside the ${options.map.width}×${options.map.height} map`,
    );
  }
  if (options.facing !== 's') {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} facing "${options.facing}" is not authored yet; C-550 supports south-facing houses`,
    );
  }
  if (
    !Number.isInteger(options.door.c) ||
    options.door.c < region.c0 ||
    options.door.c > region.c1
  ) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} door column ${options.door.c} is outside the facade`,
    );
  }
  const placement = houseDoorPlacement({
    c0: region.c0,
    r0: region.r0,
    w: width,
    h: height,
    doorSide: 'south',
  });
  const doorCell: [number, number] = [options.door.c, region.r1];
  if (!houseDoorHasCell(placement.doorCells, doorCell[0], doorCell[1])) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} door column ${options.door.c} is not on the derived single south door`,
    );
  }
  assertNoBlockedGroundTerrainOverrides({
    map: options.map,
    name,
    c0: region.c0,
    c1: region.c1,
    r1: region.r1,
  });
  const walkBehindCells: Array<[number, number]> = [];
  for (let r = region.r0; r < region.r1 - 2; r++) {
    for (let c = region.c0; c <= region.c1; c++) {
      walkBehindCells.push([c, r]);
    }
  }
  const traversableCells = walkBehindCells;
  const badTraversableCells = traversableCells.filter(
    ([c, r]) => !isMapCell(options.map, c, r) || !isWalkableLand(options.map, c, r),
  );
  if (badTraversableCells.length > 0) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} walk-behind cell(s) ${formatCells(badTraversableCells)} must be walkable land`,
    );
  }
  const badApproach = placement.landingCells.filter(
    ([c, r]) => !isMapCell(options.map, c, r) || !isWalkableLand(options.map, c, r),
  );
  if (badApproach.length > 0) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} approach cell(s) ${formatCells(badApproach)} must be walkable land`,
    );
  }
  const contactShadowCells = houseContactShadowCells({
    c0: region.c0,
    c1: region.c1,
    doorRow: region.r1,
  });
  const badShadowCells = contactShadowCells.filter(
    ([c, r]) => !isMapCell(options.map, c, r) || !isWalkableLand(options.map, c, r),
  );
  if (badShadowCells.length > 0) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} contact-shadow cell(s) ${formatCells(badShadowCells)} must be walkable land`,
    );
  }
  return {
    region,
    doorCells: placement.doorCells,
    landingCells: placement.landingCells,
    contactShadowCells,
  };
};

const applyHouseCell = (map: MapData, role: HouseCellRole, c: number, r: number): void => {
  if (role.layer === 'overhead') {
    setOverheadContribution(map, c, r, role.gid);
    map.collision[idx(map, c, r)] = 0;
    return;
  }
  setGroundContribution(map, c, r, role.gid);
  map.collision[idx(map, c, r)] = role.blocked ? 1 : 0;
};

const applyHouseApproach = (
  map: MapData,
  landingCells: ReadonlyArray<[number, number]>,
  contactShadowCells: ReadonlyArray<[number, number]>,
): void => {
  for (const [c, r] of landingCells) {
    setTile(map, c, r, G.STONE_FLOOR);
    map.collision[idx(map, c, r)] = 0;
  }
  for (const [c, r] of contactShadowCells) {
    setDecorContribution(map, c, r, HOUSE_FRAMES.foundationShadow);
    map.collision[idx(map, c, r)] = 0;
  }
};

/**
 * Authors one raised south-facing house as explicit map contributions.
 *
 * The three upper rows are roof: a back plane, a capped ridge, and a blocked
 * front eave. The two lower rows are facade, with one closed door on the
 * bottom row and a narrow plinth integrated into the lower facade frames. The
 * upper roof rows are the only walk-behind cells: an actor can pass north of
 * the house and the overhead band draws the roof over them, while the facade
 * and front eave remain hard movement boundaries.
 *
 * Assertions run before any mutation, so a failed author-time check leaves the
 * map unchanged. C-550 intentionally does not create a transition or arrival
 * marker; a future interior edge can use the returned cell as its anchor.
 */
export const placeHouse = (
  map: MapData,
  options: {
    region: Region;
    door: { c: number };
    facing: HouseFacing;
    mapId?: string;
  },
): HouseDoorCell => {
  const { region, doorCells, landingCells, contactShadowCells } = assertHouseInputs({
    map,
    ...options,
  });
  for (let r = region.r0; r <= region.r1; r++) {
    for (let c = region.c0; c <= region.c1; c++) {
      const role = houseCellRole({
        c,
        r,
        c0: region.c0,
        c1: region.c1,
        r0: region.r0,
        r1: region.r1,
        doorCells,
      });
      applyHouseCell(map, role, c, r);
    }
  }
  applyHouseApproach(map, landingCells, contactShadowCells);
  return { c: options.door.c, r: region.r1 };
};
