// apps/frontend/client/src/lib/services/game/save_map_block.ts
//
// Shared helpers for building the v3+ save-envelope map block and the
// human-readable map name. Imported directly by services (not through the
// $services barrel) to avoid circular module graphs — gameEngineService is
// part of the barrel, so callers must import this module by path.

import { campaignService } from '../campaign/campaign_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';
import type { SaveMapBlock } from './game_save_envelope.ts';

/**
 * Builds the v3+ envelope map block: pack id, current map id, and the
 * player's exact world-space coordinates.
 *
 * Returns undefined when the engine hasn't booted a map yet (fresh boot
 * autosave race) — the save then carries no map routing and loads fall
 * back to the starting map.
 */
export const buildSaveMapBlock = async (): Promise<SaveMapBlock | undefined> => {
  const mapId = gameEngineService.currentMapId;
  const packId = gameEngineService.contentPackId;
  const pos = gameEngineService.getPlayerPosition();
  // C-378: a non-finite coordinate (NaN/Infinity from a mid-frame read or a
  // corrupt restore) must never be persisted — a map block with NaN playerX
  // would restore the player to a garbage position. Treat it like a missing
  // map block (skip the save; the scheduler retries on the next tick).
  if (!mapId || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    return undefined;
  }
  const campaign = campaignService.activeCampaign;

  // Resolve pack version from the manifest (C-381 AC-3)
  let packVersion: string | undefined;
  try {
    const { loadContentPack } = await import('@aikami/frontend/engine');
    const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
    const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
    const pack = await loadContentPack({
      packId,
      resolveTag: assetTagResolver,
      releaseUrl: (url: string) => assetManager.releaseUrl(url),
    });
    packVersion = pack.manifest.version;
  } catch {
    // If we can't resolve the pack, proceed without version pinning
    packVersion = undefined;
  }

  return {
    packId,
    mapId,
    playerX: Math.round(pos.x),
    playerY: Math.round(pos.y),
    packVersion,
    worldSeed: campaign?.seed != null ? String(campaign.seed) : undefined,
  };
};

/**
 * Resolves the current map display name from the content pack manifest
 * (e.g. "Mara's Provisions"), falling back to the map id, then 'World'.
 *
 * The old source — worldStateService.currentLocation — is a worldgen
 * narrative location that is never synced to the gameplay map, so saves
 * always recorded 'World'.
 */
export const getCurrentMapName = async (): Promise<string> => {
  try {
    const { loadContentPack } = await import('@aikami/frontend/engine');
    const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
    const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
    const releaseUrl = (url: string) => assetManager.releaseUrl(url);
    const pack = await loadContentPack({
      packId: gameEngineService.contentPackId,
      resolveTag: assetTagResolver,
      releaseUrl,
    });
    const entry = pack.manifest.maps[gameEngineService.currentMapId];
    return entry?.name ?? (gameEngineService.currentMapId || 'World');
  } catch {
    return gameEngineService.currentMapId || 'World';
  }
};
