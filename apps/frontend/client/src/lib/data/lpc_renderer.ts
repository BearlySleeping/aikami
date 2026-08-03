// apps/frontend/client/src/lib/data/lpc_renderer.ts
// Single source of truth for LPC texture loading and frame extraction.
// Used by: LPC dev page, sandbox, game engine, character creation preview.
//
// All asset URLs resolve through an injected manifest resolver
// (setLpcUrlResolver) — the canonical static base is /game-data/lpc/
// served from the regenerated manifest. No Firebase Storage runtime origin,
// no /src/lib/assets/ dev-directory references.
//
// Contract: C-372

import { Rectangle, Sprite, Texture } from 'pixi.js';
import type { LpcAnimationState, LpcDirection } from '$lib/data/lpc_models';
import { lpcStateSuffix } from '$lib/data/lpc_tags';
import { logger } from '$logger';

// ── Resolver injection ────────────────────────────────────────────────────

/** Resolves an LPC assetId + animation state to a static URL, or null when unmapped. */
export type LpcUrlResolver = (assetId: string, state: LpcAnimationState) => string | null;

let _urlResolver: LpcUrlResolver | null = null;

/**
 * Injects the manifest-backed URL resolver for LPC assets.
 *
 * Wired once at bootstrap (game boot/engine services) and by each
 * LPC-rendering ViewModel. Replaces the old Firebase Storage /
 * `/src/lib/assets/` resolution strategies.
 *
 * @param resolver - Function mapping (assetId, state) → static URL or null.
 */
export const setLpcUrlResolver = (resolver: LpcUrlResolver): void => {
  _urlResolver = resolver;
};

/**
 * Resolves an LPC asset URL through the injected resolver.
 *
 * @param assetId - Renderer asset ID (e.g. "body/bodies_male").
 * @param state - Animation state value.
 * @returns The static URL, or null when unmapped / no resolver wired.
 */
const resolveLpcUrl = (assetId: string, state: LpcAnimationState): string | null => {
  if (_urlResolver) {
    return _urlResolver(assetId, state);
  }
  logger.warn('lpcRenderer:noUrlResolver', { assetId });
  return null;
};

// ── Caches ─────────────────────────────────────────────────────────────────

const _sheetCache = new Map<string, Texture>();
const _sheetPromises = new Map<string, Promise<Texture>>();
const _frameCache = new Map<string, Texture>();

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Loads a webp spritesheet for a given asset and animation state.
 * Caches results. Falls back to Texture.EMPTY on failure or unmapped asset.
 */
export async function loadLpcSheet(assetId: string, state: LpcAnimationState): Promise<Texture> {
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
    const url = resolveLpcUrl(assetId, state);
    if (!url) {
      logger.warn('lpcRenderer:unmapped', { assetId, stateSuffix });
      _sheetCache.set(key, Texture.EMPTY);
      return Texture.EMPTY;
    }
    try {
      const { Assets } = await import('pixi.js');
      const texture = await Assets.load(url);
      texture.source.scaleMode = 'nearest';
      _sheetCache.set(key, texture);
      return texture;
    } catch (err) {
      logger.warn('lpcRenderer:loadFailed', { assetId, stateSuffix, url, error: String(err) });
      _sheetCache.set(key, Texture.EMPTY);
      return Texture.EMPTY;
    }
  })();

  _sheetPromises.set(key, promise);
  return promise;
}

/**
 * Extracts a single frame from a spritesheet texture.
 *
 * @param sheet    - The full spritesheet texture
 * @param frame    - Animation frame index (column)
 * @param direction - Facing direction (row)
 * @param frameW   - Frame width (default 64)
 * @param frameH   - Frame height (default 64)
 */
export function extractLpcFrame(
  sheet: Texture,
  frame: number,
  direction: LpcDirection,
  frameW = 64,
  frameH = 64,
): Texture | null {
  if (sheet === Texture.EMPTY) {
    return null;
  }

  const columns = Math.max(1, Math.floor(sheet.width / frameW));
  const rows = Math.max(1, Math.floor(sheet.height / frameH));

  const col = frame % columns;
  const row = rows > 1 ? direction % rows : 0;
  const x = col * frameW;
  const y = row * frameH;

  if (x + frameW > sheet.width || y + frameH > sheet.height) {
    return null;
  }

  const cacheKey = `${sheet.uid}:${col}:${row}`;
  const cached = _frameCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const result = new Texture({
    source: sheet.source,
    frame: new Rectangle(x, y, frameW, frameH),
  });
  _frameCache.set(cacheKey, result);
  return result;
}

/**
 * Full pipeline: load sheet + extract frame. Returns a ready-to-use Texture.
 * Caches both the sheet and the extracted frame.
 */
export async function getLpcFrameTexture(
  assetId: string,
  state: LpcAnimationState,
  frame: number,
  direction: LpcDirection,
): Promise<Texture | null> {
  const stateSuffix = lpcStateSuffix(state);
  const frameKey = `${assetId}.${stateSuffix}:${frame}:${direction}`;

  const cached = _frameCache.get(frameKey);
  if (cached) {
    return cached;
  }

  const sheet = await loadLpcSheet(assetId, state);
  if (!sheet || sheet === Texture.EMPTY) {
    return null;
  }

  const result = extractLpcFrame(sheet, frame, direction);
  if (result) {
    _frameCache.set(frameKey, result);
  }
  return result;
}

/**
 * Creates a PixiJS Sprite for an LPC layer.
 * Returns null if the asset can't be loaded.
 */
export async function createLpcSprite(
  assetId: string,
  state: LpcAnimationState,
  frame: number,
  direction: LpcDirection,
  zIndex: number,
): Promise<Sprite | null> {
  const texture = await getLpcFrameTexture(assetId, state, frame, direction);
  if (!texture) {
    return null;
  }

  const sprite = new Sprite(texture);
  sprite.eventMode = 'none';
  sprite.x = -32;
  sprite.y = -32;
  sprite.alpha = 1.0;
  sprite.zIndex = zIndex;
  return sprite;
}

/**
 * Resolves the static URL for an LPC asset via the injected manifest resolver.
 *
 * Returns null when the asset is not present in the manifest — callers must
 * degrade gracefully (default sprite or layer omission). Never fabricates URLs.
 */
export function getLpcAssetPath(assetId: string, state: LpcAnimationState): string | null {
  return resolveLpcUrl(assetId, state);
}

/** Clears all caches (useful for testing or memory pressure). */
export function clearLpcCaches(): void {
  _sheetCache.clear();
  _sheetPromises.clear();
  _frameCache.clear();
}
