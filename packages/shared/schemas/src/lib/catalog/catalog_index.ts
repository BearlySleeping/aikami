// packages/shared/schemas/src/lib/catalog/catalog_index.ts
//
// Catalog index schemas for the R2 asset origin (C-395).
//
// The publish pipeline (scripts/src/lib/catalog/) emits two JSON documents
// into the bucket under index/v1/:
//   - catalog.json  → CatalogIndexRootSchema   (category summaries + counts only)
//   - <category>.json → CatalogIndexShardSchema (per-asset entries for one category)
//
// The root index must stay tiny: 12,707 per-asset entries would reproduce the
// 7 MB manifest.json problem (AC-2). Per-asset entries live in per-category
// shards fetched on demand by C-396 (browse) and C-397 (on-demand assets).
//
// License/attribution fields are first-class, not optional metadata: the LPC
// library is overwhelmingly CC-BY-SA / GPL, and a catalog that redistributes
// it without carrying attribution is a licensing problem, not a missing
// feature. Strings are held VERBATIM — LPC publishes "OGA-BY 3.0" which has
// no SPDX identifier, and multi-licensing (recipient may choose one) is the
// norm. Never normalise to SPDX (AC-4 watch points).
//
// Every object schema is strict (`additionalProperties: false`) so the shape
// contracts hold on the wire: the root index cannot silently grow per-asset
// entries, and a shard entry cannot smuggle extra fields.
//
// Contract: C-395

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Category — the six scan categories that publish to the catalog
// ---------------------------------------------------------------------------

/**
 * Catalog categories. Exactly what `scan_assets.ts` emits via ASSET_CATEGORIES:
 * music/sfx/ambient/sprites/backgrounds/lpc. `maps/` and `sprites/tilesets/`
 * are dev-only sandbox files and are NOT scan categories — they stay out of
 * the catalog (Edge Cases).
 */
export const CatalogCategorySchema = Type.Union(
  [
    Type.Literal('music'),
    Type.Literal('sfx'),
    Type.Literal('ambient'),
    Type.Literal('sprites'),
    Type.Literal('backgrounds'),
    Type.Literal('lpc'),
  ],
  { description: 'Catalog category — one of the six scan categories' },
);

export type CatalogCategory = Static<typeof CatalogCategorySchema>;

// ---------------------------------------------------------------------------
// Asset credit — license + attribution carried by every published asset
// ---------------------------------------------------------------------------

/**
 * Upstream attribution for one asset. Empty arrays mean genuinely unknown —
 * the publish preflight (AC-4) refuses to publish an asset that resolves to
 * neither a CREDITS.csv row nor a project-owned licence declaration.
 */
export const CatalogAssetCreditSchema = Type.Object(
  {
    /** Upstream license strings, VERBATIM. NOT SPDX — LPC publishes "OGA-BY 3.0". */
    licenses: Type.Array(Type.String(), {
      description: 'Upstream license strings held verbatim, never SPDX-normalised',
    }),
    /** Every author credited upstream, verbatim. */
    authors: Type.Array(Type.String(), {
      description: 'Every author credited upstream',
    }),
    /** Upstream source URLs (OpenGameArt pages etc.), for the credits page. */
    sourceUrls: Type.Array(Type.String(), {
      description: 'Upstream source URLs for the credits page',
    }),
    /** Freeform upstream note, where one exists. */
    licenseNote: Type.Optional(
      Type.String({ description: 'Freeform upstream note, where one exists' }),
    ),
  },
  { additionalProperties: false },
);

export type CatalogAssetCredit = Static<typeof CatalogAssetCreditSchema>;

// ---------------------------------------------------------------------------
// CatalogAssetEntry — one downloadable artifact
// ---------------------------------------------------------------------------

const SHA256_PATTERN = '^[a-f0-9]{64}$';
const EXT_PATTERN = '^\\.[a-z0-9]+$';

/** One downloadable artifact in the public catalog. */
export const CatalogAssetEntrySchema = Type.Object(
  {
    /** Stable logical id — the existing manifest tag, e.g. "lpc:hat:magic:celestial_adult:thrust". */
    tag: Type.String({ minLength: 1, description: 'Stable logical id — the manifest tag' }),
    /** sha256 of the bytes. Also the storage address. */
    hash: Type.String({
      pattern: SHA256_PATTERN,
      description: 'sha256 hex digest of the bytes — also the storage address',
    }),
    /** Byte size of the artifact. */
    sizeBytes: Type.Integer({ minimum: 0, description: 'Byte size of the artifact' }),
    /** Category from the existing scan (ASSET_CATEGORIES). */
    category: CatalogCategorySchema,
    /** Sub-category, e.g. "combat", "generic-fantasy". */
    subcategory: Type.Optional(Type.String({ description: 'Sub-category within the category' })),
    /** File extension including the dot, lowercase, e.g. ".webp". */
    ext: Type.String({ pattern: EXT_PATTERN, description: 'File extension including the dot' }),
    /** Upstream license strings, VERBATIM. Empty array = genuinely unknown. */
    licenses: Type.Array(Type.String(), {
      description: 'Upstream license strings held verbatim',
    }),
    /** Every author credited upstream. Empty array = genuinely unknown. */
    authors: Type.Array(Type.String(), {
      description: 'Every author credited upstream',
    }),
    /** Upstream source URLs (OpenGameArt pages etc.), for the credits page. */
    sourceUrls: Type.Array(Type.String(), {
      description: 'Upstream source URLs for the credits page',
    }),
    /** Freeform upstream note, where one exists. */
    licenseNote: Type.Optional(Type.String({ description: 'Freeform upstream note' })),
  },
  { additionalProperties: false },
);

export type CatalogAssetEntry = Static<typeof CatalogAssetEntrySchema>;

// ---------------------------------------------------------------------------
// CatalogIndexRoot — category summaries and counts ONLY
// ---------------------------------------------------------------------------

/**
 * Root index — category summaries and counts only, never per-asset entries.
 * 12,707 entries would reproduce the 7 MB manifest.json problem (AC-2);
 * per-asset entries live in per-category shards fetched on demand.
 */
export const CatalogIndexRootSchema = Type.Object(
  {
    /** Index schema version for forward compatibility. */
    schemaVersion: Type.Literal(1),
    /** ISO 8601 — when this index was published. */
    publishedAt: Type.String({ description: 'ISO 8601 publish timestamp' }),
    /** Base URL that shard `hash`es resolve against, e.g. "https://assets.bearlysleeping.com". */
    originUrl: Type.String({
      minLength: 1,
      description: 'Base URL that asset hashes resolve against',
    }),
    /** Total across all shards, so a client can show progress before fetching them. */
    totalCount: Type.Integer({ minimum: 0, description: 'Total assets across all shards' }),
    /** One summary row per category; its shard URL is `index/v1/<id>.json`. */
    categories: Type.Array(
      Type.Object(
        {
          /**
           * Shard id — the category id for single-shard categories
           * (matches CatalogAssetEntry.category), or a split-shard id like
           * `lpc__hat-magic` when a category's shard must be further
           * sharded by subcategory to stay under the 1 MB budget (AC-2).
           */
          id: Type.String({
            minLength: 1,
            description: 'Shard id — the category, or a split-shard id',
          }),
          /** Asset count in this shard. */
          count: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      { description: 'Per-shard summaries; shard URL is index/v1/<id>.json' },
    ),
  },
  { additionalProperties: false },
);

export type CatalogIndexRoot = Static<typeof CatalogIndexRootSchema>;

// ---------------------------------------------------------------------------
// CatalogIndexShard — per-asset entries for a single category
// ---------------------------------------------------------------------------

/** One category shard — per-asset entries for a single category. */
export const CatalogIndexShardSchema = Type.Object(
  {
    /** Index schema version for forward compatibility. */
    schemaVersion: Type.Literal(1),
    /** ISO 8601 — when this shard was published. */
    publishedAt: Type.String({ description: 'ISO 8601 publish timestamp' }),
    /** Base URL that `hash` resolves against. */
    originUrl: Type.String({
      minLength: 1,
      description: 'Base URL that asset hashes resolve against',
    }),
    /** Category this shard covers (same values as CatalogAssetEntry.category). */
    category: CatalogCategorySchema,
    /** Per-asset entries for this category. */
    entries: Type.Array(CatalogAssetEntrySchema, {
      description: 'Per-asset entries for this category',
    }),
  },
  { additionalProperties: false },
);

export type CatalogIndexShard = Static<typeof CatalogIndexShardSchema>;
