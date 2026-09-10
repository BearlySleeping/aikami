// apps/frontend/client/src/lib/views/settings/gameplay/testing/gameplay_fixtures.ts
//
// Feature-owned test doubles for the gameplay settings ViewModel. Operations are
// not defaulted to success: an unconfigured call throws.

import type { GameplayOverlayCapabilities } from '../gameplay_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Overlay capability visible by default with inert toggles. */
export const createGameplayOverlay = (
  overrides: Partial<GameplayOverlayCapabilities> = {},
): GameplayOverlayCapabilities => ({
  visible: true,
  toggleVisible: () => unconfigured('toggleVisible'),
  setVisible: () => unconfigured('setVisible'),
  ...overrides,
});
