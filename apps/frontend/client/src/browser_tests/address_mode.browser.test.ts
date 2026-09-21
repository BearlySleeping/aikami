// apps/frontend/client/src/browser_tests/address_mode.browser.test.ts
//
// Real-runes coverage for the migrated address-mode toggle ViewModel. The Bun
// suite uses plain fixtures; this lane runs the ViewModel in Chromium with the
// real Svelte compiler so mode transitions are observed.

import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createAddressModeTogggleViewModel } from '../lib/views/gm/address_mode_toggle_view_model.svelte';
import { createAddressModePrompt } from '../lib/views/gm/testing/address_mode_fixtures.ts';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe('AddressModeTogggleViewModel — real runes', () => {
  test('setMode updates the exposed label, color, and assembled prompt', () => {
    const viewModel = createAddressModeTogggleViewModel({
      className: 'AddressModeTogggleViewModel',
      prompt: createAddressModePrompt({ assemblePrompt: ({ mode }) => `prompt:${mode}` }),
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.modeLabel).toBe('Scene');
    expect(viewModel.assembledPrompt).toBe('prompt:scene');

    viewModel.setMode('gm');
    flushSync();

    expect(viewModel.currentMode).toBe('gm');
    expect(viewModel.modeLabel).toBe('GM');
    expect(viewModel.modeColorClass).toBe('badge-secondary');
    expect(viewModel.assembledPrompt).toBe('prompt:gm');
  });
});
