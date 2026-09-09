// packages/frontend/engine/src/test_support/lpc_catalog.ts

import { buildLpcCatalog, LEGACY_CATALOG_SNAPSHOT } from '@aikami/lpc';

type LegacyDerivedCatalog = ReturnType<typeof buildLpcCatalog>['slots'];

/** Builds the derived runtime catalog from the verified legacy snapshot for engine tests. */
export const buildLegacyDerivedCatalog = (): LegacyDerivedCatalog =>
  buildLpcCatalog({
    entries: Object.entries(LEGACY_CATALOG_SNAPSHOT).flatMap(([, assetIds]) =>
      assetIds.map((assetId) => ({
        tag: `lpc:${assetId.replace(/\//g, ':')}:walk`,
        category: 'lpc',
        ext: 'webp',
      })),
    ),
  }).slots;

/** Resolves a 1-based engine layer ID to its stable asset ID. */
export const assetAt = (options: {
  catalog: LegacyDerivedCatalog;
  slot: string;
  layerId: number;
}): string | undefined =>
  options.catalog.find((entry) => entry.slot === options.slot)?.variants[options.layerId - 1]
    ?.assetId;

/** Resolves a 0-based catalog variant index to its stable asset ID. */
export const slotOf = (options: {
  catalog: LegacyDerivedCatalog;
  slot: string;
  index: number;
}): string | undefined =>
  options.catalog.find((entry) => entry.slot === options.slot)?.variants[options.index]?.assetId;
