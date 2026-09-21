// apps/frontend/client/src/lib/views/macros/macros_sandbox_composition.ts
//
// Production wiring for the Macro sandbox. This is the only module in the
// feature that imports the `$services` preset store; the ViewModel receives it
// as a typed capability.

import { macroPresetStore } from '$services';
import {
  createMacrosSandboxViewModel,
  type MacrosSandboxViewModelInterface,
  type MacrosSandboxViewModelOptions,
} from './macros_sandbox_view_model.svelte';

/**
 * Builds the macros-sandbox ViewModel wired to the production preset store.
 */
export const getMacrosSandboxViewModel = (
  options: Omit<MacrosSandboxViewModelOptions, 'presetStore'>,
): MacrosSandboxViewModelInterface =>
  createMacrosSandboxViewModel({
    ...options,
    presetStore: macroPresetStore,
  });
