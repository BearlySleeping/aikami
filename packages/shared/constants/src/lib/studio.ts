// packages/shared/constants/src/lib/studio.ts
//
// C-512: Creator Studio labels. `AssetRecipe` is data and carries no label
// field, so the human-readable name for a recipe lives here — never hardcoded
// in a ViewModel (Pillar 2: labels belong in `@aikami/constants`).
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

/**
 * Recipe id → display label. Mirrors `packages/shared/local-ai/src/lib/recipes/recipes.json`.
 *
 * A recipe added to the registry without a label here still renders: the
 * fallback title-cases the id rather than dropping the option.
 */
export const STUDIO_RECIPE_LABELS: Readonly<Record<string, string>> = {
  prop: 'Prop',
  portrait: 'Character Portrait',
  expression: 'NPC Expression',
  tileset: 'Tileset',
  music: 'Music Track',
  sfx: 'Sound Effect',
  ambient: 'Ambient Loop',
};

/**
 * Human-readable label for a recipe id.
 *
 * Falls back to a title-cased id (`ambient-loop` → `Ambient Loop`) so a newly
 * registered recipe is selectable without a code change.
 *
 * @example studioRecipeLabel('portrait') // 'Character Portrait'
 * @example studioRecipeLabel('ambient-loop') // 'Ambient Loop'
 */
export const studioRecipeLabel = (recipeId: string): string => {
  const known = STUDIO_RECIPE_LABELS[recipeId];
  if (known !== undefined) {
    return known;
  }
  return recipeId
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

/**
 * `pack_id` rows the studio library lists and mutates.
 *
 * Re-exported from the C-510 write seam's pack id so the studio and the
 * registry write cannot drift.
 */
export { GENERATED_ASSET_PACK_ID } from './game_assets.ts';
