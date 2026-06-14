// apps/frontend/client/src/lib/data/lpc_renderer.ts
// Single source of truth for LPC texture loading and frame extraction.
// Used by: LPC dev page, sandbox, game engine, character creation preview.
//
// Assets are sourced from Firebase Storage. Set PUBLIC_LPC_USE_LOCAL=true
// to fall back to local files under /src/lib/assets/lpc/ for development.

import { Rectangle, Sprite, Texture } from 'pixi.js';
import { LpcAnimationState, type LpcDirection } from '$lib/data/lpc_models';

// ── State mapping ──────────────────────────────────────────────────────────

const STATE_SUFFIX: Record<number, string> = {
  [LpcAnimationState.Walk]: 'walk',
  [LpcAnimationState.Spellcast]: 'spellcast',
  [LpcAnimationState.Thrust]: 'thrust',
  [LpcAnimationState.Slash]: 'slash',
  [LpcAnimationState.Shoot]: 'shoot',
  [LpcAnimationState.Die]: 'hurt',
};

// ── Caches ─────────────────────────────────────────────────────────────────

const _sheetCache = new Map<string, Texture>();
const _sheetPromises = new Map<string, Promise<Texture>>();
const _frameCache = new Map<string, Texture>();

// ── Asset URL resolution ───────────────────────────────────────────────────

/**
 * Build the Firebase Storage base URL for LPC assets.
 *
 * In emulator mode, points to the local storage emulator on port 9198.
 * In live modes, uses firebasestorage.googleapis.com with the project bucket.
 */
const getStorageBaseUrl = (): string => {
  const mode = import.meta.env.PUBLIC_MODE ?? 'emulator';
  const bucket =
    import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'demo-aikami-emulator.appspot.com';

  if (mode === 'emulator') {
    return `http://localhost:9198/v0/b/${bucket}/o`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;
};

/**
 * Build the full URL for an LPC asset file.
 *
 * When PUBLIC_LPC_USE_LOCAL is set, loads from the local filesystem
 * (Vite dev server or static build). Otherwise loads from Firebase Storage.
 */
const buildLpcAssetUrl = (key: string): string => {
  const useLocal = import.meta.env.PUBLIC_LPC_USE_LOCAL === 'true';

  if (useLocal) {
    return `/src/lib/assets/lpc/${key}.webp`;
  }

  const base = getStorageBaseUrl();
  const encoded = encodeURIComponent(`lpc/${key}.webp`);
  return `${base}/${encoded}?alt=media`;
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Loads a webp spritesheet for a given asset and animation state.
 * Caches results. Falls back to Texture.EMPTY on failure.
 */
export async function loadLpcSheet(assetId: string, state: LpcAnimationState): Promise<Texture> {
  const stateSuffix = STATE_SUFFIX[state] ?? 'walk';
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
    try {
      const { Assets } = await import('pixi.js');
      const url = buildLpcAssetUrl(key);
      const texture = await Assets.load(url);
      texture.source.scaleMode = 'nearest';
      _sheetCache.set(key, texture);
      return texture;
    } catch {
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
  const stateSuffix = STATE_SUFFIX[state] ?? 'walk';
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
 * Converts an asset ID + state to a file path or storage URL.
 *
 * Respects PUBLIC_LPC_USE_LOCAL for local vs Firebase Storage loading.
 */
export function getLpcAssetPath(assetId: string, state: LpcAnimationState): string {
  const stateSuffix = STATE_SUFFIX[state] ?? 'walk';
  const key = `${assetId}.${stateSuffix}`;
  return buildLpcAssetUrl(key);
}

/** Clears all caches (useful for testing or memory pressure). */
export function clearLpcCaches(): void {
  _sheetCache.clear();
  _sheetPromises.clear();
  _frameCache.clear();
}
