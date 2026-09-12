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
import { buildAtlasFrameIndex, findDuplicateAtlasFrames } from '@aikami/utils';
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

/** One irregular prop-atlas page. */
export type PropAtlasPageRef = {
  /** URL to the page texture image. */
  textureUrl: string;
  /** URL to the page's spritesheet JSON. */
  spritesheetUrl: string;
};

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
   * Irregular prop-atlas pages, consulted after the grid atlas.
   *
   * Terrain lives in the fixed 32×32 grid `atlas`; oversized transparent
   * props (a 192×152 ward tree, a 256×224 inn) are packed into these pages
   * at build time. Frames are resolved by **name** across every source, so a
   * page can be added without touching any prop definition.
   *
   * Names declared by more than one source are rejected (never resolved by
   * precedence) — see {@link findDuplicateAtlasFrames}.
   */
  propAtlases?: readonly PropAtlasPageRef[];
  /**
   * Optional loader override for tests.
   *
   * Called once per atlas source (grid atlas first, then each prop-atlas
   * page). Without `spritesheetUrl`, the default calls `Assets.load(textureUrl)`
   * and uses the returned parsed spritesheet. With `spritesheetUrl`, it loads
   * the texture, fetches the JSON separately, then constructs and parses a
   * `Spritesheet` from both results.
   */
  sheetLoader?: (source: { textureUrl: string; spritesheetUrl?: string }) => Promise<PropSpritesheet | null>;
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
  const propAtlases = options.propAtlases ?? [];

  /**
   * Loads and parses one spritesheet.
   *
   * Loads the texture and the raw spritesheet JSON independently, then
   * parses them together — never `Assets.load(spritesheetUrl)` directly.
   * PixiJS's built-in spritesheet loader resolves the JSON's `meta.image`
   * relative to the spritesheet JSON's *own* URL, which only works when
   * both files sit side by side as literal files. Once the texture is
   * served from a content-addressed R2 key (C-435), it lives at an
   * unrelated URL and that resolution 404s. TextureManager.
   * getOrCreateSpritesheet (packages/frontend/engine/src/rendering/
   * texture_manager.ts) already avoids this by constructing
   * `new Spritesheet(texture, data)` directly — same pattern here.
   */
  const loadSheet = async (
    sheetTextureUrl: string,
    sheetSpritesheetUrl: string | undefined,
  ): Promise<PropSpritesheet | null> => {
    if (!sheetSpritesheetUrl) {
      const loaded: unknown = await Assets.load(sheetTextureUrl);
      if (loaded && typeof loaded === 'object' && 'textures' in loaded) {
        return loaded as unknown as PropSpritesheet; // guard-ignore lint/type-safety/casting: PropSpritesheet type not exported from pixi.js; runtime check on line above confirms shape
      }
      logger.error('prop-frame-resolver:load-unexpected', {
        loadUrl: sheetTextureUrl,
        hint: 'Expected Assets.load() to return a parsed Spritesheet (spritesheet JSON).',
      });
      return null;
    }

    const [texture, sheetData] = await Promise.all([
      Assets.load<Texture>(sheetTextureUrl),
      fetch(sheetSpritesheetUrl).then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch spritesheet JSON (${response.status} ${response.statusText}): ${sheetSpritesheetUrl}`,
          );
        }
        return response.json();
      }),
    ]);

    const sheet = new Spritesheet(texture, sheetData);
    await sheet.parse();
    return sheet as unknown as PropSpritesheet; // guard-ignore lint/type-safety/casting: PropSpritesheet type not exported from pixi.js; runtime check on line above confirms shape
  };

  const sheetLoader =
    options.sheetLoader ??
    ((source) => loadSheet(source.textureUrl, source.spritesheetUrl));

  /** All loaded sheets: grid atlas first, then prop-atlas pages in order. */
  let _sheets: PropSpritesheet[] = [];
  /** frame name → index into `_sheets`. Ambiguous names are excluded. */
  let _frameIndex = new Map<string, number>();
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
        // Grid atlas first (it owns terrain + legacy 32px prop frames), then
        // each prop-atlas page. Loaded in parallel — they are independent
        // fetches and preload is already a boot-blocking step.
        const sources = [
          { textureUrl, spritesheetUrl },
          ...propAtlases.map((page) => ({
            textureUrl: page.textureUrl,
            spritesheetUrl: page.spritesheetUrl,
          })),
        ];
        const [atlasSheet, ...pageSheets] = await Promise.all(
          sources.map((source) => sheetLoader(source)),
        );

        const sheets: PropSpritesheet[] = [];
        if (atlasSheet) {
          sheets.push(atlasSheet);
        }
        const sheetLabels = ['atlas'];
        pageSheets.forEach((sheet, index) => {
          if (sheet) {
            sheets.push(sheet);
            sheetLabels.push(`propAtlases[${index}]`);
          }
        });

        _sheets = sheets;

        // One flat frame namespace across every source. A name declared by
        // two sources is dropped entirely — never resolved by precedence — so
        // a lookup can never silently return the wrong texture.
        const frameSources = sheets.map((sheet, index) => ({
          label: sheetLabels[index] ?? `source[${index}]`,
          frames: Object.keys(sheet.textures),
        }));
        const { index: frameIndex } = buildAtlasFrameIndex(frameSources);
        _frameIndex = frameIndex;

        const duplicates = findDuplicateAtlasFrames(frameSources);
        if (duplicates.length > 0) {
          logger.error('prop-frame-resolver:duplicate-frames', {
            textureUrl,
            duplicates: duplicates.map((entry) => ({ frame: entry.name, sources: entry.sources })),
            hint: 'Frame names must be unique across the grid atlas and every prop-atlas page. The ambiguous frames are excluded from lookup (they will render the fallback). Fix the pack build.',
          });
        }

        _preloaded = true;
        logger.debug('prop-frame-resolver:preload-complete', {
          textureUrl,
          spritesheetUrl,
          sheets: sheets.length,
          propAtlases: propAtlases.length,
          frames: frameIndex.size,
          duplicates: duplicates.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('prop-frame-resolver:preload-failed', { textureUrl, error: message });
        _sheets = [];
        _frameIndex = new Map();
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

    if (!_preloaded) {
      logger.warn('prop-frame-texture-missing', {
        frame,
        textureUrl,
        hint: 'Atlas not loaded — call propFrameResolver preload() before creating the world.',
      });
      return null;
    }

    const sourceIndex = _frameIndex.get(frame);
    const hit = sourceIndex === undefined ? undefined : _sheets[sourceIndex]?.textures[frame];
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
    const fallbackSheet = _frameIndex.get(fallbackTile ?? '');
    const fallback =
      fallbackTile && fallbackSheet !== undefined
        ? _sheets[fallbackSheet]?.textures[fallbackTile]
        : undefined;
    if (fallback) {
      fallback.source.scaleMode = 'nearest';
      logger.warn('prop-frame-texture-missing', {
        frame,
        textureUrl,
        fallbackTile,
        hint: `Frame "${frame}" is not declared in the content-pack atlas or any prop-atlas page — rendering fallbackTile "${fallbackTile}".`,
      });
      const resolution: PropTextureResolution = { texture: fallback, frame, source: 'fallback' };
      _cache.set(frame, resolution);
      return resolution;
    }

    logger.error('prop-frame-texture-missing', {
      frame,
      textureUrl,
      fallbackTile: fallbackTile ?? null,
      propAtlases: propAtlases.map((page) => page.textureUrl),
      hint: fallbackTile
        ? `Neither the frame "${frame}" nor the fallbackTile "${fallbackTile}" exists in any atlas source.`
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
