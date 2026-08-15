// packages/shared/schemas/src/lib/catalog/catalog_stats.ts
//
// Catalog stats schemas for GET /api/catalog/stats (C-396 AC-4).
//
// Placeholder aggregates served by the hub's Elysia handler. C-394's data
// plane (accounts/packs/pack_versions) has no install or rating columns —
// the handler returns pack-derived counts, zero until C-398/C-399 write
// rows, so the I-8 streaming machinery is real and testable end to end.
//
// These shapes are the contract for C-396 only; C-399 extends them without
// reopening this contract's document.

import { type Static, Type } from 'typebox';

/** Category-level stats — pack-derived count, zero until C-398/C-399. */
export const CategoryStatsSchema = Type.Object(
  {
    packCount: Type.Integer({ minimum: 0, description: 'Public packs in this category' }),
  },
  { additionalProperties: false },
);

export type CategoryStats = Static<typeof CategoryStatsSchema>;

/** Asset-level stats — pack-derived count, zero until C-398/C-399. */
export const AssetStatsSchema = Type.Object(
  {
    packCount: Type.Integer({ minimum: 0, description: 'Public packs for this asset' }),
  },
  { additionalProperties: false },
);

export type AssetStats = Static<typeof AssetStatsSchema>;
