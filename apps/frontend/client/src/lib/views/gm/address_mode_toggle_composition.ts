// apps/frontend/client/src/lib/views/gm/address_mode_toggle_composition.ts
//
// Production wiring for the address-mode toggle. This is the only module in the
// feature that imports the `$services` singleton; the ViewModel receives it as a
// typed capability.

import { gmPromptService } from '$services';
import {
  type AddressModeTogggleViewModelInterface,
  type AddressModeTogggleViewModelOptions,
  createAddressModeTogggleViewModel,
} from './address_mode_toggle_view_model.svelte';

/**
 * Builds the address-mode toggle ViewModel wired to the production GM prompt
 * singleton.
 */
export const getAddressModeTogggleViewModel = (
  options: Omit<AddressModeTogggleViewModelOptions, 'prompt'>,
): AddressModeTogggleViewModelInterface =>
  createAddressModeTogggleViewModel({ ...options, prompt: gmPromptService });
