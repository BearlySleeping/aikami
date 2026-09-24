// scripts/src/lib/ops/emberwatch_house_authoring.ts
//
// C-550/C-553 — deterministic shared authoring seam for Emberwatch houses.
// The helper writes existing MapData fields and explicit contribution lists;
// it does not introduce a second runtime map model or own transitions.

import type { Region } from './emberwatch_authoring.ts';
import { formatCells, isMapCell, isWalkableLand } from './emberwatch_map_authoring_helpers.ts';
import { idx, type MapData, type MapObjectLayer, setTile } from './emberwatch_map_shared.ts';
import { propFootprintCells } from './emberwatch_prop_footprint.ts';
import type { HouseRoofMaterial } from './generate_emberwatch_house_frames.ts';
import { buildG, readManifestTiles } from './generate_emberwatch_tables.ts';

export type { HouseRoofMaterial } from './generate_emberwatch_house_frames.ts';

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

/** Two-row door geometry shared by enterable and closed village houses. */
export type HouseDoorPlacement = {
  doorCells: Array<[number, number]>;
  landingCells: Array<[number, number]>;
};

/** Two solid facade rows are reserved below the roof on every house. */
export const HOUSE_FACADE_ROWS = 2;

/** Maximum pale/front roof depth before the darker back slope takes over. */
export const HOUSE_MAX_VISIBLE_ROOF_ROWS = 3;

/** Return the bounded front-roof depth for a footprint height. */
export const houseVisibleRoofRows = (footprintRows: number): number => {
  if (!Number.isInteger(footprintRows) || footprintRows <= HOUSE_FACADE_ROWS) {
    throw new Error(
      `emberwatch_authoring: footprintRows must be an integer greater than ${HOUSE_FACADE_ROWS}`,
    );
  }
  return Math.min(footprintRows - HOUSE_FACADE_ROWS, HOUSE_MAX_VISIBLE_ROOF_ROWS);
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

/** Resolve a two-row south door and its two clear exterior landing rows. */
export const houseDoorPlacement = (options: {
  c0: number;
  r0: number;
  w: number;
  h: number;
  doorSide: DoorSide;
  doorColumn?: number;
}): HouseDoorPlacement => {
  const { c0, r0, w, h, doorSide } = options;
  if (doorSide !== 'south') {
    throw new Error('houseDoorPlacement currently supports only a south-facing door');
  }
  const doorColumn = options.doorColumn ?? c0 + Math.floor(w / 2);
  const doorRow = r0 + h - 1;
  return {
    doorCells: [
      [doorColumn, doorRow - 1],
      [doorColumn, doorRow],
    ],
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
  roofSlateFront: 'house_roof_slate_front.png',
  roofSlateBack: 'house_roof_slate_back.png',
  roofSlateRidge: 'house_roof_slate_ridge.png',
  roofSlateGableLeft: 'house_roof_slate_gable_left.png',
  roofSlateGableRight: 'house_roof_slate_gable_right.png',
  roofSlateEaveOverhead: 'house_roof_slate_eave_overhead.png',
  roofSlateEaveEdge: 'house_roof_slate_eave_edge.png',
  roofThatchFront: 'house_roof_thatch_front.png',
  roofThatchBack: 'house_roof_thatch_back.png',
  roofThatchRidge: 'house_roof_thatch_ridge.png',
  roofThatchGableLeft: 'house_roof_thatch_gable_left.png',
  roofThatchGableRight: 'house_roof_thatch_gable_right.png',
  roofThatchEaveOverhead: 'house_roof_thatch_eave_overhead.png',
  roofThatchEaveEdge: 'house_roof_thatch_eave_edge.png',
  facadeWall: 'house_facade_wall.png',
  facadeWindow: 'house_facade_window.png',
  facadeCornerLeft: 'house_facade_corner_left.png',
  facadeCornerRight: 'house_facade_corner_right.png',
  doorUpperClosed: 'house_door_upper_closed.png',
  doorUpperOpen: 'house_door_upper_open.png',
  doorLowerClosed: 'house_door_closed.png',
  doorLowerOpen: 'house_door_open.png',
  foundation: 'house_foundation.png',
  foundationShadow: 'house_foundation_shadow.png',
} as const;

/** A named role in the shared C-550/C-553 house frame kit. */
export type HouseFrameRole = keyof typeof HOUSE_FRAME_NAMES;

/** Semantic roof role exposed to placeHouse callers. */
export type HouseRoofFrameRole =
  | 'front'
  | 'back'
  | 'ridge'
  | 'gableLeft'
  | 'gableRight'
  | 'eaveOverhead'
  | 'eaveEdge';

/** Door leaf state; transitions remain the map object layer's responsibility. */
export type HouseDoorState = 'closed' | 'open';

const HOUSE_ROOF_FRAME_ROLES = {
  cedar: {
    front: 'roofFront',
    back: 'roofBack',
    ridge: 'roofRidge',
    gableLeft: 'roofGableLeft',
    gableRight: 'roofGableRight',
    eaveOverhead: 'roofEaveOverhead',
    eaveEdge: 'roofEaveEdge',
  },
  slate: {
    front: 'roofSlateFront',
    back: 'roofSlateBack',
    ridge: 'roofSlateRidge',
    gableLeft: 'roofSlateGableLeft',
    gableRight: 'roofSlateGableRight',
    eaveOverhead: 'roofSlateEaveOverhead',
    eaveEdge: 'roofSlateEaveEdge',
  },
  thatch: {
    front: 'roofThatchFront',
    back: 'roofThatchBack',
    ridge: 'roofThatchRidge',
    gableLeft: 'roofThatchGableLeft',
    gableRight: 'roofThatchGableRight',
    eaveOverhead: 'roofThatchEaveOverhead',
    eaveEdge: 'roofThatchEaveEdge',
  },
} as const satisfies Record<HouseRoofMaterial, Record<HouseRoofFrameRole, HouseFrameRole>>;

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

const roofFramesFor = (
  material: HouseRoofMaterial,
): Readonly<Record<HouseRoofFrameRole, number>> => {
  const roles = HOUSE_ROOF_FRAME_ROLES[material];
  return {
    front: HOUSE_FRAMES[roles.front],
    back: HOUSE_FRAMES[roles.back],
    ridge: HOUSE_FRAMES[roles.ridge],
    gableLeft: HOUSE_FRAMES[roles.gableLeft],
    gableRight: HOUSE_FRAMES[roles.gableRight],
    eaveOverhead: HOUSE_FRAMES[roles.eaveOverhead],
    eaveEdge: HOUSE_FRAMES[roles.eaveEdge],
  };
};

/** Material-specific GIDs for the seven shared roof geometry roles. */
export const HOUSE_ROOF_FRAMES: Readonly<
  Record<HouseRoofMaterial, Readonly<Record<HouseRoofFrameRole, number>>>
> = {
  cedar: roofFramesFor('cedar'),
  slate: roofFramesFor('slate'),
  thatch: roofFramesFor('thatch'),
};

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

type HouseKeepOut = {
  region: Region;
  landingCells: ReadonlyArray<readonly [number, number]>;
};

const houseKeepOutByMap = new WeakMap<MapData, HouseKeepOut[]>();

const rememberHouseKeepOut = (options: {
  map: MapData;
  region: Region;
  landingCells: ReadonlyArray<readonly [number, number]>;
}): void => {
  const houses = houseKeepOutByMap.get(options.map) ?? [];
  houses.push({ region: options.region, landingCells: options.landingCells });
  houseKeepOutByMap.set(options.map, houses);
};

type MapObject = MapObjectLayer['objects'][number];

const propertyString = (object: MapObject, name: string): string | undefined => {
  const value = object.properties.find((property) => property.name === name)?.value;
  return typeof value === 'string' ? value : undefined;
};

const addRegionCells = (target: Set<string>, region: Region): void => {
  for (let r = region.r0; r <= region.r1; r += 1) {
    for (let c = region.c0; c <= region.c1; c += 1) {
      target.add(`${c},${r}`);
    }
  }
};

const buildKeepOutCells = (
  houses: readonly HouseKeepOut[],
): { houseCells: Set<string>; approachCells: Set<string> } => {
  const houseCells = new Set<string>();
  const approachCells = new Set<string>();
  for (const house of houses) {
    addRegionCells(houseCells, house.region);
    for (const [c, r] of house.landingCells) {
      approachCells.add(`${c},${r}`);
    }
  }
  return { houseCells, approachCells };
};

const propOverlapViolation = (options: {
  object: MapObject;
  houseCells: ReadonlySet<string>;
  approachCells: ReadonlySet<string>;
}): string | undefined => {
  const { object, houseCells, approachCells } = options;
  if (object.type !== 'prop') {
    return undefined;
  }
  const propId = propertyString(object, 'propId');
  if (propId === undefined) {
    throw new Error('emberwatch_authoring: prop object is missing its propId');
  }
  const overlaps = propFootprintCells({ propId, x: object.x, y: object.y }).filter(
    ([c, r]) => houseCells.has(`${c},${r}`) || approachCells.has(`${c},${r}`),
  );
  return overlaps.length === 0
    ? undefined
    : `prop ${propId} (${object.id}) overlaps ${formatCells(overlaps)}`;
};

const collectPropOverlapViolations = (options: {
  objectLayers: readonly MapObjectLayer[];
  houseCells: ReadonlySet<string>;
  approachCells: ReadonlySet<string>;
}): string[] => {
  const violations: string[] = [];
  for (const layer of options.objectLayers) {
    for (const object of layer.objects) {
      const violation = propOverlapViolation({
        object,
        houseCells: options.houseCells,
        approachCells: options.approachCells,
      });
      if (violation !== undefined) {
        violations.push(violation);
      }
    }
  }
  return violations;
};

/**
 * Fail closed when a prop's visual rectangle touches a house or its approach.
 * This is intentionally an author-time assertion over the final object layers:
 * it catches a later prop move even when the house itself was authored first.
 */
export const assertNoHousePropOverlaps = (options: {
  map: MapData;
  objectLayers: readonly MapObjectLayer[];
}): void => {
  const houses = houseKeepOutByMap.get(options.map) ?? [];
  if (houses.length === 0) {
    return;
  }
  const { houseCells, approachCells } = buildKeepOutCells(houses);
  const violations = collectPropOverlapViolations({
    objectLayers: options.objectLayers,
    houseCells,
    approachCells,
  });
  if (violations.length > 0) {
    throw new Error(`emberwatch_authoring: house prop overlap(s): ${violations.join('; ')}`);
  }
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

const doorFrame = (state: HouseDoorState, lower: boolean): number => {
  if (state === 'open') {
    return lower ? HOUSE_FRAMES.doorLowerOpen : HOUSE_FRAMES.doorUpperOpen;
  }
  return lower ? HOUSE_FRAMES.doorLowerClosed : HOUSE_FRAMES.doorUpperClosed;
};

const facadeRoleForCell = (options: {
  c: number;
  r: number;
  r1: number;
  c0: number;
  c1: number;
  doorCells: ReadonlyArray<[number, number]>;
  doorState: HouseDoorState;
}): HouseCellRole => {
  const { c, r, r1, c0, c1, doorCells, doorState } = options;
  const isLowerFacade = r === r1;
  if (houseDoorHasCell(doorCells, c, r)) {
    return { layer: 'ground', gid: doorFrame(doorState, isLowerFacade), blocked: true };
  }
  if (isLowerFacade) {
    const doorColumn = doorCells[0]?.[0];
    if (
      doorColumn !== undefined &&
      (c === doorColumn - 1 || c === doorColumn + 1) &&
      c > c0 &&
      c < c1
    ) {
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
  roofMaterial: HouseRoofMaterial;
  visibleRoofRows: number;
}): HouseCellRole => {
  const { c, r, c0, c1, r0, r1, roofMaterial, visibleRoofRows } = options;
  const frames = HOUSE_ROOF_FRAMES[roofMaterial];
  const frontRow = r1 - 2;
  const ridgeRow = frontRow - (visibleRoofRows - 2);
  if (r === frontRow) {
    const gid = c === c0 || c === c1 ? frames.eaveEdge : frames.front;
    return { layer: 'ground', gid, blocked: true };
  }
  if (r === ridgeRow) {
    const gid = c === c0 || c === c1 ? frames.eaveOverhead : frames.ridge;
    return { layer: 'overhead', gid, blocked: false };
  }
  if (r === r0) {
    let gid = frames.back;
    if (c === c0) {
      gid = frames.gableLeft;
    } else if (c === c1) {
      gid = frames.gableRight;
    }
    return { layer: 'overhead', gid, blocked: false };
  }
  // Keep the full walk-behind depth, but render every row before the bounded
  // front/ridge section as the darker back slope. The facade therefore gains
  // one pale front band and one ridge highlight, never a second pale band.
  return { layer: 'overhead', gid: frames.back, blocked: false };
};

const houseCellRole = (options: {
  c: number;
  r: number;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  doorCells: ReadonlyArray<[number, number]>;
  doorState: HouseDoorState;
  roofMaterial: HouseRoofMaterial;
  visibleRoofRows: number;
}): HouseCellRole => {
  const { c, r, c0, c1, r0, r1, doorCells, doorState, roofMaterial, visibleRoofRows } = options;
  if (r === r1 - 1 || r === r1) {
    return facadeRoleForCell({ c, r, r1, c0, c1, doorCells, doorState });
  }
  return roofRoleForCell({ c, r, c0, c1, r0, r1, roofMaterial, visibleRoofRows });
};

const assertHouseInputs = (options: {
  map: MapData;
  region: Region;
  door: { c: number; state?: HouseDoorState };
  facing: HouseFacing;
  roofMaterial?: HouseRoofMaterial;
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
    options.door.c <= region.c0 ||
    options.door.c >= region.c1
  ) {
    throw new Error(
      `emberwatch_authoring.placeHouse: ${name} door column ${options.door.c} must be inside the facade`,
    );
  }
  const placement = houseDoorPlacement({
    c0: region.c0,
    r0: region.r0,
    w: width,
    h: height,
    doorSide: 'south',
    doorColumn: options.door.c,
  });
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
 * `region` carries the requested width/height. `door.c` places one two-row
 * opening across both facade rows; `door.state` selects paired open/closed art
 * without creating a transition. `roofMaterial` selects a palette on the same
 * seven roof geometries. Upper roof cells remain walkable overhead, while the
 * front eave and both facade rows stay solid.
 *
 * Assertions run before mutation, so invalid input leaves the map unchanged.
 * Transition and arrival objects remain owned by `placeTransition` and
 * `placeSpawn` in the map builder.
 */
export const placeHouse = (
  map: MapData,
  options: {
    region: Region;
    door: { c: number; state?: HouseDoorState };
    facing: HouseFacing;
    roofMaterial?: HouseRoofMaterial;
    mapId?: string;
  },
): HouseDoorCell => {
  const { region, doorCells, landingCells, contactShadowCells } = assertHouseInputs({
    map,
    ...options,
  });
  const doorState = options.door.state ?? 'closed';
  const roofMaterial = options.roofMaterial ?? 'cedar';
  const visibleRoofRows = houseVisibleRoofRows(region.r1 - region.r0 + 1);
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
        doorState,
        roofMaterial,
        visibleRoofRows,
      });
      applyHouseCell(map, role, c, r);
    }
  }
  applyHouseApproach(map, landingCells, contactShadowCells);
  rememberHouseKeepOut({ map, region, landingCells });
  return { c: options.door.c, r: region.r1 };
};
