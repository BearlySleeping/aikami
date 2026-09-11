// apps/frontend/client/src/lib/views/dev/image_gen/image_gen_view_model.test.ts
//
// ImageGenViewModel — profile CRUD, compiler, trigger, and gallery delegation.
//
// Constructs the ViewModel through explicit capability fixtures — no `$services`
// barrel mock and no shared test inventory.
//
// Contract: C-242 Image Generation Pipeline

import { describe, expect, mock, test } from 'bun:test';
import type { GalleryImage, ImageStyleProfile } from '@aikami/types';
import {
  type ContextualTriggerCapabilities,
  createImageGenViewModel,
  type GalleryCapabilities,
  type ImageGenPromptCompilerCapabilities,
  type ImageGenStyleProfileCapabilities,
} from './image_gen_view_model.svelte.ts';

const PROFILE: ImageStyleProfile = {
  id: 'style-1',
  name: 'Test Style',
  isBuiltIn: false,
  promptGrammar: 'commaTags',
  positiveTags: 'sharp focus',
  negativeTags: 'blurry',
  perImageTags: {},
};

const GALLERY_IMAGE: GalleryImage = {
  id: 'img-1',
  chatId: 'dev-sandbox',
  url: 'blob:image',
  prompt: 'a dragon',
  imageType: 'background',
  generatedAt: '2026-09-11T00:00:00.000Z',
};

const createHarness = () => {
  const styleProfiles = {
    profiles: [PROFILE],
    activeProfileId: PROFILE.id,
    get activeProfile() {
      return PROFILE;
    },
    setActiveProfile: mock((_id: string) => {}),
    cloneProfile: mock((_id: string) => undefined as ImageStyleProfile | undefined),
    deleteProfile: mock((_id: string) => {}),
    saveProfile: mock((_profile: ImageStyleProfile) => {}),
  } satisfies ImageGenStyleProfileCapabilities;

  const fireTrigger = mock(async () => ({
    positive: 'compiled positive',
    negative: 'compiled negative',
  }));
  const triggers = { enabled: true, fireTrigger } satisfies ContextualTriggerCapabilities;

  const addImage = mock(
    (_options: Parameters<GalleryCapabilities['addImage']>[0]) => GALLERY_IMAGE,
  );
  const removeImage = mock((_id: string) => {});
  const gallery = {
    getImagesForChat: mock((_chatId: string) => [GALLERY_IMAGE]),
    addImage,
    removeImage,
  } satisfies GalleryCapabilities;

  const compileImagePrompt = mock(() => ({ positive: 'pp', negative: 'nn' }));
  const compiler = { compileImagePrompt } satisfies ImageGenPromptCompilerCapabilities;

  const viewModel = createImageGenViewModel({
    className: 'ImageGenViewModel',
    styleProfiles,
    triggers,
    gallery,
    compiler,
  });

  return { viewModel, addImage, removeImage, fireTrigger, compileImagePrompt };
};

describe('ImageGenViewModel — delegation', () => {
  test('profiles and active profile proxy to the style-profile capability', () => {
    const { viewModel } = createHarness();
    expect(viewModel.profiles).toEqual([PROFILE]);
    expect(viewModel.activeProfile).toEqual(PROFILE);
    expect(viewModel.activeProfileId).toBe(PROFILE.id);
  });

  test('runCompiler uses the injected compiler', () => {
    const { viewModel, compileImagePrompt } = createHarness();
    viewModel.runCompiler();
    expect(compileImagePrompt).toHaveBeenCalledTimes(1);
    expect(viewModel.compilerResultPositive).toBe('pp');
    expect(viewModel.compilerResultNegative).toBe('nn');
  });

  test('fireTrigger delegates and surfaces the compiled prompt', async () => {
    const { viewModel, fireTrigger } = createHarness();
    await viewModel.fireTrigger();
    expect(fireTrigger).toHaveBeenCalledTimes(1);
    expect(viewModel.triggerResultPositive).toBe('compiled positive');
    expect(viewModel.triggerResultNegative).toBe('compiled negative');
  });

  test('addMockGalleryImage adds an image for the current chat', () => {
    const { viewModel, addImage } = createHarness();
    viewModel.addMockGalleryImage();
    expect(addImage).toHaveBeenCalledTimes(1);
    expect(addImage.mock.calls[0]?.[0].chatId).toBe('dev-sandbox');
  });

  test('deleteGalleryImage delegates removal', () => {
    const { viewModel, removeImage } = createHarness();
    viewModel.deleteGalleryImage('img-1');
    expect(removeImage).toHaveBeenCalledWith('img-1');
  });
});
