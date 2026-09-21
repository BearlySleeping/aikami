// apps/frontend/client/src/lib/views/lorebook/lorebook_sandbox_composition.ts
//
// Production wiring for the Lorebook sandbox. This is the only module in the
// feature that imports the `$services` scanner; the ViewModel receives it as a
// typed capability.

import { scanKeywords } from '$services';
import {
  createLorebookSandboxViewModel,
  type LorebookSandboxViewModelInterface,
  type LorebookSandboxViewModelOptions,
} from './lorebook_sandbox_view_model.svelte';

/**
 * Builds the lorebook-sandbox ViewModel wired to the production keyword
 * scanner.
 */
export const getLorebookSandboxViewModel = (
  options: Omit<LorebookSandboxViewModelOptions, 'scanner'>,
): LorebookSandboxViewModelInterface =>
  createLorebookSandboxViewModel({
    ...options,
    scanner: { scanKeywords },
  });
