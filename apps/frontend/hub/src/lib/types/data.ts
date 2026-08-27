// apps/frontend/hub/src/lib/types/data.ts
//
// Client-side page data types for the catalog browse surface (C-396).
//
// These are the shapes returned by the `+page.server.ts` loads — plain data
// (devalue-safe: Dates, Maps, Sets and BigInts survive the wire natively;
// class instances do not). No `+page.ts` mapper layer exists for the hub:
// Drizzle returns plain `Date` objects and the static index is already plain
// JSON, so there is nothing to serialise (see C-396 Design Reference).
//
// Postgres-backed values (`stats`) are streamed promises that resolve AFTER
// first paint (I-8) — the page data type carries the promise itself, never a
// blocked-on value.

import type { AssetStats, CatalogAssetEntry, CategoryStats } from '@aikami/schemas';

// Re-export the shared stats contract so page data references resolve through
// $types without a second source of truth (C-396: these shapes are defined
// once in @aikami/schemas and consumed by the hub's stats handler + loads).
export type { AssetStats, CategoryStats };

// ---------------------------------------------------------------------------
// Catalog landing — category summaries only
// ---------------------------------------------------------------------------

/** One category row on the landing page. */
export type CatalogCategorySummary = {
  /** Six-value category id ("lpc", "music", …). */
  id: string;
  /** Hub-local display label for the category. */
  label: string;
  /** Total assets across every shard of this category. */
  count: number;
};

/**
 * Catalog landing page data.
 *
 * `status: 'error'` is the explicit degraded state required by C-396 Quality
 * Requirements: when the static index is unreachable the page renders an
 * explicit error state with a retry affordance — never a blank list and
 * never a 500.
 */
export type CatalogLandingPageData =
  | {
      status: 'ready';
      categories: readonly CatalogCategorySummary[];
      /** ISO 8601 — when the index was published. */
      publishedAt: string;
    }
  | {
      status: 'error';
      message: string;
    };

// ---------------------------------------------------------------------------
// Catalog category — one shard-backed browse page
// ---------------------------------------------------------------------------

/**
 * One category's assets, merged from every C-395 shard whose id equals the
 * category or starts with `<category>__` (the split-shard form).
 */
export type CatalogCategoryPageData = {
  category: string;
  categoryLabel: string;
  /** Total entries in this category (all shards). */
  totalCount: number;
  /** Shard origin base URL — used by tiles to resolve thumbnail URLs. */
  originUrl: string;
  entries: readonly CatalogAssetEntry[];
  /**
   * Streamed — resolves to null when the stats endpoint is unreachable or
   * unconfigured. NEVER awaited before first paint (I-8).
   */
  stats: Promise<CategoryStats | null>;
};

// ---------------------------------------------------------------------------
// Catalog asset — detail page
// ---------------------------------------------------------------------------

/** A single asset, with license and attribution surfaced. */
export type CatalogAssetPageData = {
  category: string;
  categoryLabel: string;
  entry: CatalogAssetEntry;
  /**
   * Full entries from the category shard (C-446). Used by the client-side
   * preview resolver to resolve tags without a second index fetch.
   * For map and pack pages, this also includes the tilesets shard entries.
   */
  entries: readonly CatalogAssetEntry[];
  /** CDN origin URL — used by the client-side resolver. */
  originUrl: string;
  /**
   * Resolved CDN URL for the preview — the single-frame thumbnail from the
   * pipeline (AC-5), NOT the raw multi-frame sheet. `undefined` when the
   * entry predates the thumbnail republish; the view must say the preview is
   * unavailable rather than rendering the raw sheet.
   */
  previewUrl: string | undefined;
  /** Streamed — null when the stats endpoint is unreachable/unconfigured. */
  stats: Promise<AssetStats | null>;
};
