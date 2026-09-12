// packages/shared/local-ai/src/lib/recipes/recipe_registry.test.ts
//
// AC-3 (C-510): recipes are data-driven.
//
// A new recipe JSON for an existing category/engine must be usable with no
// TypeScript change; an unknown engine id, unknown category, a category absent
// from ASSET_CATEGORIES, or a field the resolved engine does not support must
// fail validation with a readable error.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import { describe, expect, test } from 'bun:test';
import { ASSET_CATEGORIES } from '@aikami/constants';
import {
  compileRecipeRequest,
  getRecipe,
  listRecipes,
  registerRecipe,
  requireRecipe,
  validateRecipeCapabilities,
} from './recipe_registry.ts';

/** A minimal valid recipe, cloned per case so ids never collide. */
const baseRecipe = (id: string) => ({
  id,
  category: 'props',
  modality: 'image',
  engine: 'sdcpp',
  promptTemplate: '{{prompt}}, a game prop',
  output: { ext: '.png' },
  tagTemplate: 'props:{{slug}}',
});

describe('AC-3: data-driven recipes', () => {
  test('the shipped recipes load and cover the in-scope categories', () => {
    const ids = listRecipes().map((recipe) => recipe.id);
    expect(ids).toEqual(expect.arrayContaining(['prop', 'portrait', 'expression', 'tileset']));

    for (const recipe of listRecipes()) {
      expect(Object.keys(ASSET_CATEGORIES)).toContain(recipe.category);
    }
  });

  test('the expression recipe encodes the NPC/emotion pair in a portraits tag', () => {
    // CatalogCategory has no `expressions` literal, so the recipe ships under
    // `portraits` with a tagTemplate AC-5 can resolve.
    const recipe = requireRecipe('expression');
    expect(recipe.category).toBe('portraits');
    expect(recipe.tagTemplate).toBe('portraits:{{slug}}');
  });

  test('an unknown recipe id fails loudly and names the known ids', () => {
    expect(() => requireRecipe('does-not-exist')).toThrow(/Unknown asset recipe "does-not-exist"/);
    expect(() => requireRecipe('does-not-exist')).toThrow(/prop/);
  });

  test('getRecipe returns undefined for an unknown id', () => {
    expect(getRecipe('does-not-exist')).toBeUndefined();
  });

  test('a new recipe JSON is usable with no TypeScript change', () => {
    const recipe = registerRecipe({
      ...baseRecipe('test-new-prop'),
      tagTemplate: 'props:new-{{slug}}',
    });
    expect(getRecipe('test-new-prop')).toBe(recipe);
    const request = compileRecipeRequest(recipe, 'a lantern');
    expect(request.positivePrompt).toBe('a lantern, a game prop');
  });

  test('an unknown engine id is rejected', () => {
    expect(() =>
      registerRecipe({ ...baseRecipe('test-bad-engine'), engine: 'midjourney' }),
    ).toThrow(/unknown engine "midjourney"/);
  });

  test('an unknown category is rejected', () => {
    expect(() =>
      registerRecipe({ ...baseRecipe('test-bad-category'), category: 'nonsense' }),
    ).toThrow(/Invalid asset recipe/);
  });

  test('a category absent from ASSET_CATEGORIES is rejected at load time', () => {
    // `props` is in ASSET_CATEGORIES after C-510; simulate the half-registered
    // state by removing the entry for the duration of the assertion.
    const saved = ASSET_CATEGORIES.props;
    delete (ASSET_CATEGORIES as Record<string, unknown>).props;
    try {
      expect(() => registerRecipe({ ...baseRecipe('test-missing-category') })).toThrow(
        /absent from ASSET_CATEGORIES/,
      );
    } finally {
      (ASSET_CATEGORIES as Record<string, unknown>).props = saved;
    }
  });

  test('an extension the category does not accept is rejected', () => {
    expect(() =>
      registerRecipe({
        ...baseRecipe('test-bad-ext'),
        category: 'props',
        output: { ext: '.mp3' },
      }),
    ).toThrow(/does not accept/);
  });

  test('a promptTemplate without {{prompt}} is rejected', () => {
    expect(() =>
      registerRecipe({ ...baseRecipe('test-no-placeholder'), promptTemplate: 'a fixed prop' }),
    ).toThrow(/without a \{\{prompt\}\} placeholder/);
  });

  test('a declared postprocess step is rejected rather than silently skipped', () => {
    expect(() =>
      registerRecipe({
        ...baseRecipe('test-postprocess'),
        output: { ext: '.png', postprocess: ['remove-background'] },
      }),
    ).toThrow(/no postprocessor is implemented/);
  });

  test('a duplicate recipe id is rejected', () => {
    expect(() => registerRecipe({ ...baseRecipe('prop') })).toThrow(
      /Duplicate asset recipe id "prop"/,
    );
  });
});

describe('AC-3/AC-6: capability gating', () => {
  const fullCapabilities = {
    negativePrompt: true,
    seed: true,
    sampler: true,
    initImage: true,
    mask: true,
    referenceImages: true,
    controlNet: true,
    lora: true,
    cancel: true,
    progress: true,
  };

  const comfyuiCapabilities = {
    ...fullCapabilities,
    mask: false,
    lora: false,
    referenceImages: false,
  };

  test('a recipe with no unsupported field passes', () => {
    const recipe = requireRecipe('prop');
    expect(() => validateRecipeCapabilities(recipe, 'sdcpp', fullCapabilities)).not.toThrow();
    expect(() => validateRecipeCapabilities(recipe, 'comfyui', comfyuiCapabilities)).not.toThrow();
  });

  test('an unsupported recipe field fails loudly, naming the field and engine', () => {
    const recipe = { ...requireRecipe('prop'), negativePrompt: 'bad anatomy' };
    expect(() =>
      validateRecipeCapabilities(recipe, 'comfyui', {
        ...comfyuiCapabilities,
        negativePrompt: false,
      }),
    ).toThrow(/sets "negativePrompt", but the "comfyui" engine does not support it/);
  });

  test('unsupported defaults.loras are rejected for an engine without LoRA', () => {
    const recipe = {
      ...requireRecipe('prop'),
      defaults: { loras: [{ path: '/x.safetensors', multiplier: 0.8 }] },
    };
    expect(() => validateRecipeCapabilities(recipe, 'comfyui', comfyuiCapabilities)).toThrow(
      /sets "loras", but the "comfyui" engine does not support it/,
    );
  });
});

describe('AC-2/AC-3: recipe compilation', () => {
  test('defaults and overrides merge without clobbering', () => {
    const recipe = requireRecipe('prop');
    const request = compileRecipeRequest(recipe, 'a gate', { steps: 30 });
    expect(request.modality).toBe('image');
    expect(request.engine).toBe('sdcpp');
    expect(request.steps).toBe(30);
    expect(request.width).toBe(512);
    expect(request.negativePrompt).toBe(recipe.negativePrompt);
  });

  test('an explicit override wins over a recipe default', () => {
    const request = compileRecipeRequest(requireRecipe('prop'), 'a gate', { width: 256 });
    expect(request.width).toBe(256);
  });

  test('undefined overrides never clobber a recipe default', () => {
    const request = compileRecipeRequest(requireRecipe('prop'), 'a gate', { steps: undefined });
    expect(request.steps).toBe(20);
  });
});

describe('C-511 AC-3/AC-4: audio recipes', () => {
  const AudioRecipes = ['music', 'sfx', 'ambient'] as const;

  test('the audio recipes are registered against real ASSET_CATEGORIES entries', () => {
    for (const id of AudioRecipes) {
      const recipe = requireRecipe(id);
      expect(recipe.category).toBe(id);
      expect(Object.keys(ASSET_CATEGORIES)).toContain(recipe.category);
      expect(ASSET_CATEGORIES[recipe.category]?.extensions.has(recipe.output.ext)).toBe(true);
    }
  });

  test('every audio recipe targets the ace-step engine with a pinned model', () => {
    for (const id of AudioRecipes) {
      const recipe = requireRecipe(id);
      expect(recipe.modality).toBe('audio');
      expect(recipe.engine).toBe('ace-step');
      expect(recipe.model).toBe('audio-ace-step-v1-3.5b');
    }
  });

  test('the music recipe tag carries an exploration segment the resolver matches', () => {
    // `resolveBgmUrl('explore')` matches on a tag/subcategory SEGMENT, not on
    // the prefix — the tagTemplate is load-bearing, not decoration.
    expect(requireRecipe('music').tagTemplate).toBe('music:exploration:{{slug}}');
  });

  test('audio defaults compile into a request the ace-step adapter accepts', () => {
    const request = compileRecipeRequest(requireRecipe('music'), 'calm forest loop');
    expect(request.modality).toBe('audio');
    expect(request.engine).toBe('ace-step');
    expect(request.durationSeconds).toBe(60);
    expect(request.tags).toBeDefined();
    // Image-only fields must never leak in from an audio recipe.
    for (const field of ['width', 'height', 'steps', 'cfgScale', 'sampler'] as const) {
      expect(request[field]).toBeUndefined();
    }
  });

  test('the sfx recipe is instrumental by construction', () => {
    const request = compileRecipeRequest(requireRecipe('sfx'), 'metal gate slam');
    expect(request.instrumental).toBe(true);
  });

  test('per-run audio overrides win over the recipe defaults', () => {
    const request = compileRecipeRequest(requireRecipe('music'), 'calm forest loop', {
      durationSeconds: 12,
      lyrics: 'hold the line',
      instrumental: false,
    });
    expect(request.durationSeconds).toBe(12);
    expect(request.lyrics).toBe('hold the line');
    expect(request.instrumental).toBe(false);
  });

  test('an audio recipe passes capability validation for ace-step', () => {
    const recipe = requireRecipe('music');
    const aceStepCapabilities = {
      negativePrompt: false,
      seed: true,
      sampler: false,
      initImage: false,
      mask: false,
      referenceImages: false,
      controlNet: false,
      lora: false,
      cancel: false,
      progress: false,
    };
    expect(() => validateRecipeCapabilities(recipe, 'ace-step', aceStepCapabilities)).not.toThrow();
  });
});
