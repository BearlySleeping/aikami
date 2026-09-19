// packages/shared/schemas/src/lib/game/npc_portraits.ts
//
// Authored dialogue busts for a content-pack NPC.
//
// Extracted from `content_pack.ts` when that module reached its reviewed size
// ceiling. The world sprite stays the stable LPC component set in `appearance`;
// this is only the dialogue bust, and keeping them separate is deliberate — a
// portrait is a composed frame with its own coverage, while the world sprite is
// an animated sheet, and neither can be derived from the other.

import { type Static, Type } from 'typebox';

/** Published catalog path accepted for authored NPC portrait variants. */
export const CATALOG_PORTRAIT_PATH_PATTERN =
  /^(?:\/game-data\/)?portraits\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)+[A-Za-z0-9][A-Za-z0-9_-]*\.(?:png|webp|svg)$/;

export const CatalogPortraitPathSchema = Type.String({
  pattern: CATALOG_PORTRAIT_PATH_PATTERN.source,
  description: 'Published portrait path under the game-data portrait catalog',
});

export const isCatalogPortraitPath = (value: string): boolean =>
  CATALOG_PORTRAIT_PATH_PATTERN.test(value);

/**
 * The emotion variants a pack may author for one NPC.
 *
 * `neutral` is required: it is what the dialogue overlay shows when no state
 * selects a more specific expression, so a pack that authors any portrait must
 * author the one every conversation can fall back to.
 */
export const NpcPortraitVariantsSchema = Type.Object(
  {
    neutral: CatalogPortraitPathSchema,
    concerned: Type.Optional(CatalogPortraitPathSchema),
    relieved: Type.Optional(CatalogPortraitPathSchema),
    guarded: Type.Optional(CatalogPortraitPathSchema),
    hostile: Type.Optional(CatalogPortraitPathSchema),
  },
  {
    additionalProperties: false,
    description: 'Emotion variant → published portrait image URL',
  },
);

export type NpcPortraitVariants = Static<typeof NpcPortraitVariantsSchema>;

/** Authored portraits for one NPC. */
export const NpcPortraitsSchema = Type.Object(
  {
    variants: NpcPortraitVariantsSchema,
    /** Attribution carried through to the published portrait rows. */
    credit: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export type NpcPortraits = Static<typeof NpcPortraitsSchema>;
