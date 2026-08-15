// packages/shared/types/src/lib/game/catalog_index.ts
//
// Catalog index types — re-exported from the TypeBox schemas in
// @aikami/schemas, the single source of truth (the schema module derives
// these types via Static<>; this module only re-exports them so the public
// type names stay available from @aikami/types).
// Contract: C-395 R2 Asset Origin and Content-Addressed Catalog Index

export type {
  CatalogAssetCredit,
  CatalogAssetEntry,
  CatalogCategory,
  CatalogIndexRoot,
  CatalogIndexShard,
} from '@aikami/schemas';
