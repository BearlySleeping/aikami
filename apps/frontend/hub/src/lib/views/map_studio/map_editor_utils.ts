// apps/frontend/hub/src/lib/views/map_studio/map_editor_utils.ts
//
// C-507 — Pure helpers for the hub visual map editor.
//
// Framework-free and engine-runtime-free (type-only imports are erased), so
// these can be unit-tested in Bun without pulling PixiJS or Svelte. The
// ViewModel composes them with the engine's `SceneEditor`.

import type { SceneDocument } from '@aikami/types';

/** Active editor tool, mirrored from the engine's `SceneEditorTool`. */
export type EditorToolKind =
  | 'select'
  | 'paint'
  | 'erase'
  | 'collide-block'
  | 'collide-unblock'
  | 'place'
  | 'transition'
  | 'delete';

/** A placement/transition selection by stable id. */
export type EditorSelection = { kind: 'placement' | 'transition'; id: string } | undefined;

/** Canvas pixel coordinates → scene cell. Negative/oversized results are caller-checked. */
export const cellFromCanvasPoint = (
  offsetX: number,
  offsetY: number,
  tileSize: number,
): { x: number; y: number } => ({
  x: Math.floor(offsetX / tileSize),
  y: Math.floor(offsetY / tileSize),
});

/** True when a cell lies inside the scene extent. */
export const isCellInBounds = (doc: SceneDocument, x: number, y: number): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 0 &&
  y >= 0 &&
  x < doc.extent.width &&
  y < doc.extent.height;

/** Ground frames available to paint, from the baked surface palette. */
export const groundFrames = (doc: SceneDocument): string[] =>
  doc.surface.mode === 'baked' ? doc.surface.palette.filter((frame) => frame.length > 0) : [];

/** Terrain ids available to paint, from the terrain surface (empty when baked). */
export const terrainIds = (doc: SceneDocument): string[] =>
  doc.surface.mode === 'terrain'
    ? [...new Set(doc.surface.cells)].filter((id) => id.length > 0)
    : [];

/** Every logical frame the document already references (layers + placements). */
export const placementFrames = (doc: SceneDocument): string[] => {
  const frames = new Set<string>();
  for (const placement of doc.placements) {
    frames.add(placement.frame);
  }
  for (const layer of doc.layers) {
    for (const frame of layer.palette) {
      if (frame.length > 0) {
        frames.add(frame);
      }
    }
  }
  return [...frames].sort();
};

/** Finds the placement or transition under a cell, by stable id. */
export const hitTestSelection = (doc: SceneDocument, x: number, y: number): EditorSelection => {
  const tileSize = doc.extent.tileSize;
  const px = x * tileSize;
  const py = y * tileSize;
  for (const placement of doc.placements) {
    const cx = Math.floor(placement.x / tileSize);
    const cy = Math.floor(placement.y / tileSize);
    if (cx === x && cy === y) {
      return { kind: 'placement', id: placement.id };
    }
  }
  for (const transition of doc.transitions ?? []) {
    if (
      px >= transition.x &&
      px < transition.x + transition.width &&
      py >= transition.y &&
      py < transition.y + transition.height
    ) {
      return { kind: 'transition', id: transition.id };
    }
  }
  return undefined;
};

/** Human-readable scene extent, e.g. `12 × 9 cells`. */
export const sceneExtentLabel = (doc: SceneDocument): string =>
  `${doc.extent.width} × ${doc.extent.height} cells`;

/** A packed atlas frame's source rectangle in pixels. */
export type AtlasFrameRect = { x: number; y: number; width: number; height: number };

const _number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const _frameRect = (value: unknown): AtlasFrameRect | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const source =
    record.frame && typeof record.frame === 'object'
      ? (record.frame as Record<string, unknown>)
      : record;
  const x = _number(source.x);
  const y = _number(source.y);
  const width = _number(source.width ?? source.w);
  const height = _number(source.height ?? source.h);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
};

/**
 * Parses a packed spritesheet JSON (`{ frames: { name: { frame: {x,y,w,h} } } }`)
 * into a logical frame name → source rect map. Accepts both the Pixi
 * `{ frame: {...} }` nesting and a flat `{ x, y, width, height }` shape.
 * Malformed entries are skipped, never thrown on.
 */
export const parseAtlasFrames = (raw: unknown): Record<string, AtlasFrameRect> => {
  const frames = (raw as { frames?: unknown } | null | undefined)?.frames;
  if (!frames || typeof frames !== 'object') {
    return {};
  }
  const result: Record<string, AtlasFrameRect> = {};
  for (const [name, value] of Object.entries(frames as Record<string, unknown>)) {
    const rect = _frameRect(value);
    if (rect) {
      result[name] = rect;
    }
  }
  return result;
};
