// apps/frontend/client/src/lib/services/game/content_pack_catalog.ts
//
// Maps content-pack item entries into runtime ItemDefinitions for the
// inventory service catalog. The content pack is the single source of item
// truth on the production /game journey (C-331 AC-1).

import type { ContentPackItemEntry, ItemDefinition } from '@aikami/types';
import { logger } from '$logger';

/**
 * Converts a content-pack `items` record into the runtime item catalog
 * consumed by `inventoryService.configureCatalog`.
 *
 * - `name` → `label`, `type` → `itemType`
 * - missing bonuses default to 0
 * - `equippable` derives from the presence of a schema-valid equipmentSlot
 * - missing `basePrice` defaults to 0 (not sold by vendors)
 */
export const buildItemCatalogFromPack = (options: {
  items: Record<string, ContentPackItemEntry>;
}): Record<string, ItemDefinition> => {
  logger.debug('buildItemCatalogFromPack', { itemCount: Object.keys(options.items).length });

  const catalog: Record<string, ItemDefinition> = {};
  for (const [itemId, entry] of Object.entries(options.items)) {
    const def: Record<string, unknown> = {
      label: entry.name,
      itemType: entry.type,
      attackBonus: entry.attackBonus ?? 0,
      defenseBonus: entry.defenseBonus ?? 0,
      equippable: entry.equipmentSlot !== undefined,
      slot: entry.equipmentSlot,
      basePrice: entry.basePrice ?? 0,
    };
    if (entry.type === 'consumable') {
      def.effect = entry.effect;
    }
    catalog[itemId] = def as unknown as ItemDefinition;
  }
  return catalog;
};
