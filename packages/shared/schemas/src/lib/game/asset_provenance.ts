// packages/shared/schemas/src/lib/game/asset_provenance.ts
//
// Provenance and asset-reference schemas shared by the content-pack manifest
// and every asset-bearing sub-schema.
//
// Contract: C-381 Content Pipeline Hardening — AC-1 (provenance), AC-2 (refs).
//
// These live in their own module because they are referenced from both the
// manifest and its extracted sub-schemas (e.g. the prop-atlas page schema).
// Keeping them in `content_pack.ts` would make any extracted sub-schema import
// back from the manifest module — a cycle over TypeBox schema *values*, which
// are evaluated at module init and would not survive it. `content_pack.ts`
// re-exports both for compatibility.

import Type, { type Static } from 'typebox';

/**
 * Provenance carried by every asset a pack declares.
 */
export const AssetProvenanceSchema = Type.Object({
  /** SPDX identifier, or 'proprietary'. Free text is not acceptable here. */
  license: Type.String({
    pattern:
      '^(MIT|Apache-2\\.0|GPL-2\\.0|GPL-3\\.0|CC-BY-4\\.0|CC-BY-SA-4\\.0|CC-BY-SA-3\\.0|OGA-BY-3\\.0|proprietary)$',
    description: 'SPDX licence identifier',
  }),
  /** Attribution name(s) required by the licence. */
  author: Type.Array(Type.String(), {
    minItems: 1,
    description: 'Attribution names required by the licence',
  }),
  /** Where it came from: an upstream URL, 'generated:<provider>', or 'original'. */
  source: Type.String({ description: 'Asset source (URL, generated:<provider>, or original)' }),
  /** True when the licence is share-alike and derivatives must inherit it. */
  shareAlike: Type.Optional(Type.Boolean({ description: 'Share-alike licence indicator' })),
});

export type AssetProvenance = Static<typeof AssetProvenanceSchema>;

/**
 * Assets are referenced by content hash, resolved through the C-373 registry.
 */
export const AssetRefSchema = Type.Object({
  /** Registry tag (e.g. 'sprites:tilesets:atlas'). */
  tag: Type.String({ pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$', description: 'Registry tag' }),
  /** SHA-256 of the content. The registry verifies before use. */
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$', description: 'SHA-256 content hash' }),
  provenance: AssetProvenanceSchema,
});

export type AssetRef = Static<typeof AssetRefSchema>;
