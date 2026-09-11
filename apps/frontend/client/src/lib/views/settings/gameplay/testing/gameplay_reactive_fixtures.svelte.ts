// apps/frontend/client/src/lib/views/settings/gameplay/testing/gameplay_reactive_fixtures.svelte.ts
//
// Reactive gameplay-settings double for the real-Svelte (Vitest Browser Mode)
// lane. The quest-overlay visibility is real `$state`, so the ViewModel's getter
// updates when it changes.

import type { GameplayOverlayCapabilities } from '../gameplay_view_model.svelte';

export type ReactiveGameplayHarness = {
  /** The overlay capability to inject into the ViewModel. */
  overlay: GameplayOverlayCapabilities;
  /** Set the reactive overlay visibility. */
  setVisible(visible: boolean): void;
};

/**
 * Creates a gameplay double whose overlay visibility is real Svelte `$state`.
 */
export const createReactiveGameplayHarness = (): ReactiveGameplayHarness => {
  let visible = $state(true);

  const overlay: GameplayOverlayCapabilities = {
    get visible() {
      return visible;
    },
    toggleVisible: () => {
      visible = !visible;
    },
    setVisible: (next) => {
      visible = next;
    },
  };

  return {
    overlay,
    setVisible: (next) => {
      visible = next;
    },
  };
};
