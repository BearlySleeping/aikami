// packages/frontend/preview/src/lib/lpc/lpc_renderer.ts
//
// LPC texture loading and frame extraction — instance-scoped, resolver-injected.
// Moved from apps/frontend/client/src/lib/data/lpc_renderer.ts (C-445).
//
// Contract: C-372, C-444, C-445

import type { LpcAnimationState, LpcDirection } from '@aikami/lpc';
import { lpcStateSuffix, lpcTag } from '@aikami/lpc';
import type { AssetResolver } from '@aikami/types';
import { Assets, Rectangle, Sprite, Texture } from 'pixi.js';
import { resolveLpcSheetGeometry } from '../../../../engine/src/content.ts';
import type { LpcSheetGeometry } from '../../../../engine/src/index.ts';

// ── Sheet layout detection ────────────────────────────────────────────────

// C-428: LpcSheetLayout and detectLpcSheetLayout are replaced by the shared
// resolver in @aikami/frontend-engine. This file delegates to it.

/**
 * @deprecated Use the shared LpcSheetGeometry from @aikami/frontend-engine.
 *   Re-exported here for backward compatibility.
 */
export type LpcSheetLayout = LpcSheetGeometry;

/**
 * Detects the cell layout of an LPC spritesheet.
 * Delegates to the shared engine resolver.
 */
export const detectLpcSheetLayout = (sheet: { width: number; height: number }): LpcSheetLayout =>
  resolveLpcSheetGeometry(sheet);

// ── LPC renderer type ─────────────────────────────────────────────────────

/**
 * Instance-scoped LPC renderer. Created via `createLpcRenderer({ resolver })`.
 * Each instance owns its own sheet, frame, and promise caches.
 */
export type LpcRenderer = {
  /** Loads a spritesheet for a given asset and animation state. */
  loadSheet(assetId: string, state: LpcAnimationState): Promise<Texture>;

  /** Extracts a single frame from a spritesheet texture. */
  extractFrame(sheet: Texture, frame: number, direction: LpcDirection): Texture | null;

  /** Full pipeline: load sheet + extract frame. */
  getFrameTexture(
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
  ): Promise<Texture | null>;

  /** Creates a PixiJS Sprite for an LPC layer. */
  createSprite(
    assetId: string,
    state: LpcAnimationState,
    frame: number,
    direction: LpcDirection,
    zIndex: number,
  ): Promise<Sprite | null>;

  /** Clears all instance caches. */
  clearCaches(): void;

  /** The resolver this renderer was created with. */
  readonly resolver: AssetResolver;
};

// ── Per-state fallback chains ─────────────────────────────────────────────

const STATE_FALLBACK_CHAINS: Record<string, readonly string[]> = {
  slash: ['idle', 'walk'],
  thrust: ['idle', 'walk'],
  spellcast: ['idle', 'walk'],
  shoot: ['idle', 'walk'],
  hurt: ['idle', 'walk'],
};

const DEFAULT_STATE_FALLBACKS: readonly string[] = ['idle', 'walk'];

const STATE_ASSET_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'weapon/sword/longsword': { slash: 'weapon/sword/longsword_alt' },
  'weapon/sword/saber': { slash: 'weapon/sword/scimitar' },
  'weapon/sword/rapier': { slash: 'weapon/sword/scimitar' },
};

// ── Anchor helper ─────────────────────────────────────────────────────────

/**
 * Returns the sprite anchor for a sheet layout.
 * Delegates to the shared resolver's anchorOffset.
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
export type CreateLpcRendererOptions = {
  resolver: AssetResolver;
  /** Optional error handler for asset loading failures. */
  onError?: (error: unknown) => void;
};

export const createLpcRenderer = (options: CreateLpcRendererOptions): LpcRenderer => {
  const { resolver, onError } = options;

  // Instance-scoped caches
  const _sheetCache = new Map<string, Texture>();
  const _sheetPromises = new Map<string, Promise<Texture>>();
  const _frameCache = new Map<string, Texture>();

  const _loadSheetBySuffix = async (assetId: string, stateSuffix: string): Promise<Texture> => {
    const tag = lpcTag(assetId, stateSuffix);
    const url = resolver.resolve(tag);
    if (!url) {
      return Texture.EMPTY;
    }
    try {
      const texture = await Assets.load(url);
      texture.source.scaleMode = 'nearest';
      return texture;
    } catch (err) {
      if (onError) {
        onError(err);
      }
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

      const aliasAssetId = STATE_ASSET_ALIASES[assetId]?.[stateSuffix];
      if (aliasAssetId && aliasAssetId !== assetId) {
        const aliasSheet = await _loadSheetBySuffix(aliasAssetId, stateSuffix);
        if (aliasSheet !== Texture.EMPTY) {
          _sheetCache.set(key, aliasSheet);
          return aliasSheet;
        }
      }

      if (stateSuffix !== 'idle') {
        const chain = STATE_FALLBACK_CHAINS[stateSuffix] ?? DEFAULT_STATE_FALLBACKS;
        for (const fallbackSuffix of chain) {
          if (fallbackSuffix === stateSuffix) {
            continue;
          }
          const fallback = await _loadSheetBySuffix(assetId, fallbackSuffix);
          if (fallback !== Texture.EMPTY) {
            _sheetCache.set(key, fallback);
            return fallback;
          }
        }
      }

      _sheetCache.set(key, Texture.EMPTY);
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
