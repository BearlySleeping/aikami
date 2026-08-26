// apps/frontend/client/src/lib/data/lpc_renderer.ts
//
// LPC texture loading and frame extraction — instance-scoped, resolver-injected.
//
// Before C-444 this was a module-level singleton with global caches and a
// global setter (`setLpcUrlResolver`). Now it is created via
// `createLpcRenderer({ resolver })` and each instance owns its own caches.
//
// Two instances with different resolvers never share texture state.
//
// ## PixiJS Assets global cache note
// PixiJS's own `Assets.load()` is a global cache. Two renderers with different
// resolvers can still collide inside PixiJS's asset cache if they pass the
// same URL string. They will not, because the URLs differ by construction —
// but if a future resolver returns identical URLs, AC-2 must be re-examined.
//
// Contract: C-372, C-444

import { resolveLpcSheetGeometry } from '@aikami/frontend/engine/content';
import type { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import { lpcStateSuffix } from '@aikami/lpc';
import type { AssetResolver } from '@aikami/types';
import { Rectangle, Sprite, Texture } from 'pixi.js';
import { logger } from '$logger';

// ── Sheet layout detection ────────────────────────────────────────────────

// C-428: LpcSheetLayout and detectLpcSheetLayout are replaced by the shared
// resolver in @aikami/frontend/engine. This file delegates to it.
//
// The old type had `scale: number` which could be 0.5 — the bug. The new
// resolver always returns `scale: 1` and uses anchorOffset for positioning.
//
// Re-export the shared types for backward compatibility with existing callers.

/**
 * @deprecated Use the shared LpcSheetGeometry from @aikami/frontend/engine.
 *   Re-exported here for backward compatibility.
 */
export type LpcSheetLayout = import('@aikami/frontend/engine').LpcSheetGeometry;

/**
 * Detects the cell layout of an LPC spritesheet.
 *
 * Delegates to the shared engine resolver. Returns the resolved geometry
 * including pitch, columns, rows, scale (always 1), and anchorOffset.
 */
export const detectLpcSheetLayout = (sheet: { width: number; height: number }): LpcSheetLayout =>
  resolveLpcSheetGeometry(sheet);

// ── LPC renderer type ─────────────────────────────────────────────────────

/**
 * Instance-scoped LPC renderer. Created via `createLpcRenderer({ resolver })`.
 *
 * Each instance owns its own sheet, frame, and promise caches. Two instances
 * with different resolvers never share texture state.
 */
export type LpcRenderer = {
  /**
   * Loads a spritesheet for a given asset and animation state.
   * Caches results. Falls back to Texture.EMPTY on failure or unmapped asset.
   */
  loadSheet(assetId: string, state: LpcAnimationState): Promise<Texture>;

  /**
   * Extracts a single frame from a spritesheet texture.
   * Caches extracted frames per instance.
   */
  extractFrame(sheet: Texture, frame: number, direction: LpcDirection): Texture | null;

  /**
   * Full pipeline: load sheet + extract frame. Returns a ready-to-use Texture.
   */
  getFrameTexture(
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
  ): Promise<Texture | null>;

  /**
   * Creates a PixiJS Sprite for an LPC layer.
   * Returns null if the asset can't be loaded.
   */
  createSprite(
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
    zIndex: number,
  ): Promise<Sprite | null>;

  /**
   * Clears all instance caches (useful for testing or memory pressure).
   */
  clearCaches(): void;

  /** The resolver this renderer was created with. */
  readonly resolver: AssetResolver;
};

// ── Per-state fallback chains ─────────────────────────────────────────────

/**
 * Per-state fallback suffix chains tried when the requested state's sheet is
 * missing (only after the manifest is loaded, i.e. a permanent unmapped asset).
 *
 * The chain ends with `walk` because every weapon/armour asset ships a walk
 * sheet — so a layer degrades to its walk pose instead of vanishing.
 */
const STATE_FALLBACK_CHAINS: Record<string, readonly string[]> = {
  slash: ['idle', 'walk'],
  thrust: ['idle', 'walk'],
  spellcast: ['idle', 'walk'],
  shoot: ['idle', 'walk'],
  hurt: ['idle', 'walk'],
};

/** Fallback chain for states without a specific mapping (e.g. `walk`). */
const DEFAULT_STATE_FALLBACKS: readonly string[] = ['idle', 'walk'];

/**
 * State-aware asset aliases: when an asset lacks a sheet for a state, render
 * the same state from a sibling asset instead.
 */
const STATE_ASSET_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'weapon/sword/longsword': { slash: 'weapon/sword/longsword_alt' },
  'weapon/sword/saber': { slash: 'weapon/sword/scimitar' },
  'weapon/sword/rapier': { slash: 'weapon/sword/scimitar' },
};

// ── Anchor helper ─────────────────────────────────────────────────────────

/**
 * Returns the sprite anchor (top-left, sprite-local px) for a sheet layout.
 *
 * Delegates to the shared resolver's anchorOffset. Oversize cells use -64,-64
 * and standard cells use -32,-32 — both centre the logical 64px body region.
 */
export const getLpcSpriteAnchor = (layout: LpcSheetLayout): { x: number; y: number } => ({
  x: layout.anchorOffset.x,
  y: layout.anchorOffset.y,
});

// ── createLpcRenderer ─────────────────────────────────────────────────────

/**
 * Creates an instance-scoped LPC renderer.
 *
 * @param options.resolver - The AssetResolver to use for URL resolution.
 * @returns An LpcRenderer instance with its own caches.
 */
export const createLpcRenderer = (options: { resolver: AssetResolver }): LpcRenderer => {
  const { resolver } = options;

  // Instance-scoped caches
  const _sheetCache = new Map<string, Texture>();
  const _sheetPromises = new Map<string, Promise<Texture>>();
  const _frameCache = new Map<string, Texture>();
  let _manifestReady = false;

  logger.debug('lpcRenderer:created', { kind: resolver.kind });

  /**
   * Marks whether the asset manifest has finished loading.
   *
   * Until this is true, an unresolvable URL is treated as *transient* (the
   * manifest may simply not have loaded yet) and is NOT cached, so a later
   * call after the manifest resolves can retry. Once true, a null resolution
   * is a genuinely unmapped asset and is cached as Texture.EMPTY (fallback).
   */
  const _setManifestReady = (ready: boolean): void => {
    _manifestReady = ready;
    if (ready) {
      // Drop any Texture.EMPTY entries cached while the manifest was loading,
      // so a later render attempt resolves them properly.
      for (const [key, texture] of _sheetCache) {
        if (texture === Texture.EMPTY) {
          _sheetCache.delete(key);
        }
      }
    }
  };

  /**
   * Resolves an LPC asset URL through the injected resolver.
   */
  const _resolveUrl = (assetId: string, state: LpcAnimationState | string): string | null => {
    const url = resolver.resolve(assetId);
    if (!url) {
      logger.warn('lpcRenderer:unresolvable', { assetId, state: String(state) });
      return null;
    }
    return url;
  };

  /**
   * Low-level sheet loader for a concrete filename suffix.
   */
  const _loadSheetBySuffix = async (assetId: string, stateSuffix: string): Promise<Texture> => {
    const url = resolver.resolve(assetId);
    if (!url) {
      if (!_manifestReady) {
        // Manifest not loaded yet — treat as transient, do not cache EMPTY.
        logger.debug('lpcRenderer:manifestNotReady', { assetId, stateSuffix });
        return Texture.EMPTY;
      }
      logger.warn('lpcRenderer:unmapped', { assetId, stateSuffix });
      return Texture.EMPTY;
    }
    try {
      const { Assets } = await import('pixi.js');
      const texture = await Assets.load(url);
      texture.source.scaleMode = 'nearest';
      return texture;
    } catch (err) {
      logger.warn('lpcRenderer:loadFailed', { assetId, stateSuffix, url, error: String(err) });
      // Transient failure — do not permanently cache EMPTY; a later call retries.
      return Texture.EMPTY;
    }
  };

  const loadSheet = async (assetId: string, state: LpcAnimationState): Promise<Texture> => {
    const stateSuffix = lpcStateSuffix(state);
    const key = `${assetId}.${stateSuffix}`;

    const cached = _sheetCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = _sheetPromises.get(key);
    if (pending) {
      return pending;
    }

    const promise = (async () => {
      const primary = await _loadSheetBySuffix(assetId, stateSuffix);
      if (primary !== Texture.EMPTY) {
        _sheetCache.set(key, primary);
        return primary;
      }

      // State-aware asset alias: when this asset has no sheet for the state,
      // render the same state from a configured sibling asset.
      if (_manifestReady) {
        const aliasAssetId = STATE_ASSET_ALIASES[assetId]?.[stateSuffix];
        if (aliasAssetId && aliasAssetId !== assetId) {
          const aliasSheet = await _loadSheetBySuffix(aliasAssetId, stateSuffix);
          if (aliasSheet !== Texture.EMPTY) {
            logger.warn('lpcRenderer:stateAssetAlias', {
              assetId,
              requested: stateSuffix,
              alias: aliasAssetId,
            });
            _sheetCache.set(key, aliasSheet);
            return aliasSheet;
          }
        }
      }

      // State fallback: when the requested state's sheet is missing and the
      // manifest is loaded, walk the per-state fallback chain.
      if (_manifestReady && stateSuffix !== 'idle') {
        const chain = STATE_FALLBACK_CHAINS[stateSuffix] ?? DEFAULT_STATE_FALLBACKS;
        for (const fallbackSuffix of chain) {
          if (fallbackSuffix === stateSuffix) {
            continue;
          }
          const fallback = await _loadSheetBySuffix(assetId, fallbackSuffix);
          if (fallback !== Texture.EMPTY) {
            logger.warn('lpcRenderer:stateFallback', {
              assetId,
              requested: stateSuffix,
              fallback: fallbackSuffix,
            });
            _sheetCache.set(key, fallback);
            return fallback;
          }
        }
      }

      // Genuinely missing everywhere — cache EMPTY only once the manifest is
      // loaded so a later manifest revision can still resolve it.
      if (_manifestReady) {
        _sheetCache.set(key, Texture.EMPTY);
      }
      return Texture.EMPTY;
    })();

    _sheetPromises.set(key, promise);
    void promise.finally(() => {
      _sheetPromises.delete(key);
    });
    return promise;
  };

  const extractFrame = (sheet: Texture, frame: number, direction: LpcDirection): Texture | null => {
    if (sheet === Texture.EMPTY) {
      return null;
    }

    const layout = detectLpcSheetLayout(sheet);

    const col = frame % layout.columns;
    const row = layout.rows > 1 ? direction % layout.rows : 0;
    const x = col * layout.pitch;
    const y = row * layout.pitch;

    if (x + layout.pitch > sheet.width || y + layout.pitch > sheet.height) {
      return null;
    }

    const cacheKey = `${sheet.uid}:${col}:${row}:${layout.pitch}`;
    const cached = _frameCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = new Texture({
      source: sheet.source,
      frame: new Rectangle(x, y, layout.pitch, layout.pitch),
    });
    _frameCache.set(cacheKey, result);
    return result;
  };

  const getFrameTexture = async (
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
  ): Promise<Texture | null> => {
    const stateSuffix = lpcStateSuffix(state);
    const frameKey = `${assetId}.${stateSuffix}:${frame}:${direction}`;

    const cached = _frameCache.get(frameKey);
    if (cached) {
      return cached;
    }

    const sheet = await loadSheet(assetId, state);
    if (!sheet || sheet === Texture.EMPTY) {
      return null;
    }

    const result = extractFrame(sheet, frame, direction);
    if (result) {
      _frameCache.set(frameKey, result);
    }
    return result;
  };

  const createSprite = async (
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
    zIndex: number,
  ): Promise<Sprite | null> => {
    const sheet = await loadSheet(assetId, state);
    if (!sheet || sheet === Texture.EMPTY) {
      return null;
    }

    const texture = extractFrame(sheet, frame, direction);
    if (!texture) {
      return null;
    }

    const layout = detectLpcSheetLayout(sheet);
    const anchor = getLpcSpriteAnchor(layout);
    const sprite = new Sprite(texture);
    sprite.eventMode = 'none';
    sprite.x = anchor.x;
    sprite.y = anchor.y;
    sprite.scale.set(layout.scale, layout.scale);
    sprite.alpha = 1.0;
    sprite.zIndex = zIndex;
    return sprite;
  };

  const clearCaches = (): void => {
    _sheetCache.clear();
    _sheetPromises.clear();
    _frameCache.clear();
  };

  return {
    loadSheet,
    extractFrame,
    getFrameTexture,
    createSprite,
    clearCaches,
    resolver,
  };
};
