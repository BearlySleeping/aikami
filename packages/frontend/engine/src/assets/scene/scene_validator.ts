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
  SCENE_FRAME_EMPTY_INDEX,
  SCENE_MAX_CELLS,
  SCENE_MAX_PLACEMENTS,
  SCENE_MAX_TRANSITIONS,
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
  _traverseScene(doc, options, (error) => {
    throw error;
  });
  return doc;
};

type SceneErrorReporter = (error: SceneValidationError) => void;

/** Shared semantic traversal used by fail-fast and error-collection modes. */
const _traverseScene = (
  doc: SceneDocument,
  options: SceneValidationOptions | undefined,
  report: SceneErrorReporter,
): void => {
  const pack = options?.pack;
  const { width, height } = doc.extent;

  // ── Bounded dimensions / overflow-safe cell count (AC-6) ──────────────
  let cellCount: number | undefined;
  if (width <= 0 || height <= 0) {
    report(new SceneValidationError(`invalid dimensions (${width}×${height})`, `scene ${doc.id}`));
  } else {
    const product = width * height;
    if (!Number.isSafeInteger(product) || product <= 0) {
      report(
        new SceneValidationError(
          `dimension multiplication overflow (${width}×${height})`,
          `scene ${doc.id}`,
        ),
      );
    } else {
      cellCount = product;
    }
  }
  if (cellCount !== undefined && cellCount > SCENE_MAX_CELLS) {
    report(
      new SceneValidationError(
        `scene exceeds SCENE_MAX_CELLS (${cellCount} > ${SCENE_MAX_CELLS})`,
        `scene ${doc.id}`,
      ),
    );
  }

  // ── Surface: exactly one authoritative ground source ──────────────────
  const surface = doc.surface;
  if (surface.mode === 'terrain') {
    if (cellCount !== undefined) {
      _checkLength(surface.cells, cellCount, 'surface.terrain.cells', doc.id, report);
    }
    if (
      surface.matchingMode !== undefined &&
      !SCENE_TERRAIN_MATCHING_MODES.includes(surface.matchingMode)
    ) {
      report(
        new SceneValidationError(
          `unsupported terrain matching mode "${surface.matchingMode}"`,
          `scene ${doc.id} surface`,
        ),
      );
    }
    // Strict reference validation: every cell's terrain must be declared or
    // equal the default (AC-4). Unknown terrain ids fail explicitly.
    if (pack) {
      const known = new Set(pack.terrainIds);
      const defaultId = surface.defaultTerrain;
      if (!known.has(defaultId)) {
        report(
          new SceneValidationError(
            `default terrain "${defaultId}" is not declared in the pack`,
            `scene ${doc.id} surface`,
          ),
        );
      }
      const unknown = new Set<string>();
      for (const id of surface.cells) {
        if (id !== '' && id !== defaultId && !known.has(id)) {
          unknown.add(id);
        }
      }
      if (unknown.size > 0) {
        report(
          new SceneValidationError(
            `unknown terrain id(s): ${[...unknown].sort().join(', ')}`,
            `scene ${doc.id} surface`,
          ),
        );
      }
    }
  } else {
    if (cellCount !== undefined) {
      _checkLength(surface.grid, cellCount, 'surface.baked.grid', doc.id, report);
    }
    _checkPaletteIndices(
      surface.grid,
      surface.palette.length,
      'surface.baked.grid',
      doc.id,
      report,
    );
    _checkFrameNames(surface.palette, pack, 'surface.baked.palette', doc.id, report);
  }

  // ── Visual layers: unique ids, exact grids, in-range indices (AC-2) ───
  if (doc.layers.length > SCENE_MAX_VISUAL_LAYERS) {
    report(
      new SceneValidationError(
        `too many visual layers (${doc.layers.length} > ${SCENE_MAX_VISUAL_LAYERS})`,
        `scene ${doc.id}`,
      ),
    );
  }
  const layerIds = new Set<string>();
  for (const layer of doc.layers) {
    if (layerIds.has(layer.id)) {
      report(new SceneValidationError(`duplicate visual layer id`, `layer ${layer.id}`));
    }
    layerIds.add(layer.id);
    if (layer.role === 'ground') {
      // Ground is owned by the surface — a ground visual layer would be a
      // second authoritative ground source (architecture directive 3).
      report(
        new SceneValidationError(
          `visual layer declares role "ground" — ground is owned by the surface`,
          `layer ${layer.id}`,
        ),
      );
    }
    if (cellCount !== undefined) {
      _checkLength(layer.grid, cellCount, `layers[${layer.id}].grid`, doc.id, report);
    }
    _checkPaletteIndices(
      layer.grid,
      layer.palette.length,
      `layers[${layer.id}].grid`,
      doc.id,
      report,
    );
    _checkFrameNames(layer.palette, pack, `layers[${layer.id}].palette`, doc.id, report);
  }

  // ── Placements: unique stable ids (AC-2 / AC-3) ───────────────────────
  if (doc.placements.length > SCENE_MAX_PLACEMENTS) {
    report(
      new SceneValidationError(
        `too many placements (${doc.placements.length} > ${SCENE_MAX_PLACEMENTS})`,
        `scene ${doc.id}`,
      ),
    );
  }
  const placementIds = new Set<string>();
  for (const placement of doc.placements) {
    if (placementIds.has(placement.id)) {
      report(new SceneValidationError(`duplicate placement id`, `placement ${placement.id}`));
    }
    placementIds.add(placement.id);
    if (pack && !pack.frameNames.has(placement.frame)) {
      report(
        new SceneValidationError(
          `placement references unknown frame "${placement.frame}"`,
          `placement ${placement.id}`,
        ),
      );
    }
  }

  if ((doc.transitions?.length ?? 0) > SCENE_MAX_TRANSITIONS) {
    report(
      new SceneValidationError(
        `too many transitions (${doc.transitions?.length ?? 0} > ${SCENE_MAX_TRANSITIONS})`,
        `scene ${doc.id}`,
      ),
    );
  }

  // ── Navigation: overrides in range, no second collision grid ──────────
  for (const override of doc.navigation.blockingOverrides ?? []) {
    if (cellCount !== undefined && (override.index < 0 || override.index >= cellCount)) {
      report(
        new SceneValidationError(
          `blocking override index ${override.index} out of range (cells ${cellCount})`,
          `scene ${doc.id} navigation`,
        ),
      );
    }
  }

  // ── Elevation: exact length (preserved, traversal unimplemented) ──────
  if (doc.elevation !== undefined && cellCount !== undefined) {
    _checkLength(doc.elevation, cellCount, 'elevation', doc.id, report);
  }
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
    _traverseScene(doc, options, (error) => {
      errors.push(`${error.context}: ${error.message}`);
    });
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

const _checkLength = (
  arr: readonly unknown[],
  expected: number,
  field: string,
  sceneId: string,
  report: SceneErrorReporter,
): void => {
  if (arr.length !== expected) {
    report(
      new SceneValidationError(
        `${field} length (${arr.length}) does not equal width×height (${expected})`,
        `scene ${sceneId}`,
      ),
    );
  }
};

const _checkPaletteIndices = (
  grid: readonly number[],
  paletteLength: number,
  field: string,
  sceneId: string,
  report: SceneErrorReporter,
): void => {
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < 0 || v >= paletteLength) {
      report(
        new SceneValidationError(
          `${field}[${i}] palette index ${v} out of range (palette ${paletteLength})`,
          `scene ${sceneId}`,
        ),
      );
    }
  }
};

const _checkFrameNames = (
  palette: readonly string[],
  pack: ScenePackReference | undefined,
  field: string,
  sceneId: string,
  report: SceneErrorReporter,
): void => {
  for (let index = 0; index < palette.length; index++) {
    const frame = palette[index];
    if (frame === '' && index !== SCENE_FRAME_EMPTY_INDEX) {
      report(
        new SceneValidationError(
          `${field}[${index}] is empty; only palette index ${SCENE_FRAME_EMPTY_INDEX} may be empty`,
          `scene ${sceneId}`,
        ),
      );
    } else if (frame !== '' && pack && !pack.frameNames.has(frame)) {
      report(
        new SceneValidationError(
          `${field} references unknown frame "${frame}"`,
          `scene ${sceneId}`,
        ),
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
