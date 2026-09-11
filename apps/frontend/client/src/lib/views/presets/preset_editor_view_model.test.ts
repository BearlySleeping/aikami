// apps/frontend/client/src/lib/views/presets/preset_editor_view_model.test.ts
//
// Unit tests for the prompt preset editor ViewModel built from an injected
// preset-store capability.

import { describe, expect, test } from 'bun:test';
import type { PromptPreset } from '$types';
import {
  createPresetEditorViewModel,
  type PresetEditorPresetCapabilities,
} from './preset_editor_view_model.svelte';

const createStore = (initial: PromptPreset[] = []): PresetEditorPresetCapabilities => {
  let presets = initial;
  return {
    get presets() {
      return presets;
    },
    loadPresets: () => {},
    savePreset: ({ name, sections }) => {
      const id = `preset-${name}`;
      presets = [
        ...presets,
        { id, name, sections, isBuiltIn: false, updatedAt: new Date().toISOString() },
      ];
      return id;
    },
    deletePreset: (id) => {
      presets = presets.filter((preset) => preset.id !== id);
    },
    duplicatePreset: () => undefined,
  };
};

const BUILT_IN: PromptPreset = {
  id: 'builtin',
  name: 'Built-in',
  isBuiltIn: true,
  updatedAt: new Date(0).toISOString(),
  sections: [
    { id: 's1', name: 'One', content: 'a', enabled: true, order: 0 },
    { id: 's2', name: 'Two', content: 'b', enabled: true, order: 1 },
  ],
};

describe('PresetEditorViewModel', () => {
  test('initialize loads presets from the store', async () => {
    const viewModel = createPresetEditorViewModel({
      className: 'PresetEditorViewModelTest',
      presetStore: createStore([BUILT_IN]),
    });

    await viewModel.initialize();

    expect(viewModel.presets).toHaveLength(1);
    expect(viewModel.presets[0].id).toBe('builtin');
  });

  test('selectPreset exposes its sorted sections', () => {
    const viewModel = createPresetEditorViewModel({
      className: 'PresetEditorViewModelTest',
      presetStore: createStore([BUILT_IN]),
    });
    viewModel.presets = [BUILT_IN];

    viewModel.selectPreset({ id: 'builtin' });

    expect(viewModel.isNewPreset).toBe(false);
    expect(viewModel.sections.map((section) => section.id)).toEqual(['s1', 's2']);
  });

  test('createNewPreset + addSection + savePreset persists a new preset', () => {
    const store = createStore([BUILT_IN]);
    const viewModel = createPresetEditorViewModel({
      className: 'PresetEditorViewModelTest',
      presetStore: store,
    });
    viewModel.presets = [BUILT_IN];

    viewModel.createNewPreset();
    expect(viewModel.isNewPreset).toBe(true);

    viewModel.newSectionName = 'Intro';
    viewModel.addSection();
    expect(viewModel.sections.map((section) => section.name)).toEqual(['Intro']);

    viewModel.newPresetName = 'My Preset';
    const id = viewModel.savePreset();

    expect(id).toBe('preset-My Preset');
    expect(viewModel.presets.map((preset) => preset.id)).toContain(id);
    expect(viewModel.isNewPreset).toBe(false);
  });

  test('deletePreset removes the selected preset', () => {
    const viewModel = createPresetEditorViewModel({
      className: 'PresetEditorViewModelTest',
      presetStore: createStore([BUILT_IN]),
    });
    viewModel.presets = [BUILT_IN];
    viewModel.selectPreset({ id: 'builtin' });

    viewModel.deletePreset();

    expect(viewModel.presets).toHaveLength(0);
    expect(viewModel.selectedPresetId).toBeNull();
  });
});
