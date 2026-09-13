// apps/frontend/client/src/lib/views/studio/studio_generation_runner.test.ts
//
// C-513 AC-12: recipe dispatch is keyed by `recipe.modality` through the
// shared runner, and an audio recipe becomes available the moment an audio
// engine adapter is registered — with a stated reason while none is.

import { describe, expect, test } from 'bun:test';
import { listRecipes } from '@aikami/local-ai';
import type { GeneratedAssetOutcome } from '@aikami/types';
import {
  buildModalityRecipeOptions,
  createStudioEngineRegistry,
  createStudioGenerationRunner,
  noEngineRegisteredReason,
  type StudioEngineCapability,
  type StudioGenerationWorkflow,
} from './studio_generation_runner.ts';

const AUDIO_RECIPE = listRecipes().find((recipe) => recipe.modality === 'audio');
const IMAGE_RECIPE = listRecipes().find((recipe) => recipe.modality === 'image');

/** A stub audio engine — exactly what C-521 will register. */
const createStubAudioEngine = (options: {
  available: boolean;
  onGenerate?: (recipeId: string) => void;
}): StudioEngineCapability => ({
  modality: 'audio',
  unavailableReason: 'No audio engine is reachable — start ace-step and reload.',
  isAvailable: async () => options.available,
  generate: async (request) => {
    options.onGenerate?.(request.recipeId);
    return {
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/ogg' }),
      mimeType: 'audio/ogg',
      engineId: 'ace-step',
      isDemo: true,
    };
  },
  cancel: () => undefined,
});

const createImageEngine = (): StudioEngineCapability => ({
  modality: 'image',
  unavailableReason: 'No image engine is reachable — start sd-server and reload.',
  isAvailable: async () => true,
  generate: async () => ({
    blob: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }),
    mimeType: 'image/png',
    engineId: 'sdcpp',
    isDemo: false,
  }),
  cancel: () => undefined,
});

const outcomeFor = (tag: string): GeneratedAssetOutcome => ({
  tag,
  sha256: 'a'.repeat(64),
  engine: 'ace-step',
  sizeBytes: 4,
  ext: '.ogg',
  mimeType: 'audio/ogg',
  previewUrl: 'blob:test',
  isDemo: true,
});

describe('AC-12: capability gating is per modality', () => {
  test('an audio recipe is gated with a stated reason while no audio engine is registered', async () => {
    const registry = createStudioEngineRegistry([createImageEngine()]);
    const options = await buildModalityRecipeOptions({
      registry,
      label: (id) => id,
    });

    const audio = options.find((option) => option.recipeId === AUDIO_RECIPE?.id);
    expect(audio?.engineAvailable).toBe(false);
    expect(audio?.unavailableReason).toBe(noEngineRegisteredReason('audio'));

    const image = options.find((option) => option.recipeId === IMAGE_RECIPE?.id);
    expect(image?.engineAvailable).toBe(true);
    expect(image?.unavailableReason).toBeUndefined();
  });

  test('an unreachable adapter reports its own reason', async () => {
    const registry = createStudioEngineRegistry([createStubAudioEngine({ available: false })]);
    const options = await buildModalityRecipeOptions({ registry, label: (id) => id });
    const audio = options.find((option) => option.recipeId === AUDIO_RECIPE?.id);
    expect(audio?.engineAvailable).toBe(false);
    expect(audio?.unavailableReason).toContain('ace-step');
  });

  test('registering an audio engine makes every audio recipe available', async () => {
    const registry = createStudioEngineRegistry([createImageEngine()]);
    registry.register(createStubAudioEngine({ available: true }));
    const options = await buildModalityRecipeOptions({ registry, label: (id) => id });

    const audioRecipes = options.filter((option) => option.modality === 'audio');
    expect(audioRecipes.length).toBeGreaterThan(0);
    expect(audioRecipes.every((option) => option.engineAvailable)).toBe(true);
    expect(audioRecipes.every((option) => option.unavailableReason === undefined)).toBe(true);
  });
});

describe('AC-12: dispatch goes through the modality-neutral runner', () => {
  test('an audio recipe dispatches to the audio engine, not the image one', async () => {
    const generated: string[] = [];
    const registry = createStudioEngineRegistry([
      createImageEngine(),
      createStubAudioEngine({
        available: true,
        onGenerate: (recipeId) => generated.push(recipeId),
      }),
    ]);
    const workflows: string[] = [];
    const runner = createStudioGenerationRunner({
      registry,
      createWorkflow: (adapter): StudioGenerationWorkflow => {
        workflows.push(adapter.modality);
        return {
          generate: async (options) => {
            await adapter.generate(options);
            return outcomeFor(`${options.recipeId}::${adapter.modality}`);
          },
          save: async (options) => ({
            registered: true,
            tag: options.tag,
            sha256: 'a'.repeat(64),
          }),
          discard: () => undefined,
          dispose: () => undefined,
        };
      },
    });

    const audioRecipeId = AUDIO_RECIPE?.id as string;
    const outcome = await runner.generate({ recipeId: audioRecipeId, prompt: 'a tavern theme' });

    expect(workflows).toEqual(['audio']);
    expect(generated).toEqual([audioRecipeId]);
    expect(outcome.tag).toBe(`${audioRecipeId}::audio`);
  });

  test('an image recipe still dispatches to the image engine', async () => {
    const registry = createStudioEngineRegistry([createImageEngine()]);
    const modes: string[] = [];
    const runner = createStudioGenerationRunner({
      registry,
      createWorkflow: (adapter): StudioGenerationWorkflow => {
        modes.push(adapter.modality);
        return {
          generate: async (options) => {
            await adapter.generate(options);
            return outcomeFor(`${options.recipeId}::${adapter.modality}`);
          },
          save: async (options) => ({ registered: true, tag: options.tag, sha256: 'b'.repeat(64) }),
          discard: () => undefined,
          dispose: () => undefined,
        };
      },
    });

    const outcome = await runner.generate({
      recipeId: IMAGE_RECIPE?.id as string,
      prompt: 'a village at dusk',
    });
    expect(modes).toEqual(['image']);
    expect(outcome.tag).toBe(`${IMAGE_RECIPE?.id}::image`);
  });

  test('generating for a modality with no registered engine fails loudly', async () => {
    const registry = createStudioEngineRegistry([createImageEngine()]);
    const runner = createStudioGenerationRunner({
      registry,
      createWorkflow: (adapter): StudioGenerationWorkflow => ({
        generate: async () => outcomeFor(adapter.modality),
        save: async (options) => ({ registered: true, tag: options.tag, sha256: 'c'.repeat(64) }),
        discard: () => undefined,
        dispose: () => undefined,
      }),
    });

    await expect(
      runner.generate({ recipeId: AUDIO_RECIPE?.id as string, prompt: 'x' }),
    ).rejects.toThrow(/No audio generation engine is registered/);
  });

  test('save routes to the workflow that produced the pending bytes', async () => {
    const registry = createStudioEngineRegistry([createStubAudioEngine({ available: true })]);
    const saved: string[] = [];
    const runner = createStudioGenerationRunner({
      registry,
      createWorkflow: (adapter): StudioGenerationWorkflow => ({
        generate: async () => outcomeFor(`tag-${adapter.modality}`),
        save: async (options) => {
          saved.push(options.tag);
          return { registered: true, tag: options.tag, sha256: 'd'.repeat(64) };
        },
        discard: () => undefined,
        dispose: () => undefined,
      }),
    });

    const outcome = await runner.generate({
      recipeId: AUDIO_RECIPE?.id as string,
      prompt: 'x',
    });
    await runner.save({ tag: outcome.tag });
    expect(saved).toEqual(['tag-audio']);
  });
});
