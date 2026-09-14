// apps/frontend/client/src/lib/views/settings/gameplay/testing/gameplay_reactive_fixtures.svelte.ts
//
// Reactive gameplay-settings double for the real-Svelte (Vitest Browser Mode)
// lane. The quest-overlay visibility is real `$state`, so the ViewModel's getter
// updates when it changes.

import type { MotionPreference } from '$types';
import type {
  GameplayMotionCapabilities,
  GameplayOverlayCapabilities,
} from '../gameplay_view_model.svelte';

export type ReactiveGameplayHarness = {
  /** The overlay capability to inject into the ViewModel. */
  overlay: GameplayOverlayCapabilities;
  /** C-527 AC-6: the motion capability to inject into the ViewModel. */
  motion: GameplayMotionCapabilities;
  /** Set the reactive overlay visibility. */
  setVisible(visible: boolean): void;
  /** C-527 AC-6: the value the shared motion capability currently holds. */
  motionPreference(): MotionPreference;
};

/**
 * Creates a gameplay double whose overlay visibility and motion selection are
 * real Svelte `$state`.
 */
export const createReactiveGameplayHarness = (): ReactiveGameplayHarness => {
  let visible = $state(true);
  let preference = $state<MotionPreference>('auto');

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

  const motion: GameplayMotionCapabilities = {
    get preference() {
      return preference;
    },
    setPreference: (next) => {
      preference = next;
    },
  };

  return {
    overlay,
    motion,
    setVisible: (next) => {
      visible = next;
    },
    motionPreference: () => preference,
  };
};
