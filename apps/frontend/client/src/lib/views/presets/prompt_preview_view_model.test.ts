// apps/frontend/client/src/lib/views/presets/prompt_preview_view_model.test.ts
//
// Unit tests for PromptPreviewViewModel — preset assembly, macro resolution, and
// modal lifecycle. Exercises the ViewModel through feature-owned fixtures — no
// global `$services` barrel mock and no runtime parser import.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createPromptPreviewViewModel } from './prompt_preview_view_model.svelte';
import { createPromptPreviewMacro } from './testing/prompt_preview_fixtures.ts';

const createViewModel = (macro = createPromptPreviewMacro()) =>
  createPromptPreviewViewModel({ className: 'PromptPreviewViewModelTest', macro });

describe('PromptPreviewViewModel — initialize', () => {
  test('loads presets on initialize', async () => {
    const loadPresets = mock(() => {});
    const viewModel = createViewModel(createPromptPreviewMacro({ loadPresets }));

    await viewModel.initialize();

    expect(loadPresets).toHaveBeenCalledTimes(1);
  });
});

describe('PromptPreviewViewModel — openPreview', () => {
  test('assembles and resolves the preset, then opens the modal', () => {
    const resolveMacros = mock(({ template }: { template: string }) =>
      template.replace('{{name}}', 'Aria'),
    );
    const viewModel = createViewModel(
      createPromptPreviewMacro({
        assemblePreset: () => 'Hello {{name}}',
        resolveMacros,
      }),
    );

    viewModel.openPreview({ presetId: 'preset-1', context: { characterName: 'Aria' } });

    expect(resolveMacros).toHaveBeenCalledWith({
      template: 'Hello {{name}}',
      context: { characterName: 'Aria' },
    });
    expect(viewModel.resolvedPrompt).toBe('Hello Aria');
    expect(viewModel.characterCount).toBe('Hello Aria'.length);
    expect(viewModel.presetId).toBe('preset-1');
    expect(viewModel.isOpen).toBe(true);
  });

  test('clears the prompt when the preset cannot be assembled', () => {
    const viewModel = createViewModel(
      createPromptPreviewMacro({ assemblePreset: () => undefined }),
    );

    viewModel.openPreview({ presetId: 'missing', context: {} });

    expect(viewModel.resolvedPrompt).toBe('');
    expect(viewModel.characterCount).toBe(0);
    expect(viewModel.isOpen).toBe(true);
  });
});

describe('PromptPreviewViewModel — refresh and close', () => {
  test('refreshPreview re-resolves with the current context', () => {
    let contextValue = 'first';
    const resolveMacros = mock(() => contextValue);
    const viewModel = createViewModel(
      createPromptPreviewMacro({ assemblePreset: () => 'template', resolveMacros }),
    );

    viewModel.openPreview({ presetId: 'preset-1', context: {} });
    expect(viewModel.resolvedPrompt).toBe('first');

    contextValue = 'second';
    viewModel.refreshPreview();

    expect(viewModel.resolvedPrompt).toBe('second');
    expect(resolveMacros).toHaveBeenCalledTimes(2);
  });

  test('closePreview resets all exposed state', () => {
    const viewModel = createViewModel(
      createPromptPreviewMacro({
        assemblePreset: () => 'template',
        resolveMacros: () => 'resolved',
      }),
    );
    viewModel.openPreview({ presetId: 'preset-1', context: {} });

    viewModel.closePreview();

    expect(viewModel.isOpen).toBe(false);
    expect(viewModel.presetId).toBeNull();
    expect(viewModel.resolvedPrompt).toBe('');
    expect(viewModel.characterCount).toBe(0);
  });
});

describe('PromptPreviewViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
