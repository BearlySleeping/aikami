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
