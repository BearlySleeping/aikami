// apps/frontend/client/src/lib/views/settings/gameplay/testing/gameplay_fixtures.ts
//
// Feature-owned test doubles for the gameplay settings ViewModel. Operations are
// not defaulted to success: an unconfigured call throws.

import type { MotionPreference } from '$types';
import type {
  GameplayMotionCapabilities,
  GameplayOverlayCapabilities,
} from '../gameplay_view_model.svelte';

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

/**
 * C-527 AC-6: motion capability defaulting to `auto` with an inert setter.
 *
 * `preference` is a getter so an override can track the value a test wrote,
 * which is what makes "the control and the HUD read the same source" provable.
 */
export const createGameplayMotion = (
  overrides: Partial<{ preference: MotionPreference; setPreference: (p: MotionPreference) => void }> = {},
): GameplayMotionCapabilities => {
  const state = { preference: overrides.preference ?? ('auto' as MotionPreference) };
  return {
    get preference() {
      return state.preference;
    },
    setPreference: (preference: MotionPreference) => {
      if (overrides.setPreference) {
        overrides.setPreference(preference);
      }
      state.preference = preference;
    },
  };
};
