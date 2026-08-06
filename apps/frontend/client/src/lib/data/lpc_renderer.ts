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

// ── Sheet layout detection ────────────────────────────────────────────────

/**
 * Resolved layout of an LPC spritesheet.
 *
 * The Universal LPC Spritesheet Character Generator emits two cell sizes:
 *
 * - **Standard** sheets: 64×64 cells in a 9-col × 4-row grid (576×256) — the
 *   vast majority of the catalog (bodies, heads, torso, shields, swords…).
 * - **Universal** sheets: 128×128 cells in a 13-col × 4-row grid (1664×512) —
 *   emitted for some weapon walk cycles (bows, scimitars, spears, katanas).
 *   The drawn content is still ~64px; the cell is simply 2× padded.
 *
 * Renderers must sample a full cell (`pitch × pitch`) and scale the sprite by
 * {@link scale} so both families composite at the same 64px logical size.
 */
export type LpcSheetLayout = {
  /** Horizontal/vertical spacing between frames, in px (64 or 128). */
  pitch: number;
  /** Number of animation frames per row. */
  columns: number;
  /** Number of direction rows (4 for full sheets, 1 for single-row states). */
  rows: number;
  /** Scale factor normalizing a cell to the 64px logical frame size. */
  scale: number;
};

/**
 * Detects the cell layout of an LPC spritesheet.
 *
 * Falls back to the standard 64px grid for anything that does not match the
 * universal 13×4 @128px family (e.g. 576×256 walk sheets, 832×256 idle/shoot
 * sheets, 384×64 single-row hurt sheets).
 */
export function detectLpcSheetLayout(sheet: { width: number; height: number }): LpcSheetLayout {
  if (sheet.width % 128 === 0 && sheet.height % 128 === 0) {
    const columns = sheet.width / 128;
    const rows = sheet.height / 128;
    if (columns >= 9 && columns <= 16 && rows === 4) {
      return { pitch: 128, columns, rows, scale: 64 / 128 };
    }
  }
  return {
    pitch: 64,
    columns: Math.max(1, Math.floor(sheet.width / 64)),
    rows: Math.max(1, Math.floor(sheet.height / 64)),
    scale: 1,
  };
}

// ── Resolver injection ────────────────────────────────────────────────────

/**
 * Resolves an LPC assetId + animation state to a static URL, or null when
 * unmapped. The state may be a raw filename suffix (e.g. "idle") for the
 * state-fallback path, which does not map to an `LpcAnimationState` value.
 */
export type LpcUrlResolver = (assetId: string, state: LpcAnimationState | string) => string | null;

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
const resolveLpcUrl = (assetId: string, state: LpcAnimationState | string): string | null => {
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

let _manifestReady = false;

/**
 * Per-state fallback suffix chains tried when the requested state's sheet is
 * missing (only after the manifest is loaded, i.e. a permanent unmapped asset).
 *
 * The chain ends with `walk` because every weapon/armour asset ships a walk
 * sheet — so a layer degrades to its walk pose instead of vanishing.
 *
 * Context:
 * - Some shield front layers (e.g. `shield/scutum_trim_fg`) only ship `idle`,
 *   so a missing `walk` falls back to a static idle frame.
 * - Most swords (`weapon/sword/saber`, `longsword`, `rapier`) only ship
 *   `walk` + `hurt` at the top level (their slash/thrust lives in non-standard
 *   `attack_*` sub-sheets), so a missing `slash`/`thrust`/`spellcast`/`shoot`
 *   falls back to `walk` and the weapon stays visible.
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
 *
 * Some swords (`weapon/sword/saber`, `longsword`, `rapier`) only ship
 * `walk` + `hurt` sheets — their slash animation exists only as malformed
 * `attack_*` sub-sheets. Sibling assets (`scimitar`, `longsword_alt`) have
 * clean walk+slash sheets, so we alias the missing slash state to them. The
 * base asset's own walk sheet (all four directions) is still used for walk.
 */
const STATE_ASSET_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'weapon/sword/longsword': { slash: 'weapon/sword/longsword_alt' },
  'weapon/sword/saber': { slash: 'weapon/sword/scimitar' },
  'weapon/sword/rapier': { slash: 'weapon/sword/scimitar' },
};

/**
 * Per-asset anchor offsets for universal 128px-cell sheets.
 *
 * The universal weapon sheets place their drawing at a slightly different
 * position within the padded 128px cell than the bows, so the grip lands a
 * few pixels too high/left. The offset (applied on top of the -32/-32 base
 * anchor) aligns the sword grip with the character's hand.
 */
const UNIVERSAL_ANCHOR_OVERRIDES: Readonly<Record<string, { x: number; y: number }>> = {
  // Universal 128px sheets (walk+slash) used directly or via state aliases.
  'weapon/sword/longsword_alt': { x: 4, y: 8 },
  'weapon/sword/scimitar': { x: 4, y: 8 },
  'weapon/sword/katana': { x: 4, y: 8 },
  // Base assets whose *aliased* slash sheet is a universal 128px sheet — the
  // override only applies to pitch-128 sheets, so their own 64px walk sheets
  // keep the standard anchor.
  'weapon/sword/saber': { x: 4, y: 8 },
  'weapon/sword/longsword': { x: 4, y: 8 },
  'weapon/sword/rapier': { x: 4, y: 8 },
};

/**
 * Returns the sprite anchor (top-left, sprite-local px) for a sheet layout
 * and asset. Universal 128px sheets with a configured override are nudged so
 * the weapon grip aligns with the character's hand; everything else uses the
 * standard 64px frame anchor (-32, -32).
 */
export const getLpcSpriteAnchor = (
  layout: LpcSheetLayout,
  assetId: string,
): { x: number; y: number } => {
  if (layout.pitch === 128) {
    const offset = UNIVERSAL_ANCHOR_OVERRIDES[assetId];
    if (offset) {
      return { x: -32 + offset.x, y: -32 + offset.y };
    }
  }
  return { x: -32, y: -32 };
};

/**
 * Marks whether the asset manifest has finished loading.
 *
 * Until this is true, an unresolvable URL is treated as *transient* (the
 * manifest may simply not have loaded yet) and is NOT cached, so a later
 * call after the manifest resolves can retry. Once true, a null resolution
 * is a genuinely unmapped asset and is cached as Texture.EMPTY (fallback).
 *
 * @param ready - Whether the manifest is loaded.
 */
export const setLpcManifestReady = (ready: boolean): void => {
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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Loads a webp spritesheet for a given asset and animation state.
 * Caches results. Falls back to Texture.EMPTY on failure or unmapped asset.
 *
 * Negative results are only cached once the manifest has loaded (so a
 * not-yet-loaded manifest can retry later); transient Assets.load failures
 * are not cached and retry on subsequent calls. Successful textures are
 * cached permanently.
 */
/**
 * Low-level sheet loader for a concrete filename suffix.
 *
 * Returns `Texture.EMPTY` on unmapped or failed loads. EMPTY results are only
 * cached by the caller once the manifest is ready (a not-yet-loaded manifest
 * is transient and must be retried).
 */
async function loadSheetBySuffix(assetId: string, stateSuffix: string): Promise<Texture> {
  const url = resolveLpcUrl(assetId, stateSuffix);
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
}

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
    const primary = await loadSheetBySuffix(assetId, stateSuffix);
    if (primary !== Texture.EMPTY) {
      _sheetCache.set(key, primary);
      return primary;
    }

    // State-aware asset alias: when this asset has no sheet for the state,
    // render the same state from a configured sibling asset (e.g. the saber's
    // slash comes from the scimitar's slash sheet). Only attempted once the
    // manifest is loaded (permanent unmapped, not transient).
    if (_manifestReady) {
      const aliasAssetId = STATE_ASSET_ALIASES[assetId]?.[stateSuffix];
      if (aliasAssetId && aliasAssetId !== assetId) {
        const aliasSheet = await loadSheetBySuffix(aliasAssetId, stateSuffix);
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
    // manifest is loaded (permanent unmapped, not transient), walk the
    // per-state fallback chain (idle → walk) so the layer degrades to a
    // static or walk pose instead of vanishing (e.g. `slash` on a saber,
    // `walk` on a shield front layer).
    if (_manifestReady && stateSuffix !== 'idle') {
      const chain = STATE_FALLBACK_CHAINS[stateSuffix] ?? DEFAULT_STATE_FALLBACKS;
      for (const fallbackSuffix of chain) {
        if (fallbackSuffix === stateSuffix) {
          continue;
        }
        const fallback = await loadSheetBySuffix(assetId, fallbackSuffix);
        if (fallback !== Texture.EMPTY) {
          logger.warn('lpcRenderer:stateFallback', {
            assetId,
            requested: stateSuffix,
            fallback: fallbackSuffix,
          });
          // Cache the successful fallback against the requested key so
          // subsequent calls resolve in one hop (the manifest is static).
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
    // Release the in-flight entry once settled so failed/transient loads
    // can retry on a later call (successful results hit _sheetCache first).
    _sheetPromises.delete(key);
  });
  return promise;
}

/**
 * Extracts a single frame from a spritesheet texture.
 *
 * Auto-detects the sheet layout (standard 64px vs universal 128px cells) so
 * both families resolve to the correct cell.
 *
 * @param sheet    - The full spritesheet texture
 * @param frame    - Animation frame index (column)
 * @param direction - Facing direction (row)
 * @returns The extracted cell texture, or null when out of bounds / empty.
 */
export function extractLpcFrame(
  sheet: Texture,
  frame: number,
  direction: LpcDirection,
): Texture | null {
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
 *
 * Universal (128px-cell) sheets are scaled down so the sprite matches the
 * 64px logical frame size of standard sheets.
 */
export async function createLpcSprite(
  assetId: string,
  state: LpcAnimationState,
  frame: number,
  direction: LpcDirection,
  zIndex: number,
): Promise<Sprite | null> {
  const sheet = await loadLpcSheet(assetId, state);
  if (!sheet || sheet === Texture.EMPTY) {
    return null;
  }

  const texture = extractLpcFrame(sheet, frame, direction);
  if (!texture) {
    return null;
  }

  const layout = detectLpcSheetLayout(sheet);
  const anchor = getLpcSpriteAnchor(layout, assetId);
  const sprite = new Sprite(texture);
  sprite.eventMode = 'none';
  // Anchor at the 64px logical frame origin — universal 128px cells keep the
  // same anchor after scaling down so the weapon aligns with the character.
  sprite.x = anchor.x;
  sprite.y = anchor.y;
  sprite.scale.set(layout.scale, layout.scale);
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
