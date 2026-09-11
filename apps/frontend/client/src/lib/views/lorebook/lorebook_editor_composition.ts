// apps/frontend/client/src/lib/views/lorebook/lorebook_editor_composition.ts
//
// Production wiring for the Lorebook Editor feature. This is the only module in
// the feature that imports the `$services` singleton; the ViewModel receives it
// as a typed capability.

import { lorebookStore } from '$services';
import {
  createLorebookEditorViewModel,
  type LorebookEditorViewModelInterface,
  type LorebookEditorViewModelOptions,
} from './lorebook_editor_view_model.svelte';

/**
 * Builds the lorebook-editor ViewModel wired to the production lorebook store.
 */
export const getLorebookEditorViewModel = (
  options: Omit<LorebookEditorViewModelOptions, 'store'>,
): LorebookEditorViewModelInterface =>
  createLorebookEditorViewModel({
    ...options,
    store: lorebookStore,
  });
