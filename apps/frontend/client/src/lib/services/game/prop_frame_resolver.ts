// apps/frontend/client/src/lib/services/game/prop_frame_resolver.ts
//
// Builds the deterministic content-pack prop frame resolver (C-375 AC-1)
// from a loaded pack manifest, and preloads the atlas spritesheet so the
// resolver is ready before GameWorld boots.
//
// This is the client-side wiring point shared by the /game boot pipeline
// (game_boot_service) and the sandbox path (game_engine_service), mirroring
// C-372's wireLpcUrlResolver discipline.

import {
  createPropFrameResolver,
  type PropFrameResolverHandle,
} from '@aikami/frontend/engine/render';
import type { ContentPackManifest } from '@aikami/schemas';
import { Assets } from 'pixi.js';
import { logger } from '$logger';

/**
 * Minimal manifest shape needed to build the resolver.
 *
 * `propAtlases` is taken straight from the schema rather than re-declared:
 * a hand-written copy silently drifts when the schema changes shape, and the
 * resolver would then read fields the manifest no longer has.
 */
export type PropFrameResolverPackManifest = {
  atlas?: {
    textureUrl?: string;
    spritesheetUrl?: string;
    tileSize?: number;
  };
  /**
   * Irregular prop-atlas pages for oversized props. Frames are resolved by
   * name across the grid atlas and every page, so pages are additive — the
   * packer can add one without touching any prop definition.
   */
  propAtlases?: Pick<ContentPackManifest, 'propAtlases'>['propAtlases'];
  fallbackTile?: string;
};

/** Options for {@link buildPropFrameResolver}. */
export type BuildPropFrameResolverOptions = {
  /** Content-pack manifest containing the atlas declaration. */
  manifest: PropFrameResolverPackManifest;
  /** Resolves manifest asset tags to cache or origin URLs. */
  resolveTag?: (tag: string) => string | null;
};

/**
 * Builds + preloads the prop frame resolver for a content pack.
 *
 * The fallback frame key is derived from `manifest.fallbackTile` — never a
 * hardcoded default that may reference an undeclared atlas frame. When the
 * pack declares none, a warning is emitted and lookups degrade to `null`
 * (placeholder visual) via the resolver's established degraded path.
 *
 * Packs without atlas metadata get a no-op resolver (props keep their
 * placeholder) with a logged warning — never a crash, never a white
 * square from the old `Texture.from(frame)` global-cache path.
 *
 * `resolveTag`, when supplied, resolves the manifest's raw file paths (e.g.
 * "/game-data/sprites/tilesets/atlas.webp") through the asset registry
 * (cache blob: URL → origin CDN URL → null) before handing them to
 * `Assets.load()` — the same resolution `_preloadAsset` already applies to
 * the map/spritesheet preload a few lines above this call in
 * game_boot_service. Without it, `Assets.load()` fetches the raw path
 * directly: harmless on web (served statically alongside the app), but on
 * Tauri desktop nothing serves that path, so it 404s into the SPA fallback
 * HTML and the atlas fails to decode.
 */
export const buildPropFrameResolver = async ({
  manifest,
  resolveTag,
}: BuildPropFrameResolverOptions): Promise<PropFrameResolverHandle> => {
  const atlas = manifest.atlas;
  if (!atlas?.textureUrl) {
    logger.warn('buildPropFrameResolver:no-atlas', {
      hint: 'Pack has no atlas metadata — props will keep their placeholder visuals.',
    });
    return {
      resolver: () => null,
      preload: async () => {},
      isPreloaded: () => true,
      clearCache: () => {},
    };
  }

  const fallbackTile = manifest.fallbackTile;
  if (!fallbackTile) {
    logger.warn('buildPropFrameResolver:no-fallback-tile', {
      textureUrl: atlas.textureUrl,
      hint: 'Pack declares no fallbackTile — missing prop frames degrade to the placeholder instead of a fallback tile.',
    });
  }

  const rawTextureUrl = atlas.textureUrl;
  const resolvedTextureUrl = resolveTag?.(rawTextureUrl) ?? rawTextureUrl;
  const spritesheetUrl = atlas.spritesheetUrl
    ? (resolveTag?.(atlas.spritesheetUrl) ?? atlas.spritesheetUrl)
    : undefined;

  // Register the raw manifest path as a Pixi alias for the resolved URL, and
  // load THROUGH that alias (not the resolved URL directly) — same pattern
  // as tilemap_render_system.ts. `AssetStore.resolveUrl()` can return a
  // different URL for the same tag depending on cache-warm timing (the R2
  // origin URL before the background warm finishes, a `blob:` URL after),
  // so two independent `Assets.load(resolvedUrl)` calls for the "same"
  // texture can end up creating two different `Texture.Source` instances.
  // Terrain autotiling (game_world.ts `_buildFrameUvResolver`) compares the
  // prop-resolver's texture source against the tilemap's texture source by
  // identity — aliasing by the stable raw path guarantees both resolve to
  // the exact same cached Texture regardless of which one loads first.
  if (resolvedTextureUrl !== rawTextureUrl && !Assets.resolver.hasKey(rawTextureUrl)) {
    Assets.add({ alias: rawTextureUrl, src: resolvedTextureUrl });
  }

  // Prop-atlas pages go through the same tag resolution + Pixi aliasing as
  // the grid atlas, for the same reason: two independent `Assets.load` calls
  // for the same logical texture must resolve to one `Texture.Source`. Pages
  // with an incomplete declaration are skipped with an explicit warning
  // rather than silently shrinking the prop namespace.
  const propAtlasPages: { textureUrl: string; spritesheetUrl: string }[] = [];
  for (const [index, page] of (manifest.propAtlases ?? []).entries()) {
    if (!page.textureUrl || !page.spritesheetUrl) {
      logger.warn('buildPropFrameResolver:incomplete-prop-atlas', {
        page: index,
        textureUrl: page.textureUrl ?? null,
        spritesheetUrl: page.spritesheetUrl ?? null,
        hint: 'A prop-atlas page needs both textureUrl and spritesheetUrl — skipping it.',
      });
      continue;
    }
    const resolvedPageTexture = resolveTag?.(page.textureUrl) ?? page.textureUrl;
    if (resolvedPageTexture !== page.textureUrl && !Assets.resolver.hasKey(page.textureUrl)) {
      Assets.add({ alias: page.textureUrl, src: resolvedPageTexture });
    }
    propAtlasPages.push({
      textureUrl: page.textureUrl,
      spritesheetUrl: resolveTag?.(page.spritesheetUrl) ?? page.spritesheetUrl,
    });
  }

  const handle = createPropFrameResolver({
    textureUrl: rawTextureUrl,
    spritesheetUrl,
    fallbackTile,
    propAtlases: propAtlasPages,
  });

  // Non-fatal: if the atlas fails to load (404 / decode error), the
  // resolver degrades to `null` lookups and the tilemap fallback keeps the
  // game playable (C-375 Quality: Offline/degraded mode).
  try {
    await handle.preload();
  } catch (error) {
    logger.error('buildPropFrameResolver:preload-failed', {
      textureUrl: rawTextureUrl,
      resolvedTextureUrl,
      error: error instanceof Error ? error.message : String(error),
      hint: 'Props will keep placeholder visuals; the atlas may be missing or malformed.',
    });
  }
  return handle;
};
