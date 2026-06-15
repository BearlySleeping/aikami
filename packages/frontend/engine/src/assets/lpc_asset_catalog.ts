// packages/frontend/engine/src/assets/lpc_asset_catalog.ts
//
// Lightweight asset catalog that maps spawn properties to
// LPC sprite texture keys. Used by the EntitySpawner to
// resolve visual assets for NPCs and props spawned from
// Tiled object layers.

/**
 * Resolves the sprite texture key for an NPC based on its
 * spawn properties.
 *
 * Currently returns a default LPC body spritesheet —
 * per-NPC customization (hairstyle, outfit, etc.) will be
 * wired when the full SpriteComposer pipeline supports
 * data-driven LPC recipes.
 *
 * @param _properties - Custom properties from the Tiled object
 *   (unused in the MVP but reserved for future per-NPC overrides).
 * @returns A texture key string resolvable by PixiJS Assets.
 */
export const resolveNpcTexture = (_properties: Record<string, unknown>): string => {
  return '/lpc/body/male/walk.png';
};

/**
 * Resolves the sprite texture key for a prop based on its
 * spawn properties.
 *
 * If an `assetId` property is present, the catalog maps it
 * to a prop spritesheet path. Otherwise returns a default
 * prop texture.
 *
 * @param properties - Custom properties from the Tiled object.
 * @returns A texture key string resolvable by PixiJS Assets.
 */
export const resolvePropTexture = (properties: Record<string, unknown>): string => {
  const assetId = properties.assetId;

  if (typeof assetId === 'string' && assetId.length > 0) {
    return `/lpc/props/${assetId}.png`;
  }

  return '/lpc/props/default.png';
};
