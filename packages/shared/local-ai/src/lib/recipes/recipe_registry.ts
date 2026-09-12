// packages/shared/local-ai/src/lib/recipes/recipe_registry.ts
//
// Declarative asset-recipe registry (C-510). Recipes are DATA: `recipes.json`
// is the source, validated at load time against the TypeBox schema, the
// `ASSET_CATEGORIES` table and the resolved engine's capabilities. Adding a
// recipe for an existing category/engine is a JSON edit — no TypeScript change.
//
// A recipe that cannot round-trip through `scan_assets.ts` (unknown category)
// or that asks an engine for something it cannot do is rejected here, loudly.
// Silently dropping it is the failure mode this module exists to prevent.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { ASSET_CATEGORIES } from '@aikami/constants';
import { AssetRecipeSchema } from '@aikami/schemas';
import type { AssetRecipe, GenerationCapabilities, GenerationRequest } from '@aikami/types';
import { Value } from 'typebox/value';
import {
  DEFAULT_GENERATION_ENGINE_ID,
  GENERATION_ENGINE_IDS,
  isGenerationEngineId,
} from '../engines/factory.ts';
import recipeData from './recipes.json' with { type: 'json' };

/** A generation-request field that maps onto a capability flag. */
const CAPABILITY_FIELDS: readonly {
  field: keyof GenerationRequest;
  capability: keyof GenerationCapabilities;
}[] = [
  { field: 'negativePrompt', capability: 'negativePrompt' },
  { field: 'seed', capability: 'seed' },
  { field: 'sampler', capability: 'sampler' },
  { field: 'initImage', capability: 'initImage' },
  { field: 'mask', capability: 'mask' },
  { field: 'referenceImages', capability: 'referenceImages' },
  { field: 'loras', capability: 'lora' },
];

/** Mutable registry — `recipes.json` seeds it, tests may register more. */
const _recipes = new Map<string, AssetRecipe>();

/** Returns the first TypeBox error for a value, formatted for a message. */
const _describeSchemaError = (value: unknown): string => {
  const first = [...Value.Errors(AssetRecipeSchema, value)][0];
  return first ? `${first.instancePath || '/'}: ${first.message}` : 'unknown schema error';
};

/**
 * Validates and registers a recipe. Called for every entry in `recipes.json`
 * at module load, and available to tests that register extra recipes.
 *
 * @throws Error on a schema violation, an unknown engine id, a category the
 *         asset scanner cannot classify, or a declared postprocess step.
 */
export const registerRecipe = (raw: unknown): AssetRecipe => {
  // Pre-check the engine id so an unknown one produces a readable message
  // rather than a raw union-mismatch from the schema validator.
  const rawEngine = (raw as { engine?: unknown } | undefined)?.engine;
  if (typeof rawEngine === 'string' && !isGenerationEngineId(rawEngine)) {
    const rawId = (raw as { id?: unknown }).id;
    throw new Error(
      `Recipe "${typeof rawId === 'string' ? rawId : '(unknown)'}" names the unknown engine "${rawEngine}" — known engines: ${GENERATION_ENGINE_IDS.join(', ')}`,
    );
  }

  if (!Value.Check(AssetRecipeSchema, raw)) {
    throw new Error(`Invalid asset recipe: ${_describeSchemaError(raw)}`);
  }
  const recipe = raw as AssetRecipe;

  if (recipe.engine !== undefined && !isGenerationEngineId(recipe.engine)) {
    throw new Error(
      `Recipe "${recipe.id}" names the unknown engine "${recipe.engine}" — known engines: ${GENERATION_ENGINE_IDS.join(', ')}`,
    );
  }

  // A category absent from ASSET_CATEGORIES is silently dropped by
  // scan_assets.ts (categoryForPath → continue). Reject it at load time.
  if (!(recipe.category in ASSET_CATEGORIES)) {
    throw new Error(
      `Recipe "${recipe.id}" maps to the category "${recipe.category}", which is absent from ASSET_CATEGORIES — scan_assets.ts would silently drop its output`,
    );
  }

  const declaredExtensions = ASSET_CATEGORIES[recipe.category]?.extensions;
  if (declaredExtensions && !declaredExtensions.has(recipe.output.ext)) {
    throw new Error(
      `Recipe "${recipe.id}" emits "${recipe.output.ext}", which the "${recipe.category}" category does not accept (${[...declaredExtensions].join(', ')})`,
    );
  }

  if (recipe.output.postprocess && recipe.output.postprocess.length > 0) {
    throw new Error(
      `Recipe "${recipe.id}" declares postprocess steps (${recipe.output.postprocess.join(', ')}), but no postprocessor is implemented — refusing to silently skip them`,
    );
  }

  if (!recipe.promptTemplate.includes('{{prompt}}')) {
    throw new Error(`Recipe "${recipe.id}" has a promptTemplate without a {{prompt}} placeholder`);
  }

  if (_recipes.has(recipe.id)) {
    throw new Error(`Duplicate asset recipe id "${recipe.id}"`);
  }

  _recipes.set(recipe.id, recipe);
  return recipe;
};

/**
 * Validates a compiled request against a resolved engine's capabilities.
 *
 * Capability gating is explicit: a request that asks for something the engine
 * cannot do fails with a readable error rather than having the field stripped
 * silently at dispatch (C-388 AC-5 precedent).
 *
 * @throws Error naming the unsupported field and the engine.
 */
export const validateRequestCapabilities = (
  request: GenerationRequest,
  engineId: string,
  capabilities: GenerationCapabilities,
  context = 'request',
): void => {
  for (const { field, capability } of CAPABILITY_FIELDS) {
    const value = request[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (!capabilities[capability]) {
      throw new Error(
        `${context} sets "${field}", but the "${engineId}" engine does not support it (capability "${capability}" is false)`,
      );
    }
  }
};

/**
 * Validates a recipe against a resolved engine's capabilities.
 *
 * Compiles the recipe's declared fields into a request and delegates to
 * {@link validateRequestCapabilities}, so recipe defaults and per-run
 * overrides are gated by exactly the same rule.
 *
 * @throws Error naming the unsupported field and the engine.
 */
export const validateRecipeCapabilities = (
  recipe: AssetRecipe,
  engineId: string,
  capabilities: GenerationCapabilities,
): void => {
  validateRequestCapabilities(
    compileRecipeRequest(recipe, ''),
    engineId,
    capabilities,
    `Recipe "${recipe.id}"`,
  );
};

/** Every registered recipe, in registration order. */
export const listRecipes = (): readonly AssetRecipe[] => [..._recipes.values()];

/** Looks up a recipe by id. */
export const getRecipe = (id: string): AssetRecipe | undefined => _recipes.get(id);

/**
 * Looks up a recipe by id, failing loudly when it is unknown.
 *
 * @throws Error listing the known recipe ids.
 */
export const requireRecipe = (id: string): AssetRecipe => {
  const recipe = _recipes.get(id);
  if (!recipe) {
    const known = listRecipes()
      .map((entry) => entry.id)
      .join(', ');
    throw new Error(`Unknown asset recipe "${id}" — known recipes: ${known || '(none)'}`);
  }
  return recipe;
};

/** Per-run overrides applied on top of a recipe's defaults. */
export type RecipeOverrides = Partial<
  Pick<
    GenerationRequest,
    | 'model'
    | 'width'
    | 'height'
    | 'steps'
    | 'cfgScale'
    | 'seed'
    | 'sampler'
    | 'negativePrompt'
    | 'initImage'
    | 'mask'
    | 'referenceImages'
    | 'loras'
    // C-511 audio fields — a per-run override must not be silently dropped.
    | 'durationSeconds'
    | 'tags'
    | 'lyrics'
    | 'bpm'
    | 'key'
    | 'instrumental'
  >
>;

/**
 * Compiles a recipe + prompt + overrides into a `GenerationRequest`.
 *
 * The engine id is the override's, else the recipe's, else
 * {@link DEFAULT_GENERATION_ENGINE_ID}. `undefined` override values never
 * clobber a recipe default — only explicitly supplied ones do.
 */
export const compileRecipeRequest = (
  recipe: AssetRecipe,
  prompt: string,
  overrides: RecipeOverrides = {},
): GenerationRequest => {
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as RecipeOverrides;

  return {
    modality: recipe.modality,
    engine: recipe.engine ?? DEFAULT_GENERATION_ENGINE_ID,
    positivePrompt: recipe.promptTemplate.replaceAll('{{prompt}}', prompt),
    negativePrompt: recipe.negativePrompt,
    model: recipe.model,
    ...(recipe.defaults ?? {}),
    ...definedOverrides,
  };
};

// Seed the registry from the data file. A malformed entry throws at import
// time — a broken recipe must never reach a call site.
for (const entry of recipeData as readonly unknown[]) {
  registerRecipe(entry);
}
