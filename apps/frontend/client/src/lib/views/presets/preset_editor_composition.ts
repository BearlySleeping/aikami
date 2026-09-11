// apps/frontend/client/src/lib/views/presets/preset_editor_composition.ts
//
// Production wiring for the preset editor ViewModel. This is the only module in
// the feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { macroPresetStore } from '$services';
import {
  createPresetEditorViewModel,
  type PresetEditorViewModelInterface,
} from './preset_editor_view_model.svelte';

/**
 * Builds the preset editor ViewModel wired to the production macro preset
 * store singleton.
 */
export const getPresetEditorViewModel = (
  options: BaseViewModelOptions,
): PresetEditorViewModelInterface =>
  createPresetEditorViewModel({ ...options, presetStore: macroPresetStore });
