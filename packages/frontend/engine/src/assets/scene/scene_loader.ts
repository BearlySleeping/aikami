// packages/frontend/engine/src/assets/scene/scene_loader.ts
//
// C-505 — Unified scene loader boundary.
//
// This is the single entry point that chooses the canonical scene at the
// loader boundary (not an additional render path): native `aikami.scene`
// documents are parsed directly, while legacy Tiled JSON / JTON are
// normalized through the compatibility adapters. Every path yields a
// validated {@link SceneDocument} plus its {@link CompiledScene}, so preview
// and game share one interpretation (architecture directive 1).

import type { SceneDocument } from '@aikami/types';
import { logger } from '$logger';
import {
  loadJtonMap,
  loadTilemap,
  type RegistryBackedLoadOptions,
  type TilemapData,
  type TilemapTileset,
} from '../map_loader.ts';
import { parseNativeScene, SceneUnsupportedFormatError } from './native_scene.ts';
import {
  type CompiledScene,
  compileScene,
  compileSceneToTilemap,
  type SceneCompileContext,
} from './scene_compiler.ts';
import { type ScenePackReference, validateScene } from './scene_validator.ts';
import { type TiledAdapterOptions, tilemapToScene } from './tiled_adapter.ts';

export type SceneLoadResult = {
  /** The validated canonical scene document. */
  doc: SceneDocument;
  /** The compiled runtime scene. */
  compiled: CompiledScene;
  /** Source format: native, tiled, or jton. */
  source: 'native' | 'tiled' | 'jton';
};

/**
 * Result of {@link loadMapCanonical}: always a render-ready TilemapData, plus
 * the canonical scene when normalization ran (packless fallback omits it).
 */
export type CanonicalMapLoad = {
  /** The canonical {@link TilemapData} the render/collision/terrain consumes. */
  tilemap: TilemapData;
  /** Validated canonical scene document (omitted on packless fallback). */
  doc?: SceneDocument;
  /** Compiled runtime scene (omitted on packless fallback). */
  compiled?: CompiledScene;
  /** Source format: tiled or jton. */
  source: 'tiled' | 'jton';
};

export type SceneLoadOptions = {
  /** Canonical scene id (source-derived for legacy maps). */
  sceneId: string;
  /** Installed asset-lock reference. */
  assetLock: string;
  /** Optional pack reference for strict reference validation. */
  pack?: ScenePackReference;
  /** Pack terrain definitions for compiling terrain surfaces. */
  terrains?: SceneCompileContext['terrains'];
  /** Adapter options forwarded to the Tiled/JTON normalization. */
  adapter?: Omit<TiledAdapterOptions, 'sceneId' | 'assetLock'>;
};

/**
 * Normalizes a legacy {@link TilemapData} into a validated scene and compiles
 * it. Shared by the preview and the game so both consume real scene data.
 */
export const sceneFromTilemap = (
  tilemap: TilemapData,
  options: SceneLoadOptions,
): SceneLoadResult => {
  const doc = tilemapToScene(tilemap, {
    sceneId: options.sceneId,
    assetLock: options.assetLock,
    ...options.adapter,
  });
  validateScene(doc, options.pack ? { pack: options.pack } : undefined);
  const compiled = compileScene(doc, options.terrains ? { terrains: options.terrains } : undefined);
  return { doc, compiled, source: 'tiled' };
};

/**
 * Parses, validates and compiles a native scene document.
 *
 * @param raw - Raw scene JSON bytes or object.
 * @param options - Compile options.
 * @returns The validated document and compiled runtime scene.
 */
export const sceneFromNative = (
  raw: string | unknown,
  options: SceneLoadOptions,
): SceneLoadResult => {
  const doc = parseNativeScene(raw, options.pack ? { pack: options.pack } : undefined);
  const compiled = compileScene(doc, options.terrains ? { terrains: options.terrains } : undefined);
  return { doc, compiled, source: 'native' };
};

/**
 * Loads a scene by URL, auto-detecting the format. Throws
 * {@link SceneUnsupportedFormatError} for future authoring formats (AC-7).
 */
export const loadScene = async (
  options: {
    url: string;
    fetch?: typeof fetch;
    resolveTag?: (tag: string) => string | null;
  } & SceneLoadOptions,
): Promise<SceneLoadResult> => {
  const { url, fetch: fetcher, resolveTag, ...loadOptions } = options;
  const resolvedUrl = resolveTag ? (resolveTag(url) ?? url) : url;
  const f = fetcher ?? globalThis.fetch;
  const response = await f(resolvedUrl);
  if (!response.ok) {
    throw new Error(`SceneLoader: failed to fetch scene "${url}" (HTTP ${response.status})`);
  }
  const text = await response.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const kind = parsed?.kind;
    if (kind === 'aikami.scene') {
      logger.debug('sceneLoader:native', { url, sceneId: loadOptions.sceneId });
      return sceneFromNative(parsed, loadOptions);
    }
    // Tiled JSON map (has layers/tilesets, not an aikami scene).
    return sceneFromTilemap(parsed as TilemapData, loadOptions);
  }
  throw new SceneUnsupportedFormatError('unknown');
};

/**
 * Production map-load entry that routes a legacy map through the canonical
 * scene pipeline and returns the canonical {@link TilemapData} the existing
 * render/collision/terrain code consumes.
 *
 * This is the AC-1 integration: `/game` keeps its proven downstream consumers
 * but the active runtime data is now compiled FROM a validated canonical
 * scene document — the loader boundary, not a second render path. Returns
 * both the canonical tilemap and the scene (doc + compiled) so callers can
 * observe the single interpretation.
 */
export const loadMapCanonical = async (options: {
  url: string;
  fetch?: typeof fetch;
  resolveTag?: (tag: string) => string | null;
  releaseUrl?: (url: string) => void;
  /** Canonical scene id (defaults to the URL basename). */
  sceneId?: string;
  /** Installed asset-lock reference. */
  assetLock?: string;
  /** Base terrain id for terrain-channel maps (the pack's lowest fill). */
  baseTerrain?: string;
  /** Pack terrain definitions for compiling terrain surfaces. */
  terrains?: SceneCompileContext['terrains'];
  /** Persisted legacy → canonical placement-id mapping (AC-3). */
  identityMap?: Record<string, string>;
}): Promise<CanonicalMapLoad> => {
  const { url, resolveTag, releaseUrl, sceneId, assetLock, baseTerrain, terrains, identityMap } =
    options;
  const registry: RegistryBackedLoadOptions = { resolveTag, releaseUrl };
  const isJton = url.endsWith('.jton');
  const legacy = isJton
    ? await loadJtonMap({ url, ...registry, fetch: options.fetch })
    : await loadTilemap({ url, ...registry, fetch: options.fetch });

  const id = sceneId ?? (url.split('/').pop() ?? url).replace(/\.(json|jton)$/i, '');

  // A terrain-channel map needs a base terrain to normalize. Packless dev
  // sandbox maps without one fall back to the legacy parse so the game still
  // boots; canonical normalization is the authority whenever it can run.
  if (legacy.terrain && !baseTerrain) {
    logger.debug('loadMapCanonical:legacy-fallback', {
      url,
      hint: 'terrain channel without baseTerrain',
    });
    return { tilemap: legacy, source: isJton ? 'jton' : 'tiled' };
  }

  const result = sceneFromTilemap(legacy, {
    sceneId: id,
    assetLock: assetLock ?? 'pack:emberwatch',
    terrains,
    adapter: {
      baseTerrain,
      identityMap,
      dropGroundDuplicateDecor: false,
      // Shipped Emberwatch maps store every layer as raw Tiled GIDs (no C-378
      // `frames` array). Without a resolver the canonical adapter cannot
      // normalize ground/decor/overhead and the game fails to boot (C-505 AC-1
      // regression caught by manual /game testing). Map each GID to its grid
      // frame name so normalization succeeds and stays lossless.
      frameResolver: _buildGidFrameResolver(legacy.tilesets),
    },
  });

  const tilemap = compileSceneToTilemap(result.compiled, result.doc, legacy);
  logger.debug('loadMapCanonical:canonical', {
    url,
    sceneId: id,
    layers: tilemap.layers.length,
    placements: result.doc.placements.length,
  });
  return { ...result, tilemap, source: isJton ? 'jton' : 'tiled' };
};

/**
 * Builds a GID → logical frame-name resolver for legacy maps whose layers
 * store raw Tiled GIDs (no C-378 `frames` array). Maps each GID to its grid
 * frame name `${tileset}_<localId>.png` using the containing tileset's
 * `firstgid`/`tilecount`:
 *
 *   localTileId = gid - firstgid + 1
 *
 * `_<n>` is the C-378 frame convention the preview's frame sampler parses, so
 * the canonical doc stays lossless and previewable while /game keeps rendering
 * the preserved GID layers. Returns undefined for GIDs outside every declared
 * tileset — the adapter then throws a recoverable {@link SceneConversionError}
 * rather than silently blanking a malformed map.
 */
const _buildGidFrameResolver =
  (tilesets: readonly TilemapTileset[]): ((gid: number, layerName: string) => string | undefined) =>
  (gid: number): string | undefined => {
    if (!gid) {
      return undefined;
    }
    const tileset = tilesets.find((t) => gid >= t.firstgid && gid < t.firstgid + t.tilecount);
    if (!tileset) {
      return undefined;
    }
    const localTileId = gid - tileset.firstgid + 1;
    const stem =
      tileset.name ?? (tileset.image ? tileset.image.replace(/\.[a-z0-9]+$/i, '') : 'tile');
    return `${stem}_${localTileId}.png`;
  };
