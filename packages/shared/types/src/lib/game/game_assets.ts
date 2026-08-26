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
  /** Relative path from game-data root, e.g. "sprites/generic-fantasy/elf-male.png" */
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

// ---------------------------------------------------------------------------
// Asset Registry & Local Cache (C-373)
// ---------------------------------------------------------------------------

/** Installation status of a single asset in the local cache. */
export type AssetCacheStatus = 'not_downloaded' | 'downloading' | 'cached' | 'stale';

/** Row shape of the `assets` registry table (snake_case column → camelCase). */
export type AssetRecord = {
  id: string;
  packId: string;
  category: string;
  hash: string;
  version: number;
  sizeBytes: number;
  license: string;
  attribution?: string;
  tags?: string[];
};

/** Row shape of the `asset_sources` table — a candidate download origin. */
export type AssetSource = {
  assetId: string;
  backend: 'bundled' | 'r2' | 'self-hosted';
  url: string;
  priority: number;
};

/** Row shape of the `install_state` table — per-asset cache bookkeeping. */
export type InstallStateRecord = {
  assetId: string;
  status: AssetCacheStatus;
  localPath?: string;
  cachedHash?: string;
  downloadedAt?: string;
};

/**
 * Content-hash provenance for a single manifest tag — SHA-256 + size in bytes.
 * Emitted by the manifest scanner as part of the `asset_hashes.json` sidecar
 * (C-373). Keeps `AssetEntry`/`AssetManifest` frozen (C-372 resolution).
 */
export type AssetHashEntry = {
  /** Hex-encoded SHA-256 digest of the asset file bytes. */
  hash: string;
  /** File size in bytes. */
  sizeBytes: number;
};

/**
 * Sidecar file emitted alongside `manifest.json` by `scan_assets.ts`.
 * Maps every manifest tag to its content hash + size so the local asset
 * registry can seed `assets.hash` without modifying the manifest shape.
 */
export type AssetHashesFile = {
  /** ISO timestamp of the scan — mirrors `AssetManifest.scannedAt`. */
  scannedAt: string;
  /** Tag → hash provenance (all keys must exist in the manifest). */
  hashes: Record<string, AssetHashEntry>;
};

// ---------------------------------------------------------------------------
// Compact Boot Seed (C-435)
// ---------------------------------------------------------------------------

/**
 * Minimal per-asset seed row — everything the registry needs, nothing more.
 * Replaces the 6.9 MB manifest.json + 1.7 MB asset_hashes.json on the boot path.
 */
export type AssetSeedRow = {
  /** Manifest tag, e.g. "lpc:body:bodies_male:walk". */
  tag: string;
  /** sha256 — also the R2 object key. */
  hash: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Category, e.g. "lpc", "sprites", "music". */
  category: string;
  /** File extension including the dot, for R2 key construction. */
  ext: string;
};

/**
 * The compact seed document, replacing manifest.json + asset_hashes.json at boot.
 * Bundled in the client at static/game-data/asset_seed.json (~1-2 MB instead of ~20 MB).
 */
export type AssetSeedDocument = {
  schemaVersion: 1;
  /** ISO timestamp when the seed was generated. */
  generatedAt: string;
  /** Origin the hashes resolve against. */
  originUrl: string;
  /** Seed rows — every asset the registry needs to know about. */
  rows: readonly AssetSeedRow[];
};

/**
 * Tags the client prefetches and pins on first run (C-448).
 *
 * Before C-448 this declared tags *bundled inside the client*. Nothing has
 * been bundled since C-435 de-bundled game-data, so the name described a
 * guarantee the build did not provide. It now declares the first-run
 * prefetch set: fetched once over the network, verified by hash, and pinned
 * in the OPFS / Tauri FS cache so every later run is fully offline.
 */
export type OfflineCoreDeclaration = {
  schemaVersion: 1;
  /** Tags the client prefetches and pins on first run. */
  tags: readonly string[];
  /** Why each group is core — starting map, default body, boot UI. */
  rationale: Readonly<Record<string, string>>;
};

// ---------------------------------------------------------------------------
// Compact JSON format (C-435) — short keys for smaller file size
// ---------------------------------------------------------------------------

/**
 * Compact JSON row format used in asset_seed.json.
 * Short keys save ~13% file size vs the full typed format.
 * t=tag, h=hash, s=sizeBytes, c=category, e=ext
 */
export type CompactSeedRow = {
  t: string;
  h: string;
  s: number;
  c: string;
  e: string;
};

/**
 * Compact JSON document format used in asset_seed.json.
 * sv=schemaVersion, g=generatedAt, o=originUrl, r=rows
 */
export type CompactSeedDocument = {
  sv: 1;
  g: string;
  o: string;
  r: readonly CompactSeedRow[];
};

/**
 * Parses a compact seed document (from asset_seed.json) into the typed format.
 */
export const parseAssetSeed = (compact: CompactSeedDocument): AssetSeedDocument => ({
  schemaVersion: compact.sv,
  generatedAt: compact.g,
  originUrl: compact.o,
  rows: compact.r.map((row) => ({
    tag: row.t,
    hash: row.h,
    sizeBytes: row.s,
    category: row.c,
    ext: row.e,
  })),
});
