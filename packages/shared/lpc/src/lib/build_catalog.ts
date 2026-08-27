// packages/shared/lpc/src/lib/build_catalog.ts

import { logger } from '$logger';
import type { LpcCatalog, LpcSlotDefinition, LpcSlotVariant } from './slot_model.ts';

/**
 * Folds published catalog entries into the LPC slot catalog.
 * Deterministic, and safe to call with an empty array.
 *
 * Slot derivation is driven by the tag structure, not by a hard-coded list:
 * an entry with tag `lpc:<slot>:<...path>:<state>` contributes `<slot>` and
 * the assetId `<slot>/<...path>`. Ordering within a slot is lexicographic by
 * assetId so the derived index is stable across publishes.
 *
 * Tags whose shape does not match `lpc:<slot>:<...>:<state>` are skipped with
 * a `debug` log, never thrown.
 *
 * @param options.entries - Published catalog entries to derive slots from.
 *   Accepts a structural subset (tag, category, ext) so both seed rows and
 *   full index entries satisfy the parameter.
 * @returns The derived LPC catalog.
 */
export const buildLpcCatalog = (options: {
  entries: readonly {
    tag: string;
    category?: string;
    ext?: string;
  }[];
}): LpcCatalog => {
  const { entries } = options;

  if (entries.length === 0) {
    logger.debug('buildLpcCatalog:empty-entries');
    return { slots: [], assetIdsBySlot: {}, allAssetIds: [] };
  }

  // Phase 1: Group entries by slot, collecting variants and their states.
  // Keyed by slot name (e.g. "body", "hair").
  const slotMap = new Map<string, Map<string, LpcSlotVariant>>();

  for (const entry of entries) {
    const { tag } = entry;

    // Parse tag: lpc:<slot>:<...path>:<state>
    const parts = tag.split(':');
    if (parts.length < 4 || parts[0] !== 'lpc') {
      logger.debug('buildLpcCatalog:unparseable-tag', { tag });
      continue;
    }

    const slot = parts[1];
    // The path is everything between slot and state (last segment)
    const state = parts[parts.length - 1];
    const pathParts = parts.slice(2, parts.length - 1);
    const path = pathParts.join('/');

    // Build assetId: slot/path (e.g. "hair/bangslong2/bg_adult")
    const assetId = `${slot}/${path}`;

    // Determine layerRole from filename prefix
    const lastSegment = pathParts[pathParts.length - 1] ?? '';
    const layerRole = lastSegment.startsWith('bg_') ? ('behind' as const) : ('front' as const);

    // Determine pairedAssetId for bg/fg pairs
    let pairedAssetId: string | undefined;
    if (layerRole === 'behind') {
      // The paired front asset replaces "bg_" with "fg_" in the last segment
      const frontSegment = lastSegment.replace(/^bg_/, 'fg_');
      const frontPathParts = [...pathParts];
      frontPathParts[frontPathParts.length - 1] = frontSegment;
      pairedAssetId = `${slot}/${frontPathParts.join('/')}`;
    } else if (lastSegment.startsWith('fg_')) {
      const behindSegment = lastSegment.replace(/^fg_/, 'bg_');
      const behindPathParts = [...pathParts];
      behindPathParts[behindPathParts.length - 1] = behindSegment;
      pairedAssetId = `${slot}/${behindPathParts.join('/')}`;
    }

    // Get or create variant map for this slot
    let variantMap = slotMap.get(slot);
    if (!variantMap) {
      variantMap = new Map();
      slotMap.set(slot, variantMap);
    }

    // Get or create variant for this assetId
    let variant = variantMap.get(assetId);
    if (!variant) {
      // Derive label from the last path segment (strip bg_/fg_ prefix)
      const labelSegment = lastSegment.replace(/^(bg_|fg_)/, '');
      const label = labelSegment.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      variant = {
        assetId,
        label,
        layerRole,
        pairedAssetId,
        states: [],
      };
      variantMap.set(assetId, variant);
    }

    // Add state if not already present (sorted for determinism)
    if (!variant.states.includes(state)) {
      // Use spread to create new array (immutable pattern)
      variant = { ...variant, states: [...variant.states, state].sort() };
      variantMap.set(assetId, variant);
    }
  }

  // Phase 2: Build slot definitions in lexicographic order by assetId
  const slotNames = [...slotMap.keys()].sort();
  const slots: LpcSlotDefinition[] = [];
  const assetIdsBySlot: Record<string, readonly string[]> = {};
  const allAssetIds: string[] = [];

  for (const slot of slotNames) {
    const variantMap = slotMap.get(slot);
    if (!variantMap) {
      continue;
    }
    const sortedAssetIds = [...variantMap.keys()].sort();
    const variants: LpcSlotVariant[] = [];

    for (const assetId of sortedAssetIds) {
      const variant = variantMap.get(assetId);
      if (!variant) {
        continue;
      }
      variants.push(variant);
      allAssetIds.push(assetId);
    }

    // Derive slot label from slot name
    const label = slot.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    slots.push({
      slot,
      label,
      variants,
    });

    assetIdsBySlot[slot] = sortedAssetIds;
  }

  logger.debug('buildLpcCatalog:complete', {
    slotCount: slots.length,
    variantCount: allAssetIds.length,
    entryCount: entries.length,
  });

  return {
    slots,
    assetIdsBySlot,
    allAssetIds,
  };
};
