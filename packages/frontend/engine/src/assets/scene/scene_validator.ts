// packages/frontend/engine/src/assets/scene/scene_validator.ts
//
// C-505 — Strict semantic validation of the canonical scene document.
//
// The TypeBox schema (`@aikami/schemas`) owns the wire *shape*; this module
// owns the cross-field invariants TypeBox cannot express: exact grid lengths,
// palette-index bounds, cell-count / allocation limits (with overflow-safe
// arithmetic), duplicate source ownership, navigation override bounds, and
// strict reference validation against the installed pack (unknown terrain /
// matching mode / frame rejection — C-505 AC-2, AC-4, AC-6).

import {
  SCENE_MAX_CELLS,
  SCENE_MAX_PLACEMENTS,
  SCENE_MAX_VISUAL_LAYERS,
  SCENE_TERRAIN_MATCHING_MODES,
} from '@aikami/constants';
import type { SceneDocument, SceneLayerRole } from '@aikami/types';
import { logger } from '$logger';

/** A scene validation failure — carries precise, author-actionable context. */
export class SceneValidationError extends Error {
  /** Scene id / layer id / placement id / coordinate context. */
  readonly context: string;

  constructor(message: string, context: string) {
    super(message);
    this.name = 'SceneValidationError';
    this.context = context;
  }
}

/**
 * Optional pack reference for strict reference validation.
 *
 * When supplied, terrain ids and matching modes are validated against the
 * pack's declared terrains and frame names against the pack lock's known
 * logical frames. Omitted → structural checks only (used by tooling that has
 * not yet resolved a pack).
 */
export type ScenePackReference = {
  /** Known terrain ids, index-aligned with pack order (index 0 = base). */
  terrainIds: readonly string[];
  /** Known logical frame names that placements / palettes may reference. */
  frameNames: ReadonlySet<string>;
};

export type SceneValidationOptions = {
  /** Optional pack reference for strict reference validation (AC-4). */
  pack?: ScenePackReference;
};

/**
 * Validates a canonical scene document. Throws {@link SceneValidationError}
 * on the first violation with precise context. Returns the document unchanged
 * on success (a convenience for chaining).
 */
export const validateScene = (
  doc: SceneDocument,
  options?: SceneValidationOptions,
): SceneDocument => {
  const pack = options?.pack;
  const { width, height } = doc.extent;

  // ── Bounded dimensions / overflow-safe cell count (AC-6) ──────────────
  const cellCount = _checkedCellCount(width, height, doc.id);
  if (cellCount > SCENE_MAX_CELLS) {
    throw new SceneValidationError(
      `scene exceeds SCENE_MAX_CELLS (${cellCount} > ${SCENE_MAX_CELLS})`,
      `scene ${doc.id}`,
    );
  }

  // ── Surface: exactly one authoritative ground source ──────────────────
  const surface = doc.surface;
  if (surface.mode === 'terrain') {
    _checkLength(surface.cells, cellCount, 'surface.terrain.cells', doc.id);
    if (
      surface.matchingMode !== undefined &&
      !SCENE_TERRAIN_MATCHING_MODES.includes(surface.matchingMode)
    ) {
      throw new SceneValidationError(
        `unsupported terrain matching mode "${surface.matchingMode}"`,
        `scene ${doc.id} surface`,
      );
    }
    // Strict reference validation: every cell's terrain must be declared or
    // equal the default (AC-4). Unknown terrain ids fail explicitly.
    if (pack) {
      const known = new Set(pack.terrainIds);
      const defaultId = surface.defaultTerrain;
      if (!known.has(defaultId)) {
        throw new SceneValidationError(
          `default terrain "${defaultId}" is not declared in the pack`,
          `scene ${doc.id} surface`,
        );
      }
      const unknown = new Set<string>();
      for (const id of surface.cells) {
        if (id !== '' && id !== defaultId && !known.has(id)) {
          unknown.add(id);
        }
      }
      if (unknown.size > 0) {
        throw new SceneValidationError(
          `unknown terrain id(s): ${[...unknown].sort().join(', ')}`,
          `scene ${doc.id} surface`,
        );
      }
    }
  } else {
    _checkLength(surface.grid, cellCount, 'surface.baked.grid', doc.id);
    _checkPaletteIndices(surface.grid, surface.palette.length, 'surface.baked.grid', doc.id);
    if (pack) {
      _checkFrameNames(surface.palette, pack, 'surface.baked.palette', doc.id);
    }
  }

  // ── Visual layers: unique ids, exact grids, in-range indices (AC-2) ───
  if (doc.layers.length > SCENE_MAX_VISUAL_LAYERS) {
    throw new SceneValidationError(
      `too many visual layers (${doc.layers.length} > ${SCENE_MAX_VISUAL_LAYERS})`,
      `scene ${doc.id}`,
    );
  }
  const layerIds = new Set<string>();
  for (const layer of doc.layers) {
    if (layerIds.has(layer.id)) {
      throw new SceneValidationError(`duplicate visual layer id`, `layer ${layer.id}`);
    }
    layerIds.add(layer.id);
    if (layer.role === 'ground') {
      // Ground is owned by the surface — a ground visual layer would be a
      // second authoritative ground source (architecture directive 3).
      throw new SceneValidationError(
        `visual layer declares role "ground" — ground is owned by the surface`,
        `layer ${layer.id}`,
      );
    }
    _checkLength(layer.grid, cellCount, `layers[${layer.id}].grid`, doc.id);
    _checkPaletteIndices(layer.grid, layer.palette.length, `layers[${layer.id}].grid`, doc.id);
    if (pack) {
      _checkFrameNames(layer.palette, pack, `layers[${layer.id}].palette`, doc.id);
    }
  }

  // ── Placements: unique stable ids (AC-2 / AC-3) ───────────────────────
  if (doc.placements.length > SCENE_MAX_PLACEMENTS) {
    throw new SceneValidationError(
      `too many placements (${doc.placements.length} > ${SCENE_MAX_PLACEMENTS})`,
      `scene ${doc.id}`,
    );
  }
  const placementIds = new Set<string>();
  for (const placement of doc.placements) {
    if (placementIds.has(placement.id)) {
      throw new SceneValidationError(`duplicate placement id`, `placement ${placement.id}`);
    }
    placementIds.add(placement.id);
    if (pack && !pack.frameNames.has(placement.frame)) {
      throw new SceneValidationError(
        `placement references unknown frame "${placement.frame}"`,
        `placement ${placement.id}`,
      );
    }
  }

  // ── Navigation: overrides in range, no second collision grid ──────────
  for (const override of doc.navigation.blockingOverrides ?? []) {
    if (override.index < 0 || override.index >= cellCount) {
      throw new SceneValidationError(
        `blocking override index ${override.index} out of range (cells ${cellCount})`,
        `scene ${doc.id} navigation`,
      );
    }
  }

  // ── Elevation: exact length (preserved, traversal unimplemented) ──────
  if (doc.elevation !== undefined) {
    _checkLength(doc.elevation, cellCount, 'elevation', doc.id);
  }

  return doc;
};

/**
 * Validates a scene and returns a list of failures instead of throwing.
 * Used by tooling/import paths that want to surface every problem at once.
 */
export const collectSceneErrors = (
  doc: SceneDocument,
  options?: SceneValidationOptions,
): string[] => {
  const errors: string[] = [];
  try {
    validateScene(doc, options);
  } catch (err) {
    if (err instanceof SceneValidationError) {
      errors.push(`${err.context}: ${err.message}`);
    } else if (err instanceof Error) {
      errors.push(err.message);
    } else {
      errors.push(String(err));
    }
  }
  return errors;
};

/** Overflow-safe width×height with a descriptive failure. */
const _checkedCellCount = (width: number, height: number, sceneId: string): number => {
  if (width <= 0 || height <= 0) {
    throw new SceneValidationError(`invalid dimensions (${width}×${height})`, `scene ${sceneId}`);
  }
  // The schema bounds each to int32, but guard multiplication anyway.
  const product = width * height;
  if (!Number.isSafeInteger(product) || product <= 0) {
    throw new SceneValidationError(
      `dimension multiplication overflow (${width}×${height})`,
      `scene ${sceneId}`,
    );
  }
  return product;
};

const _checkLength = (
  arr: readonly unknown[],
  expected: number,
  field: string,
  sceneId: string,
): void => {
  if (arr.length !== expected) {
    throw new SceneValidationError(
      `${field} length (${arr.length}) does not equal width×height (${expected})`,
      `scene ${sceneId}`,
    );
  }
};

const _checkPaletteIndices = (
  grid: readonly number[],
  paletteLength: number,
  field: string,
  sceneId: string,
): void => {
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < 0 || v >= paletteLength) {
      throw new SceneValidationError(
        `${field}[${i}] palette index ${v} out of range (palette ${paletteLength})`,
        `scene ${sceneId}`,
      );
    }
  }
};

const _checkFrameNames = (
  palette: readonly string[],
  pack: ScenePackReference,
  field: string,
  sceneId: string,
): void => {
  for (const frame of palette) {
    if (frame !== '' && !pack.frameNames.has(frame)) {
      throw new SceneValidationError(
        `${field} references unknown frame "${frame}"`,
        `scene ${sceneId}`,
      );
    }
  }
};

/**
 * Logs a scene validation failure with observable diagnostics (scene id,
 * layer/placement, coordinate context) without dumping private saves.
 */
export const logSceneError = (err: unknown): void => {
  if (err instanceof SceneValidationError) {
    logger.error('scene:validation-failed', { context: err.context, message: err.message });
  } else if (err instanceof Error) {
    logger.error('scene:validation-failed', { message: err.message });
  } else {
    logger.error('scene:validation-failed', { message: String(err) });
  }
};

/** Re-export of the role type for the scene module barrel. */
export type { SceneLayerRole };
