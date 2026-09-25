// scripts/src/lib/ops/emberwatch_prop_footprint.ts
//
// Author-time visual-footprint lookup for Emberwatch prop placements. The
// generated manifest is the canonical prop presentation source; this module
// reduces its logical render rectangle to map cells so house authoring can fail
// before a visual overlap is baked into a map.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../content/packs/emberwatch/manifest.json',
);

type UnknownRecord = Record<string, unknown>;

export type PropFootprint = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

export type PropFootprintAudit = PropFootprint & {
  collision: { width: number; height: number } | undefined;
  visualCellCount: number;
  collisionCellCount: number;
  originCovered: boolean;
  styleClass: string;
};

const isRecord = (value: unknown): value is UnknownRecord => value instanceof Object;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const positiveNumber = (value: unknown): number | undefined =>
  finiteNumber(value) && value > 0 ? value : undefined;

const readManifestProps = (): Record<string, UnknownRecord> => {
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!isRecord(raw) || !isRecord(raw.props)) {
    throw new Error('emberwatch_prop_footprint: manifest has no props object');
  }
  const result: Record<string, UnknownRecord> = {};
  for (const [propId, definition] of Object.entries(raw.props)) {
    if (isRecord(definition)) {
      result[propId] = definition;
    }
  }
  return result;
};

const readSize = (definition: UnknownRecord): { width: number; height: number } | undefined => {
  const renderSize = isRecord(definition.renderSize) ? definition.renderSize : undefined;
  const collision = isRecord(definition.collision) ? definition.collision : undefined;
  const width = positiveNumber(renderSize?.width) ?? positiveNumber(collision?.width);
  const height = positiveNumber(renderSize?.height) ?? positiveNumber(collision?.height);
  return width === undefined || height === undefined ? undefined : { width, height };
};

/** Read one prop's logical visual footprint and bottom-centre anchor. */
export const readPropFootprint = (propId: string): PropFootprint => {
  const definition = readManifestProps()[propId];
  const size = definition === undefined ? undefined : readSize(definition);
  if (definition === undefined || size === undefined) {
    throw new Error(`emberwatch_prop_footprint: missing visual footprint for prop "${propId}"`);
  }
  const anchor = isRecord(definition.anchor) ? definition.anchor : undefined;
  const anchorX = finiteNumber(anchor?.x) ? anchor.x : 0.5;
  const anchorY = finiteNumber(anchor?.y) ? anchor.y : 1;
  return { ...size, anchorX, anchorY };
};

/**
 * Convert an authored prop origin to the map cells touched by its visual art.
 * Origins use the same world-pixel convention as `placeProp`; the rectangle is
 * anchored at the prop's declared point and expanded toward its top-left.
 */
/** Read a prop's visual and collision footprints for authoring/evidence review. */
export const readPropFootprintAudit = (propId: string): PropFootprintAudit => {
  const definition = readManifestProps()[propId];
  if (definition === undefined) {
    throw new Error(`emberwatch_prop_footprint: missing prop "${propId}"`);
  }
  const footprint = readPropFootprint(propId);
  const collisionValue = isRecord(definition.collision) ? definition.collision : undefined;
  const collisionWidth = positiveNumber(collisionValue?.width);
  const collisionHeight = positiveNumber(collisionValue?.height);
  const collision =
    collisionWidth === undefined || collisionHeight === undefined
      ? undefined
      : { width: collisionWidth, height: collisionHeight };
  const cellCount = (width: number, height: number): number =>
    Math.ceil(width / 32) * Math.ceil(height / 32);
  return {
    ...footprint,
    collision,
    visualCellCount: cellCount(footprint.width, footprint.height),
    collisionCellCount: collision === undefined ? 0 : cellCount(collision.width, collision.height),
    originCovered: collision !== undefined,
    styleClass: typeof definition.styleClass === 'string' ? definition.styleClass : 'unclassified',
  };
};

export const propFootprintCells = (options: {
  propId: string;
  x: number;
  y: number;
  cellSize?: number;
}): Array<[number, number]> => {
  const cellSize = options.cellSize ?? 32;
  if (!Number.isInteger(cellSize) || cellSize <= 0) {
    throw new Error('emberwatch_prop_footprint: cellSize must be a positive integer');
  }
  const footprint = readPropFootprint(options.propId);
  const left = options.x - footprint.width * footprint.anchorX;
  const top = options.y - footprint.height * footprint.anchorY;
  const right = left + footprint.width;
  const bottom = top + footprint.height;
  const c0 = Math.floor(left / cellSize);
  const c1 = Math.ceil(right / cellSize) - 1;
  const r0 = Math.floor(top / cellSize);
  const r1 = Math.ceil(bottom / cellSize) - 1;
  const cells: Array<[number, number]> = [];
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      cells.push([c, r]);
    }
  }
  return cells;
};
