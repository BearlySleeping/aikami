// packages/frontend/engine/src/assets/scene/tiled_adapter.ts
//
// C-505 — Tiled/JTON compatibility adapter.
//
// Converts the legacy {@link TilemapData} (Tiled JSON / JTON) into the
// canonical {@link SceneDocument} at the loader boundary. This is the single
// normalization point — preview and game share it (architecture directive 1).
//
// Identity is recovered from the SOURCE mapping, never from array order or
// mutable position (AC-3): an imported object keeps its Tiled `id` as its
// stable placement id, or is looked up in the caller's persisted identity
// map. When identity cannot be established, conversion FAILS (recoverably)
// rather than resetting collected loot/doors.
//
// The proven Emberwatch ground/decor duplication is cleaned via a TARGETED
// option (keyed to that source), never a global "decor == ground" heuristic
// that could delete legitimate intentional art (C-505 Overlap policy).

import type {
  SceneBakedSurface,
  SceneDocument,
  SceneLayerRole,
  ScenePlacement,
  SceneTerrainSurface,
  SceneTransition,
} from '@aikami/types';
import { logger } from '$logger';
import type { TilemapData } from '../map_loader.ts';

/** Thrown when a legacy source cannot be normalized — caller may recover. */
export class SceneConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneConversionError';
  }
}

/** Options controlling legacy Tiled/JTON normalization into a canonical scene. */
export type TiledAdapterOptions = {
  /** Stable canonical scene id (source-derived, not positional). */
  sceneId: string;
  /** Installed asset-lock reference for immutable visual references. */
  assetLock: string;
  /** Source identity, e.g. `tiled:emberwatch/inn.tmj`. */
  source?: string;
  /** Source revision (e.g. file hash) for provenance/migration. */
  revision?: string;
  /**
   * Base terrain id used as the terrain-surface default (the pack's lowest-
   * precedence fill). Required for terrain-channel maps without a declared
   * default.
   */
  baseTerrain?: string;
  /**
   * Resolves a layer GID to a logical frame name for baked layers. Required
   * when a layer has no C-378 `frames` array (legacy GID-only maps).
   */
  frameResolver?: (gid: number, layerName: string) => string | undefined;
  /** Persisted legacy → canonical placement-id mapping (AC-3). */
  identityMap?: Record<string, string>;
  /**
   * Targeted Emberwatch cleanup: drop decor layers that are byte-identical to
   * the ground surface. Defaults false — NEVER a global heuristic.
   */
  dropGroundDuplicateDecor?: boolean;
};

/**
 * Normalizes a {@link TilemapData} into a canonical {@link SceneDocument}.
 *
 * @param tilemap - Parsed legacy map (Tiled JSON or JTON via the existing
 *   loaders).
 * @param options - Adapter configuration (scene id, asset lock, resolvers).
 * @returns The canonical scene document.
 * @throws {@link SceneConversionError} when identity or frame references
 *   cannot be established.
 */
export const tilemapToScene = (
  tilemap: TilemapData,
  options: TiledAdapterOptions,
): SceneDocument => {
  const {
    sceneId,
    assetLock,
    source = 'tiled',
    revision,
    baseTerrain,
    frameResolver,
    identityMap,
  } = options;
  if (tilemap.tilewidth !== tilemap.tileheight) {
    throw new SceneConversionError(
      `scene "${sceneId}" uses non-square tiles (${tilemap.tilewidth}×${tilemap.tileheight})`,
    );
  }
  const cellCount = tilemap.width * tilemap.height;

  // ── Surface (single authoritative ground source) ──────────────────────
  let surface: SceneTerrainSurface | SceneBakedSurface;
  if (tilemap.terrain) {
    if (!baseTerrain || baseTerrain.length === 0) {
      throw new SceneConversionError(
        `scene "${sceneId}" has a terrain channel but no baseTerrain was provided`,
      );
    }
    surface = {
      mode: 'terrain',
      defaultTerrain: baseTerrain,
      cells: [...tilemap.terrain],
      matchingMode: 'corner16',
    };
  } else {
    const groundLayer = _groundLayer(tilemap);
    if (!groundLayer) {
      throw new SceneConversionError(`scene "${sceneId}" has no ground layer to normalize`);
    }
    const { palette, grid } = _layerToPalette(groundLayer, frameResolver, sceneId, source);
    surface = { mode: 'baked', palette, grid };
  }

  // ── Visual layers (decor / overhead) ───────────────────────────────────
  const layers: SceneDocument['layers'] = [];
  let groundFrame: readonly (string | 0)[] | undefined;
  const groundLayer = _groundLayer(tilemap);
  if (groundLayer) {
    groundFrame = groundLayer.frames ?? _layerFramesFromGids(groundLayer, frameResolver);
  }
  const seenRoleOrder = { decor: 0, overhead: 0 };
  for (const layer of tilemap.layers) {
    const role = _layerRole(layer);
    if (role === 'ground' || role === 'collision') {
      continue; // ground is owned by the surface; collision is non-visual
    }
    // Targeted Emberwatch cleanup: a decor layer identical to ground is a
    // duplicate source contribution, not an intentional decal.
    if (role === 'decor' && options.dropGroundDuplicateDecor && groundFrame) {
      const frames = layer.frames ?? _layerFramesFromGids(layer, frameResolver);
      if (frames && _arraysEqual(frames, groundFrame)) {
        logger.info('tiledAdapter:dropped-ground-duplicate-decor', {
          scene: sceneId,
          layer: layer.name,
          source,
          hint: 'Targeted Emberwatch cleanup — decor byte-identical to ground dropped as duplicate source ownership.',
        });
        continue;
      }
    }
    const { palette, grid } = _layerToPalette(layer, frameResolver, sceneId, source);
    layers.push({
      id: layer.name,
      role,
      order: seenRoleOrder[role]++,
      palette,
      grid,
    });
  }

  // ── Placements (stable ids from source / identity map) ────────────────
  const placements: ScenePlacement[] = [];
  const transitions: SceneTransition[] = [];
  for (const objectLayer of tilemap.objectLayers ?? []) {
    for (const object of objectLayer.objects) {
      const type = typeof object.type === 'string' ? object.type : '';
      const rawId = object.id;
      if (type === 'transition') {
        transitions.push(_toTransition(object));
        continue;
      }
      if (!type || type === 'collision') {
        continue; // not a placed entity
      }
      if (rawId === undefined) {
        throw new SceneConversionError(
          `scene "${sceneId}" object "${object.name ?? '(unnamed)'}" has no stable id — ` +
            'cannot recover persistent identity (AC-3). Provide an identityMap or fix the source.',
        );
      }
      const legacyId = String(rawId);
      const mappedId = identityMap?.[legacyId];
      if (mappedId !== undefined && mappedId.length === 0) {
        throw new SceneConversionError(
          `scene "${sceneId}" identityMap maps legacy id "${legacyId}" to an empty id`,
        );
      }
      const placementId = mappedId ?? legacyId;
      // The sprite frame lives in the object's `frame` property (e.g.
      // "ward_large.png"), not in its type. Using the type here collapsed
      // every prop's frame to the literal "prop", so a canonical placement
      // could not be resolved to any art and the lossy round-trip through
      // compileSceneToTilemap wrote `frame: "prop"` back out.
      const placementProps = _props(object);
      const placementFrame =
        typeof placementProps.frame === 'string' && placementProps.frame.length > 0
          ? placementProps.frame
          : type;
      const placement: ScenePlacement = {
        id: placementId,
        component: type,
        frame: placementFrame,
        x: typeof object.x === 'number' ? object.x : 0,
        y: typeof object.y === 'number' ? object.y : 0,
        solid: placementProps.solid === true,
      };
      placements.push(placement);
    }
  }

  // ── Navigation blocking overrides (collision layer, additive) ──────────
  const blockingOverrides: { index: number; blocked: boolean }[] = [];
  const collisionLayer = tilemap.layers.find((l) => l.name === 'collision');
  if (collisionLayer) {
    for (let i = 0; i < cellCount; i++) {
      if (collisionLayer.data[i] !== 0) {
        blockingOverrides.push({ index: i, blocked: true });
      }
    }
  }

  const doc: SceneDocument = {
    kind: 'aikami.scene',
    schemaVersion: 1,
    id: sceneId,
    assetLock,
    extent: {
      width: tilemap.width,
      height: tilemap.height,
      tileSize: tilemap.tilewidth,
    },
    surface,
    layers,
    placements,
    navigation: { blockingOverrides },
    transitions: transitions.length > 0 ? transitions : undefined,
    elevation: tilemap.elevation ? [...tilemap.elevation] : undefined,
    provenance: {
      source,
      revision: revision ?? '',
      identityMap,
    },
  };

  return doc;
};

const _groundLayer = (tilemap: TilemapData) =>
  tilemap.layers.find((layer) => _layerRole(layer) === 'ground');

type LegacyLayerRole = SceneLayerRole | 'collision';

const _layerRole = (layer: { band?: string; name: string }): LegacyLayerRole => {
  const tokens = layer.name.toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes('collision')) {
    return 'collision';
  }
  if (layer.band === 'ground' || layer.band === 'decor' || layer.band === 'overhead') {
    return layer.band;
  }
  if (tokens.some((token) => ['ground', 'base', 'terrain', 'floor'].includes(token))) {
    return 'ground';
  }
  if (
    tokens.some((token) =>
      ['decor', 'decal', 'detail', 'details', 'wall', 'walls', 'props'].includes(token),
    )
  ) {
    return 'decor';
  }
  if (
    tokens.some((token) => ['overhead', 'canopy', 'foreground', 'roof', 'roofs'].includes(token))
  ) {
    return 'overhead';
  }
  throw new SceneConversionError(
    `layer "${layer.name}" has no band and its name does not identify ground, decor, or overhead`,
  );
};

/** Converts a layer to a frame palette + index grid. */
const _layerToPalette = (
  layer: { name: string; data?: readonly number[]; frames?: readonly (string | 0)[] },
  frameResolver: ((gid: number, layerName: string) => string | undefined) | undefined,
  sceneId: string,
  source: string,
): { palette: string[]; grid: number[] } => {
  if (layer.frames) {
    return _framesToPalette(layer.frames);
  }
  if (frameResolver && layer.data) {
    const frames: Array<string | 0> = new Array(layer.data.length).fill(0);
    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === 0) {
        continue;
      }
      const frame = frameResolver(gid, layer.name);
      if (!frame) {
        throw new SceneConversionError(
          `scene "${sceneId}" layer "${layer.name}" GID ${gid} has no resolvable frame — ` +
            `cannot normalize (source ${source}). Provide a frameResolver or frames array.`,
        );
      }
      frames[i] = frame;
    }
    return _framesToPalette(frames);
  }
  throw new SceneConversionError(
    `scene "${sceneId}" layer "${layer.name}" needs a frames array or a frameResolver to normalize`,
  );
};

const _framesToPalette = (
  frames: readonly (string | 0)[],
): { palette: string[]; grid: number[] } => {
  const indexByFrame = new Map<string, number>();
  const palette: string[] = [''];
  const grid = new Array<number>(frames.length).fill(0);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame) {
      continue;
    }
    let idx = indexByFrame.get(frame);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(frame);
      indexByFrame.set(frame, idx);
    }
    grid[i] = idx;
  }
  return { palette, grid };
};

const _layerFramesFromGids = (
  layer: { name: string; data?: readonly number[] },
  frameResolver: ((gid: number, layerName: string) => string | undefined) | undefined,
): Array<string | 0> | undefined => {
  if (!frameResolver || !layer.data) {
    return undefined;
  }
  const frames: Array<string | 0> = new Array(layer.data.length).fill(0);
  for (let i = 0; i < layer.data.length; i++) {
    const gid = layer.data[i];
    if (gid !== 0) {
      const frame = frameResolver(gid, layer.name);
      if (!frame) {
        return undefined;
      }
      frames[i] = frame;
    }
  }
  return frames;
};

const _toTransition = (object: Record<string, unknown>): SceneTransition => {
  if (object.id === undefined || String(object.id).length === 0) {
    throw new SceneConversionError(
      `transition "${String(object.name ?? '(unnamed)')}" has no stable id`,
    );
  }
  const props = _props(object);
  if (typeof props.targetMap !== 'string' || props.targetMap.length === 0) {
    throw new SceneConversionError(`transition "${String(object.id)}" has no targetMap`);
  }
  return {
    id: String(object.id),
    x: typeof object.x === 'number' ? object.x : 0,
    y: typeof object.y === 'number' ? object.y : 0,
    width: typeof object.width === 'number' ? object.width : 0,
    height: typeof object.height === 'number' ? object.height : 0,
    targetMap: props.targetMap,
    targetX: typeof props.targetX === 'number' ? props.targetX : 0,
    targetY: typeof props.targetY === 'number' ? props.targetY : 0,
    targetSpawnId: typeof props.targetSpawnId === 'string' ? props.targetSpawnId : undefined,
  };
};

const _props = (object: Record<string, unknown>): Record<string, unknown> => {
  const raw = object.properties;
  if (Array.isArray(raw)) {
    const result: Record<string, unknown> = {};
    for (const entry of raw) {
      if (entry && typeof entry === 'object' && 'name' in entry && 'value' in entry) {
        const { name, value } = entry as { name: string; value: unknown };
        if (typeof name === 'string' && name.length > 0) {
          result[name] = value;
        }
      }
    }
    return result;
  }
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
};

const _arraysEqual = (a: readonly (string | 0)[], b: readonly (string | 0)[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};
