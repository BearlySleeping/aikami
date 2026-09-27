// packages/frontend/engine/src/systems/npc_appearance.ts
//
// How a spawned NPC's authored appearance becomes renderable layers.
//
// Extracted from `entity_spawner.ts` — that module is at its reviewed size
// ceiling, and "resolve one NPC's declared outfit" is a self-contained
// responsibility: it reads a spawn point and a pack config, consults the shared
// normalization boundary, and returns layer data. Nothing here spawns, places
// or ticks anything.

import {
  type AppearanceCatalog,
  LEGACY_CATALOG_SNAPSHOT_ID,
  type ResolveNpcAppearanceResult,
  resolveNpcAppearance,
} from '@aikami/lpc';
import type { PackConfig } from '@aikami/types';
import { logger } from '$logger';
import type { SpawnPoint } from '../assets/map_loader.ts';

/**
 * Resolves an NPC's appearance into BOTH the six positional layer IDs and the
 * extra-slot layers.
 *
 * The manifest's named `appearance` (slot + assetId + layerRole) is preferred;
 * legacy `appearanceLayers` (numeric indices tied to the verified legacy
 * catalog snapshot) are migrated via the shared normalization boundary — never
 * a positional read against the derived catalog. Both the worker and the main
 * thread resolve against the SAME catalog (`lpcCatalog`), so a given NPC
 * resolves to the same slot/assetId sequence everywhere.
 *
 * The two are returned together because they come from the same declaration:
 * an outfit that names a shield and a longsword must resolve the body and the
 * kit together, and resolving them separately would let a character render
 * half of an authored outfit. Extras are cleared by the caller whenever the
 * appearance fails to resolve, so a fallback never keeps a stale weapon.
 *
 * @returns The resolved appearance, or undefined when none is declared or
 *   resolution fails (caller falls back to the whole-character default — never
 *   a mixed per-slot recipe).
 */
export const resolveNpcAppearanceLayers = (
  spawnPoint: SpawnPoint,
  packConfig?: PackConfig,
  lpcCatalog?: AppearanceCatalog,
): ResolveNpcAppearanceResult | undefined => {
  const npcId = readString(spawnPoint.properties, 'npcId', spawnPoint.id);
  const entry = packConfig?.npcs?.[npcId];
  const named = entry?.appearance;
  const legacy = entry?.appearanceLayers;

  const input = named ?? legacy;
  if (input === undefined) {
    return undefined;
  }

  // The derived catalog must be present to resolve a named/legacy appearance
  // (worker receives it via INITIALIZE_ENGINE). A missing catalog means every
  // named asset would read as "missing" — surface a diagnostic instead of
  // silently substituting the hardcoded default stack.
  if (!lpcCatalog || lpcCatalog.length === 0) {
    logger.warn('entity-spawner:npc-appearance-no-catalog', {
      npcId,
      source: named ? 'manifest:appearance' : 'manifest:appearanceLayers',
      hint: 'No LPC catalog available to resolve the NPC appearance — using the whole-character default. The worker normally receives the catalog at INITIALIZE_ENGINE.',
    });
    return undefined;
  }

  const result = resolveNpcAppearance({
    input,
    catalog: lpcCatalog,
    // Legacy appearanceLayers in the shipped pack are tied to the verified
    // legacy catalog-order snapshot. Named appearance needs no snapshot.
    snapshot: named ? undefined : LEGACY_CATALOG_SNAPSHOT_ID,
    source: named ? 'manifest:appearance' : 'manifest:appearanceLayers',
    npcId,
  });

  if (result.layerIds !== undefined && result.diagnostics.length === 0) {
    return result;
  }
  for (const d of result.diagnostics) {
    logger.warn('entity-spawner:npc-appearance', {
      npcId,
      slot: d.slot,
      assetId: d.assetId,
      detail: d.detail,
    });
  }
  return undefined;
};

/** Reads a string spawn-point property, falling back when absent or empty. */
const readString = (
  properties: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string => {
  const value = properties[key];
  return typeof value === 'string' && value.length > 0 ? value : defaultValue;
};
