// apps/frontend/client/src/lib/views/presets/prompt_preview_composition.ts
//
// Production wiring for the prompt preview modal. This is the only module in the
// feature that imports the `$services` singleton and the parser; the ViewModel
// receives them as typed capabilities.

import { resolveMacros } from '@aikami/parser';
import { macroPresetStore } from '$services';
import {
  createPromptPreviewViewModel,
  type PromptPreviewViewModelInterface,
  type PromptPreviewViewModelOptions,
} from './prompt_preview_view_model.svelte';

/**
 * Builds the prompt-preview ViewModel wired to the production macro preset store
 * and parser.
 */
export const getPromptPreviewViewModel = (
  options: Omit<PromptPreviewViewModelOptions, 'macro'>,
): PromptPreviewViewModelInterface =>
  createPromptPreviewViewModel({
    ...options,
    macro: {
      loadPresets: () => macroPresetStore.loadPresets(),
      assemblePreset: (presetId) => macroPresetStore.assemblePreset(presetId),
      resolveMacros: (macroOptions) => resolveMacros(macroOptions),
    },
  });
