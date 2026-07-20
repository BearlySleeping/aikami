// packages/shared/schemas/src/lib/game/pack_index.ts
//
// Content pack registry index — validates the pre-authored index.json that
// lists all installed content packs at static/content-packs/.
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Semver validation (shared pattern with content_pack.ts)
// ---------------------------------------------------------------------------

const SEMVER_PATTERN =
  '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

// ---------------------------------------------------------------------------
// PackIndexEntry — a single entry in the content pack registry index
// ---------------------------------------------------------------------------

export const PackIndexEntrySchema = Type.Object({
  /** Pack identifier — matches ContentPackManifest.id and Campaign.contentPackId */
  id: Type.String({ minLength: 1 }),
  /** Human-readable pack name (cached from manifest for fast listing) */
  name: Type.String(),
  /** Semantic version string (cached from manifest) */
  version: Type.String({ pattern: SEMVER_PATTERN }),
  /** ISO 8601 last modification timestamp (cached from manifest) */
  updatedAt: Type.String(),
  /** Short description of the adventure (cached from manifest) */
  description: Type.Optional(Type.String()),
});

export type PackIndexEntry = Static<typeof PackIndexEntrySchema>;

// ---------------------------------------------------------------------------
// PackIndex — top-level pack registry index
// ---------------------------------------------------------------------------

export const PackIndexSchema = Type.Object({
  /** Registry schema version for forward compatibility */
  schemaVersion: Type.Literal(1),
  /** All installed content packs */
  packs: Type.Array(PackIndexEntrySchema),
});

export type PackIndex = Static<typeof PackIndexSchema>;
