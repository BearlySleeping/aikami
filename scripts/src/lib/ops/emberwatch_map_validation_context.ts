// scripts/src/lib/ops/emberwatch_map_validation_context.ts
//
// Shared types and the indexed pack snapshot the Emberwatch map validation
// rules read. Pure + read-only; no rule lives here.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPropCollision,
  buildWalkabilityGrid,
  cellOfPoint,
  cloneGrid,
  gridIndex,
  inBounds,
  type ManifestProp,
  type ManifestTile,
  reachableFrom,
  type WalkabilityGrid,
} from './emberwatch_map_navigation.ts';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationFinding = {
  rule: string;
  severity: ValidationSeverity;
  map: string;
  subject: string;
  detail: string;
};

export type MapSummary = {
  id: string;
  width: number;
  height: number;
  npcCount: number;
  propCount: number;
  transitionCount: number;
  walkablePercent: number;
  components: number;
  unreachableCells: number;
  legacyFrames: string[];
};

export type ManifestPropDef = ManifestProp & {
  frame?: string;
  anchor?: unknown;
  renderSize?: unknown;
  collision?: unknown;
  shadow?: unknown;
};

export type Manifest = {
  maps?: Record<string, unknown>;
  tiles?: Record<string, ManifestTile & { frame?: string }>;
  props?: Record<string, ManifestPropDef>;
  evidence?: Array<{ id?: string; discoverableAt?: string }>;
};

type Property = { name: string; value: unknown };
export type RawObject = {
  id?: number;
  type?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: Property[];
};
type RawLayer = { name?: string; type?: string; data?: number[]; objects?: RawObject[] };
export type RawMap = { width: number; height: number; layers?: RawLayer[] };

export type PlacedObject = {
  id: number;
  type: string;
  props: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapContext = {
  id: string;
  raw: RawMap;
  objects: PlacedObject[];
  grid: WalkabilityGrid;
  terrainGrid: WalkabilityGrid;
  reachable: Uint8Array;
  spawns: PlacedObject[];
  npcs: PlacedObject[];
  props: PlacedObject[];
  transitions: PlacedObject[];
};

export const here = dirname(fileURLToPath(import.meta.url));
export const repository = join(here, '../../../..');
export const packRoot = join(repository, 'content/packs/emberwatch');
export const mapsDir = join(packRoot, 'maps');

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const propsOf = (object: RawObject): Record<string, unknown> =>
  Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));

const placedObjects = (map: RawMap): PlacedObject[] => {
  const out: PlacedObject[] = [];
  for (const layer of map.layers ?? []) {
    for (const object of layer.objects ?? []) {
      out.push({
        id: Number(object.id ?? 0),
        type: String(object.type ?? ''),
        props: propsOf(object),
        x: object.x,
        y: object.y,
        width: Number(object.width ?? 0),
        height: Number(object.height ?? 0),
      });
    }
  }
  return out;
};

/** Inclusive point test matching the runtime zoning rectangle. */
export const rectContainsPoint = (object: PlacedObject, x: number, y: number): boolean =>
  x >= object.x &&
  x <= object.x + Math.max(0, object.width) &&
  y >= object.y &&
  y <= object.y + Math.max(0, object.height);

/** Cells inside a transition's trigger rectangle. */
export const rectCells = (object: PlacedObject): Array<{ c: number; r: number }> => {
  const cells: Array<{ c: number; r: number }> = [];
  const c0 = Math.floor(object.x / 32);
  const r0 = Math.floor(object.y / 32);
  const w = Math.max(1, Math.round(object.width / 32));
  const h = Math.max(1, Math.round(object.height / 32));
  for (let r = r0; r < r0 + h; r++) {
    for (let c = c0; c < c0 + w; c++) {
      cells.push({ c, r });
    }
  }
  return cells;
};

export const reachableAt = (context: MapContext, c: number, r: number): boolean =>
  inBounds(context.grid, c, r) && context.reachable[gridIndex(context.grid, c, r)] === 1;

/** Builds the walkability/reachability context for every map. */
export const buildContexts = (manifest: Manifest): Map<string, MapContext> => {
  const contexts = new Map<string, MapContext>();
  const tiles = manifest.tiles ?? {};
  const manifestProps = manifest.props ?? {};
  for (const file of readdirSync(mapsDir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    const id = file.slice(0, -'.json'.length);
    const raw = readJson<RawMap>(join(mapsDir, file));
    const terrainGrid = buildWalkabilityGrid({ map: raw, tiles });
    const objects = placedObjects(raw);
    const props = objects.filter((o) => o.type === 'prop');
    const grid = cloneGrid(terrainGrid);
    applyPropCollision({
      grid,
      props: props.map((p) => ({ propId: str(p.props.propId), x: p.x, y: p.y })),
      manifestProps,
    });
    const spawns = objects.filter((o) => o.type === 'spawn');
    const spawnCells = spawns.map((s) => cellOfPoint(s.x, s.y));
    contexts.set(id, {
      id,
      raw,
      objects,
      grid,
      terrainGrid,
      reachable: reachableFrom(grid, spawnCells),
      spawns,
      npcs: objects.filter((o) => o.type === 'npc'),
      props,
      transitions: objects.filter((o) => o.type === 'transition'),
    });
  }
  return contexts;
};

/** Finds an evidence entry's prop placement on its own map, if any. */
export const evidenceProp = (
  context: MapContext,
  entry: { discoverableAt?: string },
): PlacedObject | undefined => {
  if (str(entry.discoverableAt).split(':')[0] !== context.id) {
    return undefined;
  }
  const propId = str(entry.discoverableAt).split(':')[1] ?? '';
  return context.props.find((p) => str(p.props.propId) === propId);
};

/**
 * The cells a player can stand in to interact with an evidence object.
 *
 * A solid prop blocks its own origin cell, so interaction happens from an
 * orthogonal neighbour; a walkable prop interacts from its own cell.
 */
export const interactCellsForEvidence = (
  context: MapContext,
  manifest: Manifest,
  entry: { discoverableAt?: string },
): Array<{ c: number; r: number }> => {
  const prop = evidenceProp(context, entry);
  if (!prop) {
    return [];
  }
  const propId = str(prop.props.propId);
  const origin = cellOfPoint(prop.x, prop.y);
  if (manifest.props?.[propId]?.isWalkable === true) {
    return [origin];
  }
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].map(([dc, dr]) => ({ c: origin.c + (dc ?? 0), r: origin.r + (dr ?? 0) }));
};
