// apps/frontend/hub/src/lib/constants/catalog_labels.ts
//
// Hub-local display labels for the six catalog categories (C-396).
//
// The C-395 root index carries no labels — only `{ id, count }` per shard —
// and this contract reuses C-395's index writer as-is rather than changing
// it, so the human-readable label lives here, keyed by category id.

/** Human-readable labels for the six scan categories. */
export const CATALOG_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  music: 'Music',
  sfx: 'Sound Effects',
  ambient: 'Ambient',
  sprites: 'Sprites',
  backgrounds: 'Backgrounds',
  lpc: 'LPC Characters',
} as const;

/** Display label for a category id, falling back to the raw id. */
export const catalogCategoryLabel = (categoryId: string): string =>
  CATALOG_CATEGORY_LABELS[categoryId] ?? categoryId;
