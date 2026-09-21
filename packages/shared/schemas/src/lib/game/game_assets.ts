// packages/shared/schemas/src/lib/game_assets.ts
//
// TypeBox schemas for the Asset Management System (C-243).
// Runtime validation for upload payloads and manifest data
// crossing the frontend/backend boundary.
//
// Contract: C-243

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Asset Upload Payload
// ---------------------------------------------------------------------------

/** Schema for validating asset upload requests. */
export const AssetUploadPayloadSchema = Type.Object({
  category: Type.Union([
    Type.Literal('music'),
    Type.Literal('sfx'),
    Type.Literal('ambient'),
    Type.Literal('sprites'),
    Type.Literal('backgrounds'),
  ]),
  subcategory: Type.String({ minLength: 1 }),
  filename: Type.String({ minLength: 1 }),
  data: Type.String({ description: 'Base64-encoded file data for JSON transport' }),
});

export type AssetUploadPayloadValidated = Static<typeof AssetUploadPayloadSchema>;

// ---------------------------------------------------------------------------
// Asset Entry
// ---------------------------------------------------------------------------

/** Schema for a single asset entry. */
export const AssetEntrySchema = Type.Object({
  tag: Type.String({ minLength: 1 }),
  category: Type.String({ minLength: 1 }),
  subcategory: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
  ext: Type.String({ minLength: 2 }),
});

export type AssetEntryValidated = Static<typeof AssetEntrySchema>;

// ---------------------------------------------------------------------------
// Asset Manifest
// ---------------------------------------------------------------------------

/** Schema for the full asset manifest. */
export const AssetManifestSchema = Type.Object({
  scannedAt: Type.String({ minLength: 1 }),
  count: Type.Number({ minimum: 0 }),
  assets: Type.Record(Type.String(), AssetEntrySchema),
  byCategory: Type.Record(Type.String(), Type.Array(AssetEntrySchema)),
});

export type AssetManifestValidated = Static<typeof AssetManifestSchema>;

// ---------------------------------------------------------------------------
// Asset hashes sidecar (C-519: the batch runner stages this fragment)
// ---------------------------------------------------------------------------

/** Content-hash provenance for a single manifest tag. */
export const AssetHashEntrySchema = Type.Object({
  hash: Type.String({ minLength: 1 }),
  sizeBytes: Type.Number({ minimum: 0 }),
});

export type AssetHashEntryValidated = Static<typeof AssetHashEntrySchema>;

/**
 * The `hashes.json` sidecar: tag → content hash + size.
 *
 * Validated wherever it crosses a boundary — including the C-519 batch
 * runner's namespaced staging fragments.
 */
export const AssetHashesFileSchema = Type.Object({
  scannedAt: Type.String({ minLength: 1 }),
  hashes: Type.Record(Type.String(), AssetHashEntrySchema),
});

export type AssetHashesFileValidated = Static<typeof AssetHashesFileSchema>;

// ---------------------------------------------------------------------------
// Compact boot seed + offline-core declaration (C-435 / C-448)
// ---------------------------------------------------------------------------

/** One row in the compact boot-seed wire format. */
export const CompactSeedRowSchema = Type.Object(
  {
    t: Type.String(),
    h: Type.String(),
    s: Type.Number(),
    c: Type.String(),
    e: Type.String(),
    l: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

/** The compact seed document published as `asset_seed.json`. */
export const CompactSeedDocumentSchema = Type.Object(
  {
    sv: Type.Literal(1),
    g: Type.String(),
    o: Type.String(),
    r: Type.Array(CompactSeedRowSchema),
  },
  { additionalProperties: false },
);

/** Tags prefetched and pinned during the first offline-capable install. */
export const OfflineCoreDeclarationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    tags: Type.Array(Type.String()),
    rationale: Type.Record(Type.String(), Type.String()),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// File Info
// ---------------------------------------------------------------------------

/** Schema for file info response. */
export const AssetFileInfoSchema = Type.Object({
  path: Type.String(),
  size: Type.Number(),
  modifiedAt: Type.String(),
  ext: Type.String(),
  mimeType: Type.String(),
  category: Type.String(),
  tag: Type.String(),
});
