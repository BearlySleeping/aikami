// apps/frontend/client/src/lib/views/gm/testing/address_mode_fixtures.ts
//
// Feature-owned test doubles for the address-mode toggle ViewModel. Operations
// are not defaulted to success: an unconfigured call throws.

import type { AddressModePromptCapabilities } from '../address_mode_toggle_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** GM prompt capability whose assembly throws until overridden. */
export const createAddressModePrompt = (
  overrides: Partial<AddressModePromptCapabilities> = {},
): AddressModePromptCapabilities => ({
  assemblePrompt: () => unconfigured('assemblePrompt'),
  ...overrides,
});
