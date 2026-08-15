// packages/shared/types/src/lib/game/catalog_index.ts
//
// Catalog index types — derived from TypeBox schemas in @aikami/schemas.
// Contract: C-395 R2 Asset Origin and Content-Addressed Catalog Index

import type {
  CatalogAssetCreditSchema,
  CatalogAssetEntrySchema,
  CatalogCategorySchema,
  CatalogIndexRootSchema,
  CatalogIndexShardSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** Catalog category — one of the six scan categories. */
export type CatalogCategory = Static<typeof CatalogCategorySchema>;

/** Upstream attribution for one asset (licenses/authors/sourceUrls verbatim). */
export type CatalogAssetCredit = Static<typeof CatalogAssetCreditSchema>;

/** One downloadable artifact in the public catalog. */
export type CatalogAssetEntry = Static<typeof CatalogAssetEntrySchema>;

/** Root index — category summaries and counts only. */
export type CatalogIndexRoot = Static<typeof CatalogIndexRootSchema>;

/** One category shard — per-asset entries for a single category. */
export type CatalogIndexShard = Static<typeof CatalogIndexShardSchema>;
