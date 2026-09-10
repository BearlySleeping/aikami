// apps/frontend/client/src/browser_tests/prompt_preview.browser.test.ts
//
// Real-runes coverage for the migrated prompt-preview ViewModel. The Bun suite
// uses plain fixtures; this lane runs the ViewModel in Chromium with the real
// Svelte compiler so the internal `$state` transitions are observed.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createPromptPreviewViewModel } from '../lib/views/presets/prompt_preview_view_model.svelte';
import { createPromptPreviewMacro } from '../lib/views/presets/testing/prompt_preview_fixtures.ts';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('PromptPreviewViewModel — real runes', () => {
  test('openPreview resolves and exposes the prompt, closePreview resets it', () => {
    const viewModel = createPromptPreviewViewModel({
      className: 'PromptPreviewViewModel',
      macro: createPromptPreviewMacro({
        assemblePreset: () => 'Hello {{name}}',
        resolveMacros: ({ template }) => template.replace('{{name}}', 'Aria'),
      }),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.isOpen).toBe(false);

    viewModel.openPreview({ presetId: 'preset-1', context: { characterName: 'Aria' } });
    flushSync();

    expect(viewModel.isOpen).toBe(true);
    expect(viewModel.presetId).toBe('preset-1');
    expect(viewModel.resolvedPrompt).toBe('Hello Aria');
    expect(viewModel.characterCount).toBe('Hello Aria'.length);

    viewModel.closePreview();
    flushSync();

    expect(viewModel.isOpen).toBe(false);
    expect(viewModel.resolvedPrompt).toBe('');
  });
});
