// packages/shared/schemas/src/lib/generation/asset_recipe.ts
//
// Declarative asset-generation recipes and the modality-generic generation
// request they compile into (C-510). A recipe is DATA: it maps a catalog
// category to an engine plus prompt/parameter defaults, so adding a new
// category/engine mapping never requires a TypeScript change.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { type Static, Type } from 'typebox';
import { CatalogCategorySchema } from '../catalog/catalog_index.ts';
import { CommonGenerationEngineIdSchema } from '../media/generation_engine.ts';

// ---------------------------------------------------------------------------
// Modality / engine
// ---------------------------------------------------------------------------

/** What kind of media an engine produces. Only `image` ships in C-510. */
export const GenerationModalitySchema = Type.Union(
  [
    Type.Literal('image', { description: 'Still image (PNG/WebP)' }),
    Type.Literal('audio', { description: 'Audio clip — reserved, no engine ships it yet' }),
    Type.Literal('video', { description: 'Video clip — reserved, no engine ships it yet' }),
  ],
  { description: 'Generation modality' },
);

export type GenerationModality = Static<typeof GenerationModalitySchema>;

/**
 * Concrete generation engine id. Modality-specific engines belong only here;
 * image preferences compose the common ids separately.
 */
export const GenerationEngineIdSchema = Type.Union([
  CommonGenerationEngineIdSchema,
  Type.Literal('ace-step', { description: 'ACE-Step text-to-audio REST server (C-511)' }),
]);

export type GenerationEngineId = Static<typeof GenerationEngineIdSchema>;

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** What a resolved engine can actually honour. Drives recipe validation. */
export const GenerationCapabilitiesSchema = Type.Object({
  negativePrompt: Type.Boolean(),
  seed: Type.Boolean(),
  sampler: Type.Boolean(),
  initImage: Type.Boolean(),
  mask: Type.Boolean(),
  referenceImages: Type.Boolean(),
  controlNet: Type.Boolean(),
  lora: Type.Boolean(),
  cancel: Type.Boolean(),
  progress: Type.Boolean(),
});

export type GenerationCapabilities = Static<typeof GenerationCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Generation request
// ---------------------------------------------------------------------------

/**
 * Engine-agnostic generation request. `bytes` deliberately do not appear in a
 * schema — the result carries a `Uint8Array`, which TypeBox cannot validate.
 */
export const GenerationRequestSchema = Type.Object({
  modality: GenerationModalitySchema,
  engine: Type.Optional(GenerationEngineIdSchema),
  positivePrompt: Type.String({ minLength: 1 }),
  negativePrompt: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  width: Type.Optional(Type.Integer({ minimum: 1 })),
  height: Type.Optional(Type.Integer({ minimum: 1 })),
  steps: Type.Optional(Type.Integer({ minimum: 1 })),
  cfgScale: Type.Optional(Type.Number({ minimum: 0 })),
  /** Fixed seed (the engine picks one when omitted). */
  seed: Type.Optional(Type.Integer()),
  /** Sampler/scheduler name — only meaningful when the engine supports it. */
  sampler: Type.Optional(Type.String()),
  /** 0..1 — only meaningful with `initImage`. */
  denoise: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  /** Target length in seconds (audio/video). */
  durationSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  /**
   * Audio (C-511) — song/effect structure tags (genre, mood,
   * instrumentation). When absent the adapter falls back to the compiled
   * `positivePrompt`.
   */
  tags: Type.Optional(Type.String()),
  /** Audio (C-511) — lyrics for vocal tracks; absent/empty = instrumental. */
  lyrics: Type.Optional(Type.String()),
  /** Audio (C-511) — optional musical metadata; engines may infer it. */
  bpm: Type.Optional(Type.Number({ minimum: 1, maximum: 400 })),
  /** Audio (C-511) — optional musical key, e.g. 'C minor'. */
  key: Type.Optional(Type.String()),
  /**
   * Audio (C-511) — true = effect/one-shot, false = structured music. When
   * true it wins over `lyrics` (no vocals are requested).
   */
  instrumental: Type.Optional(Type.Boolean()),
  /** Base64 or data URL — img2img source. */
  initImage: Type.Optional(Type.String()),
  /** Base64 or data URL, single-channel — inpainting mask. */
  mask: Type.Optional(Type.String()),
  referenceImages: Type.Optional(Type.Array(Type.String())),
  loras: Type.Optional(Type.Array(Type.Object({ path: Type.String(), multiplier: Type.Number() }))),
});

export type GenerationRequest = Static<typeof GenerationRequestSchema>;

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

/**
 * A declarative generation recipe. `category` must exist in
 * `ASSET_CATEGORIES` — a category the scanner cannot classify is rejected at
 * load time rather than silently dropped at scan time.
 */
export const AssetRecipeSchema = Type.Object({
  /** Recipe id used on the CLI, e.g. 'prop', 'portrait', 'expression'. */
  id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]*$' }),
  category: CatalogCategorySchema,
  modality: GenerationModalitySchema,
  engine: Type.Optional(GenerationEngineIdSchema),
  model: Type.Optional(Type.String()),
  /** Must contain a `{{prompt}}` placeholder. */
  promptTemplate: Type.String({ minLength: 1 }),
  negativePrompt: Type.Optional(Type.String()),
  defaults: Type.Optional(
    Type.Object({
      width: Type.Optional(Type.Integer({ minimum: 1 })),
      height: Type.Optional(Type.Integer({ minimum: 1 })),
      steps: Type.Optional(Type.Integer({ minimum: 1 })),
      cfgScale: Type.Optional(Type.Number({ minimum: 0 })),
      durationSeconds: Type.Optional(Type.Number({ minimum: 0 })),
      /** Audio (C-511) — song/effect structure tags. */
      tags: Type.Optional(Type.String()),
      /** Audio (C-511) — lyrics for vocal tracks; absent/empty = instrumental. */
      lyrics: Type.Optional(Type.String()),
      /** Audio (C-511) — optional musical metadata. */
      bpm: Type.Optional(Type.Number({ minimum: 1, maximum: 400 })),
      key: Type.Optional(Type.String()),
      /** Audio (C-511) — true = effect/one-shot, false = structured music. */
      instrumental: Type.Optional(Type.Boolean()),
      loras: Type.Optional(
        Type.Array(Type.Object({ path: Type.String(), multiplier: Type.Number() })),
      ),
    }),
  ),
  output: Type.Object({
    /** Lowercase extension including the dot, e.g. '.png'. */
    ext: Type.String({ pattern: '^\\.[a-z0-9]+$' }),
    postprocess: Type.Optional(Type.Array(Type.String())),
  }),
  /** Tag template, e.g. 'props:{{slug}}'. `{{slug}}` expands from the prompt. */
  tagTemplate: Type.Optional(Type.String({ minLength: 1 })),
});

export type AssetRecipe = Static<typeof AssetRecipeSchema>;
