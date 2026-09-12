// packages/shared/schemas/src/lib/game/prop_atlas.ts
//
// Irregular prop-atlas pages (oversized transparent props).
//
// The grid atlas is a fixed 16×8 grid of 32×32 cells with per-cell edge
// extrusion, and map GIDs index it by `row * columns + col`. Oversized
// transparent props cannot live in that grid: a 192×152 ward tree, a 256×224
// inn or a 96×42 table are not tile cells, and per-cell extrusion would put
// visible seams through a sprite that spans cells.
//
// Approved prop artwork therefore ships as standalone images for authoring and
// is packed into one or more irregularly-packed pages at pack-build time.
// Prop definitions reference **stable frame names only** — never a page index
// or atlas coordinates — so the packer can add a page without touching a prop
// definition, a map or a save file.
//
// Frame names must be unique across the grid atlas and every page: the runtime
// resolver rejects duplicates rather than letting lookup precedence become
// ambiguous. Standalone per-prop texture URLs are reserved for genuinely
// exceptional assets, never the normal path.

import Type, { type Static } from 'typebox';
import { AssetProvenanceSchema } from './asset_provenance.ts';

/** One irregular prop-atlas page. */
export const ContentPackPropAtlasSchema = Type.Object({
  /** URL to a prop-atlas page texture (PNG/WebP, alpha required). */
  textureUrl: Type.String({ description: 'Prop-atlas page texture URL' }),
  /** URL to the page's spritesheet JSON (named frame definitions). */
  spritesheetUrl: Type.String({ description: 'Prop-atlas page spritesheet JSON URL' }),
  /** Per-asset provenance for the page texture (C-381 AC-1). */
  provenance: Type.Optional(AssetProvenanceSchema),
});

export type ContentPackPropAtlas = Static<typeof ContentPackPropAtlasSchema>;
