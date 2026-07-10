// packages/shared/types/src/lib/game_assets.ts
//
// Domain types for the Asset Management System (C-243).
// AssetManifest, AssetEntry, AssetCategory, AssetUploadPayload,
// and asset store state types.
//
// Contract: C-243

// ---------------------------------------------------------------------------
// Asset Entry
// ---------------------------------------------------------------------------

/** A single asset indexed in the manifest. */
export type AssetEntry = {
  /** Tag for referencing in prompts and code, e.g. "sprites:generic-fantasy:elf-male" */
  tag: string;
  /** Top-level category: music, sfx, ambient, sprites, backgrounds */
  category: string;
  /** Sub-category, e.g. "combat", "generic-fantasy", "nature" */
  subcategory: string;
  /** Filename without extension */
  name: string;
  /** Relative path from game-assets root, e.g. "sprites/generic-fantasy/elf-male.png" */
  path: string;
  /** Lowercase file extension including dot, e.g. ".png" */
  ext: string;
};

// ---------------------------------------------------------------------------
// Asset Manifest
// ---------------------------------------------------------------------------

/** Full asset manifest — all discovered assets indexed by tag and category. */
export type AssetManifest = {
  /** ISO timestamp of last scan */
  scannedAt: string;
  /** Total asset count */
  count: number;
  /** All assets indexed by tag (primary lookup) */
  assets: Record<string, AssetEntry>;
  /** Assets grouped by category for quick listing */
  byCategory: Record<string, AssetEntry[]>;
};

// ---------------------------------------------------------------------------
// Asset Category
// ---------------------------------------------------------------------------

/** Category metadata — name, allowed extensions, and default subdirectories. */
export type AssetCategory = {
  name: string;
  extensions: Set<string>;
  defaultSubdirs: string[];
};

// ---------------------------------------------------------------------------
// Upload Payload
// ---------------------------------------------------------------------------

/** Payload for uploading a new asset file. */
export type AssetUploadPayload = {
  category: 'music' | 'sfx' | 'ambient' | 'sprites' | 'backgrounds';
  /** Subdirectory path within the category, e.g. "generic-fantasy" or "combat/fantasy/intense" */
  subcategory: string;
  /** Desired filename (extracted from original or user-provided) */
  filename: string;
  /** Raw file bytes */
  data: ArrayBuffer;
};

// ---------------------------------------------------------------------------
// Asset Store State (Svelte 5 runes)
// ---------------------------------------------------------------------------

/** Reactive state shape for the AssetStore service. */
export type AssetStoreState = {
  manifest: AssetManifest | null;
  isLoading: boolean;
  error: string | null;
  currentBackground: string | null;
  currentMusic: string | null;
  audioMuted: boolean;
};

// ---------------------------------------------------------------------------
// Directory Tree (for UI)
// ---------------------------------------------------------------------------

/** A node in the asset folder tree. */
export type AssetTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: AssetTreeNode[];
};
