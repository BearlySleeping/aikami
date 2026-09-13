// packages/shared/schemas/src/lib/studio/studio.ts
//
// C-512: Creator Studio data shapes. All three cross the client ↔ shared
// boundary (the studio view model, the library projection and the recipe
// option list are consumed from more than one place), so they are TypeBox
// schemas with `Static`-derived types re-exported from `@aikami/types`.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import { type Static, Type } from 'typebox';
import { CatalogCategorySchema } from '../catalog/catalog_index.ts';
import { AssetProvenanceSchema } from '../game/asset_provenance.ts';
import { GenerationEngineIdSchema, GenerationModalitySchema } from '../generation/asset_recipe.ts';

/**
 * One selectable studio recipe.
 *
 * `label` is derived from the recipe id — `AssetRecipe` carries no label
 * field — and `engineAvailable` is resolved per modality at composition time
 * (`detectImageEngine` for image recipes; audio recipes stay unavailable
 * until C-511 ships an engine).
 */
export const StudioRecipeOptionSchema = Type.Object({
  recipeId: Type.String({ minLength: 1, description: 'AssetRecipe.id' }),
  label: Type.String({ minLength: 1, description: 'Human-readable recipe label' }),
  category: CatalogCategorySchema,
  modality: GenerationModalitySchema,
  engineAvailable: Type.Boolean({
    description: 'True when an engine for this recipe modality is reachable',
  }),
});

export type StudioRecipeOption = Static<typeof StudioRecipeOptionSchema>;

/**
 * The last generation result held by a draft, before it is saved.
 *
 * `tag` is the resolver tag (`expressionAssetTag` for NPC-bound drafts), never
 * the prompt-derived slug — the whole point of the tag override.
 */
export const StudioGeneratedResultSchema = Type.Object({
  tag: Type.String({ pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$' }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  engine: GenerationEngineIdSchema,
  seed: Type.Optional(Type.Integer()),
});

export type StudioGeneratedResult = Static<typeof StudioGeneratedResultSchema>;

/**
 * A studio editing session: the recipe, the prompt, and the last result.
 *
 * `npcId` is set for NPC-bound drafts (portrait / expression pack) and drives
 * the resolver tag; it is absent for standalone assets.
 */
export const StudioDraftSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  recipeId: Type.String({ minLength: 1 }),
  npcId: Type.Optional(Type.String()),
  positivePrompt: Type.String(),
  negativePrompt: Type.Optional(Type.String()),
  referenceImageTag: Type.Optional(Type.String()),
  initImageTag: Type.Optional(Type.String()),
  generated: Type.Optional(StudioGeneratedResultSchema),
  updatedAt: Type.String({ description: 'ISO-8601 timestamp of the last edit' }),
});

export type StudioDraft = Static<typeof StudioDraftSchema>;

/**
 * A projection over the local registry's `generated` pack rows — not a new
 * table.
 *
 * Mapping: `assets.id` → `tag`, `assets.category`, `assets.hash` → `sha256`,
 * `assets.size_bytes`, `assets.attribution` → `provenance.source`,
 * `asset_sources.backend === 'local-generated'` → `localGenerated`, and
 * `install_state.downloaded_at` → `createdAt` (the registry has no
 * `created_at` column — the cache write is the only timestamp).
 */
export const LibraryEntrySchema = Type.Object({
  tag: Type.String({ pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$' }),
  category: CatalogCategorySchema,
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  sizeBytes: Type.Integer({ minimum: 0 }),
  ext: Type.String({ description: 'Lowercase file extension including the dot' }),
  provenance: AssetProvenanceSchema,
  createdAt: Type.String({ description: 'ISO-8601 timestamp, or empty when unknown' }),
  localGenerated: Type.Boolean({
    description: 'True when generated on this device rather than fetched from a catalog',
  }),
});

export type LibraryEntry = Static<typeof LibraryEntrySchema>;
