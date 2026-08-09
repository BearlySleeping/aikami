// apps/frontend/client/src/lib/services/game/prop_frame_resolver.ts
//
// Builds the deterministic content-pack prop frame resolver (C-375 AC-1)
// from a loaded pack manifest, and preloads the atlas spritesheet so the
// resolver is ready before GameWorld boots.
//
// This is the client-side wiring point shared by the /game boot pipeline
// (game_boot_service) and the sandbox path (game_engine_service), mirroring
// C-372's wireLpcUrlResolver discipline.

import { createPropFrameResolver, type PropFrameResolverHandle } from '@aikami/frontend/engine';
import { logger } from '$logger';

/** Minimal manifest shape needed to build the resolver. */
export type PropFrameResolverPackManifest = {
  atlas?: {
    textureUrl?: string;
    spritesheetUrl?: string;
    tileSize?: number;
  };
  fallbackTile?: string;
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
 */
export const buildPropFrameResolver = async (
  manifest: PropFrameResolverPackManifest,
): Promise<PropFrameResolverHandle> => {
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

  const handle = createPropFrameResolver({
    textureUrl: atlas.textureUrl,
    spritesheetUrl: atlas.spritesheetUrl,
    fallbackTile,
  });

  // Non-fatal: if the atlas fails to load (404 / decode error), the
  // resolver degrades to `null` lookups and the tilemap fallback keeps the
  // game playable (C-375 Quality: Offline/degraded mode).
  try {
    await handle.preload();
  } catch (error) {
    logger.error('buildPropFrameResolver:preload-failed', {
      textureUrl: atlas.textureUrl,
      error: error instanceof Error ? error.message : String(error),
      hint: 'Props will keep placeholder visuals; the atlas may be missing or malformed.',
    });
  }
  return handle;
};
