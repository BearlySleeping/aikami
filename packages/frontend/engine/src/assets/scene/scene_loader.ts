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
import type { TilemapData } from '../map_loader.ts';
import { parseNativeScene, SceneUnsupportedFormatError } from './native_scene.ts';
import { type CompiledScene, compileScene, type SceneCompileContext } from './scene_compiler.ts';
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
