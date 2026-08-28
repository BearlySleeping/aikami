// packages/frontend/engine/src/rendering/prop_texture_resolver.ts
//
// PropFrameResolver — deterministic content-pack prop frame resolution.
//
// Contract C-375 AC-1: props must render their atlas frames (never LPC
// heads, never white 1×1 placeholders). The old path relied on the
// fragile side-effect that `Assets.load(atlas.json)` registers bare frame
// names in Pixi's global TextureCache, then called `Texture.from(frame)`.
//
// This resolver instead parses the pack's spritesheet ONCE (PixiJS
// `Spritesheet.parse()`, the same WebGPU-safe UV path used by
// `TextureManager.getOrCreateSpritesheet`) and resolves named frames via
// `sheet.textures[frame]`. Missing frames resolve to the pack's
// `fallbackTile` with a logged warning — never a white square, never an
// LPC character sprite.

import { Assets, Spritesheet, type Texture } from 'pixi.js';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of a parsed PixiJS Spritesheet the resolver needs. */
export type PropSpritesheet = Pick<Spritesheet, 'textures'>;

/** Outcome of a single prop frame lookup. */
export type PropTextureResolution = {
  /** The texture to render (the frame hit, or the fallbackTile). */
  texture: Texture;
  /** The requested frame key (e.g. "well.png"). */
  frame: string;
  /** `hit` when the frame exists in the atlas; `fallback` when it does not. */
  source: 'hit' | 'fallback';
};

/**
 * Resolves a prop frame key to a texture.
 *
 * Returns `null` only when the atlas is not preloaded or neither the
 * frame nor the fallbackTile exists — callers must then keep a degraded
 * visual and log an explicit error.
 */
export type PropTextureResolver = (frame: string) => PropTextureResolution | null;

/** Options for {@link createPropFrameResolver}. */
export type CreatePropFrameResolverOptions = {
  /** URL to the atlas image (e.g. "/game-data/sprites/tilesets/atlas.webp"). */
  textureUrl: string;
  /** URL to the spritesheet JSON (e.g. "/game-data/sprites/tilesets/atlas.json"). */
  spritesheetUrl?: string;
  /**
   * Frame key rendered when a prop frame is missing (e.g. "grass.png").
   * Optional — when absent, missing frames degrade to `null` (placeholder)
   * with an explicit error naming the undeclared frame.
   */
  fallbackTile?: string;
  /**
   * Optional loader override for tests.
   *
   * Defaults to `Assets.load(spritesheetUrl ?? textureUrl)` and extracts
   * the parsed spritesheet's `textures` map.
   */
  sheetLoader?: () => Promise<PropSpritesheet | null>;
};

/** Handle returned by {@link createPropFrameResolver}. */
export type PropFrameResolverHandle = {
  /** Synchronous frame lookup (call after `preload()` resolves). */
  resolver: PropTextureResolver;
  /** Loads + parses the spritesheet. Idempotent. */
  preload: () => Promise<void>;
  /** Whether {@link preload} has completed successfully. */
  isPreloaded: () => boolean;
  /** Drops memoized resolutions (used on content-pack switch / hot reload). */
  clearCache: () => void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic prop frame resolver for a content pack.
 *
 * Usage (boot wiring, C-375):
 *
 * ```ts
 * const handle = createPropFrameResolver({
 *   textureUrl: pack.manifest.atlas.textureUrl,
 *   spritesheetUrl: pack.manifest.atlas.spritesheetUrl,
 *   fallbackTile: pack.manifest.fallbackTile,
 * });
 * await handle.preload();
 * // … pass handle.resolver into GameWorld.create({ propFrameResolver })
 * ```
 */
export const createPropFrameResolver = (
  options: CreatePropFrameResolverOptions,
): PropFrameResolverHandle => {
  const { textureUrl, spritesheetUrl, fallbackTile } = options;
  const sheetLoader =
    options.sheetLoader ??
    (async () => {
      if (!spritesheetUrl) {
        const loaded: unknown = await Assets.load(textureUrl);
        if (loaded && typeof loaded === 'object' && 'textures' in loaded) {
          return loaded as unknown as PropSpritesheet;
        }
        logger.error('prop-frame-resolver:load-unexpected', {
          loadUrl: textureUrl,
          hint: 'Expected Assets.load() to return a parsed Spritesheet (spritesheet JSON).',
        });
        return null;
      }

      // Load the texture and the raw spritesheet JSON independently, then
      // parse them together — never `Assets.load(spritesheetUrl)` directly.
      // PixiJS's built-in spritesheet loader resolves the JSON's `meta.image`
      // relative to the spritesheet JSON's *own* URL, which only works when
      // both files sit side by side as literal files. Once the texture is
      // served from a content-addressed R2 key (C-435), it lives at an
      // unrelated URL and that resolution 404s. TextureManager.
      // getOrCreateSpritesheet (packages/frontend/engine/src/rendering/
      // texture_manager.ts) already avoids this by constructing
      // `new Spritesheet(texture, data)` directly — same pattern here.
      const [texture, sheetData] = await Promise.all([
        Assets.load<Texture>(textureUrl),
        fetch(spritesheetUrl).then((response) => {
          if (!response.ok) {
            throw new Error(
              `Failed to fetch spritesheet JSON (${response.status} ${response.statusText}): ${spritesheetUrl}`,
            );
          }
          return response.json();
        }),
      ]);

      const sheet = new Spritesheet(texture, sheetData);
      await sheet.parse();
      return sheet as unknown as PropSpritesheet;
    });

  let _sheet: PropSpritesheet | null | undefined;
  let _preloaded = false;
  let _preloadPromise: Promise<void> | undefined;
  const _cache = new Map<string, PropTextureResolution>();

  const preload = async (): Promise<void> => {
    if (_preloaded || _preloadPromise) {
      if (_preloadPromise) {
        await _preloadPromise;
      }
      return;
    }
    _preloadPromise = (async () => {
      try {
        const sheet = await sheetLoader();
        _sheet = sheet ?? null;
        _preloaded = true;
        logger.debug('prop-frame-resolver:preload-complete', {
          textureUrl,
          spritesheetUrl,
          frames: _sheet ? Object.keys(_sheet.textures).length : 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('prop-frame-resolver:preload-failed', { textureUrl, error: message });
        _sheet = null;
        // Do NOT mark _preloaded on failure — a transient network error must
        // remain retryable. isPreloaded() reports false, matching its
        // documented meaning ("completed successfully").
        throw error;
      } finally {
        // Clear the in-flight promise so a failed load can be retried while
        // a successful load stays idempotent through _preloaded.
        _preloadPromise = undefined;
      }
    })();
    return _preloadPromise;
  };

  const resolver = (frame: string): PropTextureResolution | null => {
    const cached = _cache.get(frame);
    if (cached) {
      return cached;
    }

    if (!_sheet) {
      logger.warn('prop-frame-texture-missing', {
        frame,
        textureUrl,
        hint: 'Atlas not loaded — call propFrameResolver preload() before creating the world.',
      });
      return null;
    }

    const hit = _sheet.textures[frame];
    if (hit) {
      // C-377 AC-1: nearest filtering on the prop resolver path. The global
      // default covers textures created after renderer init, but this
      // guarantees crisp pixel-art even when the atlas texture was cached
      // before the default was installed.
      hit.source.scaleMode = 'nearest';
      const resolution: PropTextureResolution = { texture: hit, frame, source: 'hit' };
      _cache.set(frame, resolution);
      return resolution;
    }

    // Frame missing → fallbackTile (never Texture.WHITE, never an LPC head).
    const fallback = fallbackTile ? _sheet.textures[fallbackTile] : undefined;
    if (fallback) {
      fallback.source.scaleMode = 'nearest';
      logger.warn('prop-frame-texture-missing', {
        frame,
        textureUrl,
        fallbackTile,
        hint: `Frame "${frame}" is not declared in the content-pack atlas — rendering fallbackTile "${fallbackTile}".`,
      });
      const resolution: PropTextureResolution = { texture: fallback, frame, source: 'fallback' };
      _cache.set(frame, resolution);
      return resolution;
    }

    logger.error('prop-frame-texture-missing', {
      frame,
      textureUrl,
      fallbackTile: fallbackTile ?? null,
      hint: fallbackTile
        ? `Neither the frame "${frame}" nor the fallbackTile "${fallbackTile}" exists in atlas.json.`
        : `Frame "${frame}" is missing and the pack declares no fallbackTile.`,
    });
    return null;
  };

  return {
    resolver,
    preload,
    isPreloaded: () => _preloaded,
    clearCache: () => {
      // Drop memoized resolutions but keep the parsed sheet — the atlas is
      // unchanged; only the resolution cache must reset (e.g. content-pack
      // switch reuses the same atlas URL, or a hot-reload re-registers frames).
      _cache.clear();
    },
  };
};
