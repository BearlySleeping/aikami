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
