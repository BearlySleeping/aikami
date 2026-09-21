// apps/frontend/client/src/lib/views/macros/macros_sandbox_view_model.test.ts
//
// Unit tests for MacrosSandboxViewModel — live macro resolution, context field
// updates, and preset integration. The preset store is an injected capability.

import { describe, expect, mock, test } from 'bun:test';
import type { PromptPreset } from '$types';
import {
  createMacrosSandboxViewModel,
  type MacrosSandboxPresetCapabilities,
} from './macros_sandbox_view_model.svelte';

// The shared preload installs a `window` polyfill without `location`, which
// BaseDevViewModel reads to detect the screenshot harness.
Object.assign(globalThis.window, { location: { search: '' } });

const preset: PromptPreset = {
  id: 'preset-1',
  name: 'Test Preset',
  sections: [],
};

const createPresetStore = (
  overrides: Partial<MacrosSandboxPresetCapabilities> = {},
): MacrosSandboxPresetCapabilities => ({
  presets: [preset],
  loadPresets: mock(() => {}),
  assemblePreset: mock(() => 'assembled: {{user}}'),
  ...overrides,
});

const createViewModel = (presetStore: MacrosSandboxPresetCapabilities = createPresetStore()) =>
  createMacrosSandboxViewModel({ className: 'MacrosSandboxViewModelTest', presetStore });

describe('MacrosSandboxViewModel — resolution', () => {
  test('resolves the template against the current context', () => {
    const viewModel = createViewModel();

    viewModel.updateTemplate('Hello {{user}}');

    expect(viewModel.resolvedOutput).toBe('Hello Alice');
    expect(viewModel.characterCount).toBe('Hello Alice'.length);
  });

  test('returns an empty output for a blank template', () => {
    const viewModel = createViewModel();

    viewModel.updateTemplate('   ');

    expect(viewModel.resolvedOutput).toBe('');
  });

  test('updates known context fields and ignores unknown ones', () => {
    const viewModel = createViewModel();

    viewModel.updateContext({ field: 'userName', value: 'Bob' });
    viewModel.updateContext({ field: 'not-a-field', value: 'nope' });

    expect(viewModel.userName).toBe('Bob');
  });

  test('resetContext restores the defaults', () => {
    const viewModel = createViewModel();
    viewModel.updateContext({ field: 'userName', value: 'Bob' });

    viewModel.resetContext();

    expect(viewModel.userName).toBe('Alice');
  });
});

describe('MacrosSandboxViewModel — presets', () => {
  test('loads presets on initialize', async () => {
    const loadPresets = mock(() => {});
    const viewModel = createViewModel(createPresetStore({ loadPresets }));

    await viewModel.initialize();

    expect(loadPresets).toHaveBeenCalledTimes(1);
    expect(viewModel.presets).toEqual([preset]);
  });

  test('selectPreset assembles the preset into the template', () => {
    const assemblePreset = mock(() => 'assembled template');
    const viewModel = createViewModel(createPresetStore({ assemblePreset }));

    viewModel.selectPreset({ id: 'preset-1' });

    expect(assemblePreset).toHaveBeenCalledWith('preset-1');
    expect(viewModel.presetId).toBe('preset-1');
    expect(viewModel.template).toBe('assembled template');
  });
});
