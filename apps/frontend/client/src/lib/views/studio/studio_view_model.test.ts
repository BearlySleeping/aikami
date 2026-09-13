// apps/frontend/client/src/lib/views/studio/studio_view_model.test.ts
//
// C-512: the Creator Studio ViewModel — recipe options and availability,
// generate → review → save, library management, and degraded mode.
//
// Collaborators arrive as injected capabilities, so no global `$services` mock
// is required.

import { describe, expect, mock, test } from 'bun:test';
import type { LibraryEntry, StudioRecipeOption } from '@aikami/types';
import type { GeneratedAssetOutcome, GeneratedAssetSaveOutcome } from '$types';
import {
  createStudioViewModel,
  type StudioCapabilities,
  type StudioMutationOutcome,
} from './studio_view_model.svelte';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const recipeOption = (overrides: Partial<StudioRecipeOption> = {}): StudioRecipeOption => ({
  recipeId: 'prop',
  label: 'Prop',
  category: 'props',
  modality: 'image',
  engineAvailable: true,
  ...overrides,
});

const outcome = (overrides: Partial<GeneratedAssetOutcome> = {}): GeneratedAssetOutcome => ({
  tag: 'props:rusty-iron-gate',
  sha256: 'a'.repeat(64),
  engine: 'sdcpp',
  sizeBytes: 4096,
  ext: '.png',
  mimeType: 'image/png',
  previewUrl: 'blob:preview',
  isDemo: false,
  ...overrides,
});

const libraryEntry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  tag: 'props:rusty-iron-gate',
  category: 'props',
  sha256: 'a'.repeat(64),
  sizeBytes: 4096,
  ext: '.png',
  provenance: { source: 'generated:sdcpp' },
  createdAt: '2026-05-01T12:00:00.000Z',
  localGenerated: true,
  ...overrides,
});

const saveOutcome = (
  overrides: Partial<GeneratedAssetSaveOutcome> = {},
): GeneratedAssetSaveOutcome => ({
  registered: true,
  tag: 'props:rusty-iron-gate',
  sha256: 'a'.repeat(64),
  version: 1,
  unchanged: false,
  ...overrides,
});

const createCapabilities = (overrides: Partial<StudioCapabilities> = {}): StudioCapabilities => ({
  ensureReady: mock(async () => {}),
  listRecipeOptions: mock(async () => [recipeOption()]),
  generate: mock(async () => outcome()),
  save: mock(async () => saveOutcome()),
  cancelGeneration: mock(() => {}),
  listLibrary: mock(async () => []),
  renameGenerated: mock(async (options: { from: string; to: string }) =>
    libraryEntry({ tag: options.to }),
  ),
  deleteGenerated: mock(
    async (): Promise<StudioMutationOutcome> => ({ deleted: true, references: [] }),
  ),
  isGenerationEnabled: mock(() => true),
  ...overrides,
});

const createViewModel = (overrides: Partial<StudioCapabilities> = {}) =>
  createStudioViewModel({
    className: 'StudioViewModel',
    capabilities: createCapabilities(overrides),
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioViewModel — recipes and availability (AC-5)', () => {
  test('selects the first engine-available recipe on initialize', async () => {
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({
          recipeId: 'music',
          label: 'Music Track',
          category: 'music',
          modality: 'audio',
          engineAvailable: false,
        }),
        recipeOption({ recipeId: 'prop' }),
      ]),
    });

    await viewModel.initialize();

    expect(viewModel.recipes).toHaveLength(2);
    expect(viewModel.selectedRecipeId).toBe('prop');
    expect(viewModel.isReady).toBe(true);
  });

  test('disables generation with a reason when no engine is reachable', async () => {
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [recipeOption({ engineAvailable: false })]),
    });

    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');

    expect(viewModel.canGenerate).toBe(false);
    expect(viewModel.generateDisabledReason).toContain('No image engine is reachable');
  });

  test('disables generation when the kill switch is off', async () => {
    const viewModel = createViewModel({ isGenerationEnabled: mock(() => false) });
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');

    expect(viewModel.canGenerate).toBe(false);
    expect(viewModel.generateDisabledReason).toContain('PUBLIC_ASSET_GENERATION');
  });

  test('requires a prompt before generating', async () => {
    const viewModel = createViewModel();
    await viewModel.initialize();

    expect(viewModel.canGenerate).toBe(false);
    expect(viewModel.generateDisabledReason).toContain('Write a prompt');

    viewModel.setPositivePrompt('a lantern');
    expect(viewModel.canGenerate).toBe(true);
  });

  test('an NPC-bound draft requires an NPC id', async () => {
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');

    expect(viewModel.isNpcBound).toBe(true);
    expect(viewModel.canGenerate).toBe(false);
    expect(viewModel.generateDisabledReason).toContain('NPC id');

    viewModel.setNpcId('merchant');
    expect(viewModel.canGenerate).toBe(true);
  });

  test('a generation error surfaces and clears the pending result (AC-5)', async () => {
    const viewModel = createViewModel({
      generate: mock(async () => {
        throw new Error('No image engine available');
      }),
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');

    await viewModel.generate();

    expect(viewModel.generationStatus).toBe('Failed');
    expect(viewModel.errorMessage).toContain('No image engine available');
    expect(viewModel.hasGenerated).toBe(false);
  });
});

describe('StudioViewModel — generate and save (AC-1)', () => {
  test('generate passes the NPC id and review state, save registers the tag', async () => {
    const generate = mock(async () => outcome({ tag: 'portraits:merchant-neutral' }));
    const save = mock(async () => saveOutcome({ tag: 'portraits:merchant-neutral' }));
    const listLibrary = mock(async () => [libraryEntry({ tag: 'portraits:merchant-neutral' })]);

    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate,
      save,
      listLibrary,
    });
    await viewModel.initialize();

    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNpcId('merchant');
    await viewModel.generate();

    expect(generate).toHaveBeenCalledWith({
      recipeId: 'portrait',
      prompt: 'Mara the merchant',
      negativePrompt: undefined,
      npcId: 'merchant',
    });
    expect(viewModel.pendingTag).toBe('portraits:merchant-neutral');
    expect(viewModel.previewUrl).toBe('blob:preview');
    expect(viewModel.generationStatus).toBe('Complete');

    await viewModel.save();

    expect(save).toHaveBeenCalledWith({ tag: 'portraits:merchant-neutral' });
    expect(viewModel.saveMessage).toContain('Saved "portraits:merchant-neutral"');
    expect(viewModel.hasGenerated).toBe(false);
    expect(viewModel.library).toHaveLength(1);
  });

  test('saving without a generated result is refused, not silently ignored', async () => {
    const viewModel = createViewModel();
    await viewModel.initialize();

    await viewModel.save();

    expect(viewModel.errorMessage).toContain('Generate an asset before saving');
  });

  test('a kill-switch no-op is reported as not saved (never a false success)', async () => {
    const viewModel = createViewModel({
      save: mock(async () =>
        saveOutcome({ registered: false, version: undefined, reason: 'generation_disabled' }),
      ),
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');
    await viewModel.generate();

    await viewModel.save();

    expect(viewModel.saveMessage).toContain('Not saved');
    expect(viewModel.saveMessage).toContain('PUBLIC_ASSET_GENERATION');
    expect(viewModel.hasGenerated).toBe(true);
  });

  test('a quota failure surfaces an actionable error and keeps the result (AC-6)', async () => {
    const viewModel = createViewModel({
      save: mock(async () => {
        throw new Error('QuotaExceededError: storage full');
      }),
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');
    await viewModel.generate();

    await viewModel.save();

    expect(viewModel.errorMessage).toContain('storage full');
    expect(viewModel.hasGenerated).toBe(true);
    expect(viewModel.saveMessage).toBe('');
  });

  test('cancel delegates to the engine and resets the status', async () => {
    const cancelGeneration = mock(() => {});
    const viewModel = createViewModel({ cancelGeneration });
    await viewModel.initialize();

    viewModel.cancel();

    expect(cancelGeneration).toHaveBeenCalled();
    expect(viewModel.isGenerating).toBe(false);
  });

  test('a cancelled generation cannot overwrite a newer result when it completes late', async () => {
    let resolveFirst: ((value: GeneratedAssetOutcome) => void) | undefined;
    let generationCount = 0;
    const generate = mock(() => {
      generationCount += 1;
      if (generationCount === 1) {
        return new Promise<GeneratedAssetOutcome>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(outcome({ tag: 'props:newer-result', previewUrl: 'blob:newer' }));
    });
    const viewModel = createViewModel({ generate });
    await viewModel.initialize();
    viewModel.setPositivePrompt('first prompt');

    const firstGeneration = viewModel.generate();
    expect(viewModel.isGenerating).toBe(true);
    viewModel.cancel();

    viewModel.setPositivePrompt('newer prompt');
    await viewModel.generate();
    expect(viewModel.pendingTag).toBe('props:newer-result');

    resolveFirst?.(outcome({ tag: 'props:stale-result', previewUrl: 'blob:stale' }));
    await firstGeneration;

    expect(viewModel.pendingTag).toBe('props:newer-result');
    expect(viewModel.previewUrl).toBe('blob:newer');
    expect(viewModel.generationStatus).toBe('Complete');
  });

  test('ensureReady runs before any recipe or library read (deep-link safety)', async () => {
    const order: string[] = [];
    const viewModel = createViewModel({
      ensureReady: mock(async () => {
        order.push('ensureReady');
      }),
      listRecipeOptions: mock(async () => {
        order.push('listRecipeOptions');
        return [recipeOption()];
      }),
      listLibrary: mock(async () => {
        order.push('listLibrary');
        return [];
      }),
    });

    await viewModel.initialize();

    expect(order).toEqual(['ensureReady', 'listRecipeOptions', 'listLibrary']);
  });

  test('a not_initialized save opens the registry and retries once', async () => {
    const ensureReady = mock(async () => {});
    let attempts = 0;
    const save = mock(async (request: { tag: string }) => {
      attempts += 1;
      if (attempts === 1) {
        return saveOutcome({ registered: false, version: undefined, reason: 'not_initialized' });
      }
      return saveOutcome({ tag: request.tag });
    });

    const viewModel = createViewModel({ ensureReady, save });
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');
    await viewModel.generate();

    await viewModel.save();

    expect(save).toHaveBeenCalledTimes(2);
    expect(ensureReady).toHaveBeenCalledTimes(2);
    expect(viewModel.saveMessage).toContain('Saved "props:rusty-iron-gate"');
    expect(viewModel.hasGenerated).toBe(false);
  });

  test('a generated result survives the save message being rendered', async () => {
    const viewModel = createViewModel();
    await viewModel.initialize();
    viewModel.setPositivePrompt('a lantern');
    await viewModel.generate();
    await viewModel.save();

    // The view renders saveMessage outside the review block, so the message
    // must persist after `generated` is cleared.
    expect(viewModel.saveMessage.length).toBeGreaterThan(0);
    expect(viewModel.hasGenerated).toBe(false);
  });

  test('a successful save does not clear a newer generated result', async () => {
    let resolveSave: ((value: GeneratedAssetSaveOutcome) => void) | undefined;
    let generationCount = 0;
    const generate = mock(async () => {
      generationCount += 1;
      return generationCount === 1
        ? outcome({ tag: 'props:first-result' })
        : outcome({ tag: 'props:newer-result', previewUrl: 'blob:newer' });
    });
    const save = mock(
      () =>
        new Promise<GeneratedAssetSaveOutcome>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const viewModel = createViewModel({ generate, save });
    await viewModel.initialize();
    viewModel.setPositivePrompt('first prompt');
    await viewModel.generate();

    const pendingSave = viewModel.save();
    viewModel.setPositivePrompt('newer prompt');
    await viewModel.generate();
    resolveSave?.(saveOutcome({ tag: 'props:first-result' }));
    await pendingSave;

    expect(viewModel.pendingTag).toBe('props:newer-result');
    expect(viewModel.previewUrl).toBe('blob:newer');
  });

  test('a loaded reference face is passed to generation for an NPC-bound draft', async () => {
    const generate = mock(async () => outcome({ tag: 'portraits:merchant-neutral' }));
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate,
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNpcId('merchant');
    await viewModel.setReferenceImageFile(
      new File([new Uint8Array([1, 2, 3])], 'face.png', { type: 'image/png' }),
    );

    expect(viewModel.hasReferenceImage).toBe(true);
    expect(viewModel.referenceImageName).toBe('face.png');
    expect(viewModel.referenceImagePreviewUrl).toStartWith('data:image/png;base64,');

    await viewModel.generate();

    expect(generate).toHaveBeenCalledWith({
      recipeId: 'portrait',
      prompt: 'Mara the merchant',
      negativePrompt: undefined,
      npcId: 'merchant',
      initImage: expect.stringContaining('data:image/png;base64,'),
    });
  });

  test('clearing a reference image invalidates an unresolved file read', async () => {
    let resolveRead: ((value: ArrayBuffer) => void) | undefined;
    const file = new File([new Uint8Array([1])], 'stale.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        }),
    });
    const viewModel = createViewModel();
    await viewModel.initialize();

    const pendingRead = viewModel.setReferenceImageFile(file);
    viewModel.clearReferenceImage();
    resolveRead?.(new Uint8Array([1, 2, 3]).buffer);
    await pendingRead;

    expect(viewModel.hasReferenceImage).toBe(false);
    expect(viewModel.referenceImageName).toBe('');
  });

  test('library rows expose provenance and a formatted size', async () => {
    const viewModel = createViewModel({
      listLibrary: mock(async () => [libraryEntry({ sizeBytes: 2048 })]),
    });
    await viewModel.initialize();

    expect(viewModel.libraryRows[0]?.provenanceLabel).toBe('generated:sdcpp');
    expect(viewModel.libraryRows[0]?.sizeLabel).toBe('2.0 KB');
  });
});

describe('StudioViewModel — library management (AC-4)', () => {
  test('rename calls the registry seam and refreshes the library', async () => {
    const renameGenerated = mock(async (options: { from: string; to: string }) =>
      libraryEntry({ tag: options.to }),
    );
    // First call (initialize) lists the original tag; the refresh after the
    // rename lists the renamed one.
    let calls = 0;
    const listLibrary = mock(async () => {
      calls += 1;
      return calls === 1 ? [libraryEntry()] : [libraryEntry({ tag: 'props:renamed' })];
    });
    const viewModel = createViewModel({ renameGenerated, listLibrary });
    await viewModel.initialize();

    viewModel.beginRename('props:rusty-iron-gate');
    expect(viewModel.hasRenameTarget).toBe(true);
    viewModel.setRenameValue('props:renamed');
    await viewModel.confirmRename();

    expect(renameGenerated).toHaveBeenCalledWith({
      from: 'props:rusty-iron-gate',
      to: 'props:renamed',
    });
    expect(viewModel.hasRenameTarget).toBe(false);
    expect(viewModel.library[0]?.tag).toBe('props:renamed');
  });

  test('rename to an invalid tag surfaces the registry error', async () => {
    const viewModel = createViewModel({
      renameGenerated: mock(async () => {
        throw new Error('does not match the registry tag grammar');
      }),
      listLibrary: mock(async () => [libraryEntry()]),
    });
    await viewModel.initialize();
    viewModel.beginRename('props:rusty-iron-gate');
    viewModel.setRenameValue('Not A Tag');

    await viewModel.confirmRename();

    expect(viewModel.errorMessage).toContain('tag grammar');
  });

  test('a delete blocked by a save reference keeps the dialog open with the references', async () => {
    const deleteGenerated = mock(
      async (): Promise<StudioMutationOutcome> => ({
        deleted: false,
        reason: 'save_reference',
        references: ['save-1', 'save-2'],
      }),
    );
    const viewModel = createViewModel({
      deleteGenerated,
      listLibrary: mock(async () => [libraryEntry()]),
    });
    await viewModel.initialize();

    viewModel.beginDelete('props:rusty-iron-gate');
    await viewModel.confirmDelete();

    expect(viewModel.hasDeleteTarget).toBe(true);
    expect(viewModel.hasDeleteReferences).toBe(true);
    expect(viewModel.deleteReferenceCount).toBe(2);
  });

  test('a confirmed delete clears the dialog and refreshes the library', async () => {
    const deleteGenerated = mock(
      async (_options: { tag: string; force?: boolean }): Promise<StudioMutationOutcome> => ({
        deleted: true,
        references: [],
      }),
    );
    let calls = 0;
    const listLibrary = mock(async () => {
      calls += 1;
      return calls === 1 ? [libraryEntry()] : [];
    });
    const viewModel = createViewModel({ deleteGenerated, listLibrary });
    await viewModel.initialize();

    viewModel.beginDelete('props:rusty-iron-gate');
    await viewModel.confirmDelete({ force: true });

    expect(deleteGenerated).toHaveBeenCalledWith({
      tag: 'props:rusty-iron-gate',
      force: true,
    });
    expect(viewModel.hasDeleteTarget).toBe(false);
    expect(viewModel.library).toHaveLength(0);
  });

  test('generatePack registers every emotion under its resolver tag (AC-3)', async () => {
    const generate = mock(async (request: { emotion?: string }) =>
      outcome({ tag: `portraits:merchant-${request.emotion ?? 'neutral'}` }),
    );
    const savedTags: string[] = [];
    const save = mock(async (request: { tag: string }) => {
      savedTags.push(request.tag);
      return saveOutcome({ tag: request.tag });
    });

    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate,
      save,
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNpcId('merchant');

    expect(viewModel.packRows.map((row) => row.emotion)).toEqual([
      'neutral',
      'happy',
      'sad',
      'angry',
    ]);
    expect(viewModel.packRows[1]?.tag).toBe('portraits:merchant-happy');

    await viewModel.generatePack();

    expect(savedTags).toEqual([
      'portraits:merchant-neutral',
      'portraits:merchant-happy',
      'portraits:merchant-sad',
      'portraits:merchant-angry',
    ]);
    expect(generate).toHaveBeenCalledTimes(4);
    expect(viewModel.packRows.every((row) => row.status === 'Saved')).toBe(true);
    expect(viewModel.packMessage).toContain('4/4');
    expect(viewModel.isGeneratingPack).toBe(false);
  });

  test('generatePack snapshots every input before the first awaited generation', async () => {
    const requests: Array<Parameters<StudioCapabilities['generate']>[0]> = [];
    let resolveFirst: ((value: GeneratedAssetOutcome) => void) | undefined;
    const generate = mock((request: Parameters<StudioCapabilities['generate']>[0]) => {
      requests.push(request);
      if (requests.length === 1) {
        return new Promise<GeneratedAssetOutcome>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(
        outcome({ tag: `portraits:merchant-${request.emotion ?? 'neutral'}` }),
      );
    });
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate,
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNegativePrompt('blurry');
    viewModel.setNpcId('merchant');
    await viewModel.setReferenceImageFile(
      new File([new Uint8Array([1, 2, 3])], 'face.png', { type: 'image/png' }),
    );
    const referenceImage = viewModel.referenceImagePreviewUrl;

    const pendingPack = viewModel.generatePack();
    viewModel.selectRecipe('changed-recipe');
    viewModel.setPositivePrompt('changed prompt');
    viewModel.setNegativePrompt('changed negative');
    viewModel.setNpcId('changed-npc');
    viewModel.clearReferenceImage();
    resolveFirst?.(outcome({ tag: 'portraits:merchant-neutral' }));
    await pendingPack;

    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.recipeId).toBe('portrait');
      expect(request.prompt).toStartWith('Mara the merchant,');
      expect(request.negativePrompt).toBe('blurry');
      expect(request.npcId).toBe('merchant');
      expect(request.initImage).toBe(referenceImage);
    }
  });

  test('generatePack retries a not_initialized save once after ensuring readiness', async () => {
    const ensureReady = mock(async () => {});
    let saveCount = 0;
    const save = mock(async (request: { tag: string }) => {
      saveCount += 1;
      if (saveCount === 1) {
        return saveOutcome({
          registered: false,
          tag: request.tag,
          version: undefined,
          reason: 'not_initialized',
        });
      }
      return saveOutcome({ tag: request.tag });
    });
    const viewModel = createViewModel({
      ensureReady,
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate: mock(async (request: { emotion?: string }) =>
        outcome({ tag: `portraits:merchant-${request.emotion ?? 'neutral'}` }),
      ),
      save,
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNpcId('merchant');

    await viewModel.generatePack();

    expect(save).toHaveBeenCalledTimes(5);
    expect(ensureReady).toHaveBeenCalledTimes(2);
    expect(viewModel.packRows.every((row) => row.status === 'Saved')).toBe(true);
  });

  test('a pack emotion failure is recorded on its row and does not abort the pack', async () => {
    let attempt = 0;
    const generate = mock(async (request: { emotion?: string }) => {
      attempt += 1;
      if (attempt === 2) {
        throw new Error('engine died');
      }
      return outcome({ tag: `portraits:merchant-${request.emotion ?? 'neutral'}` });
    });

    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
      generate,
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNpcId('merchant');

    await viewModel.generatePack();

    expect(generate).toHaveBeenCalledTimes(4);
    expect(viewModel.packRows[1]?.status).toBe('Failed');
    expect(viewModel.packRows[3]?.status).toBe('Saved');
    expect(viewModel.packMessage).toContain('3/4');
  });

  test('the draft getter produces the shared StudioDraft shape', async () => {
    const viewModel = createViewModel({
      listRecipeOptions: mock(async () => [
        recipeOption({ recipeId: 'portrait', label: 'Character Portrait', category: 'portraits' }),
      ]),
    });
    await viewModel.initialize();
    viewModel.setPositivePrompt('Mara the merchant');
    viewModel.setNegativePrompt('blurry');
    viewModel.setNpcId('merchant');
    await viewModel.generate();

    const draft = viewModel.draft;
    expect(draft.recipeId).toBe('portrait');
    expect(draft.npcId).toBe('merchant');
    expect(draft.positivePrompt).toBe('Mara the merchant');
    expect(draft.negativePrompt).toBe('blurry');
    expect(draft.generated?.tag).toBe('props:rusty-iron-gate');
    expect(draft.generated?.sha256).toHaveLength(64);
    expect(draft.updatedAt.length).toBeGreaterThan(0);
  });

  test('a seed-tag refusal is explained rather than swallowed', async () => {
    const viewModel = createViewModel({
      deleteGenerated: mock(
        async (): Promise<StudioMutationOutcome> => ({
          deleted: false,
          reason: 'seed_tag',
          references: [],
        }),
      ),
      listLibrary: mock(async () => [libraryEntry({ tag: 'sprites:generic-fantasy:hero' })]),
    });
    await viewModel.initialize();

    viewModel.beginDelete('sprites:generic-fantasy:hero');
    await viewModel.confirmDelete();

    expect(viewModel.errorMessage).toContain('catalog');
    expect(viewModel.hasDeleteTarget).toBe(true);
  });
});
