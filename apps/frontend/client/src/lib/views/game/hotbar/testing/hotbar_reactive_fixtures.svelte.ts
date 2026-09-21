// apps/frontend/client/src/lib/views/game/hotbar/testing/hotbar_reactive_fixtures.svelte.ts
//
// Reactive hotbar double for the real-Svelte (Vitest Browser Mode) lane.
// `hotbarSlots` and `abilityUses` are real `$state`, so a test can mutate them
// and observe the ViewModel's derived `slots` recompute through the runtime.

import type { HotbarPlayerStateCapabilities } from '../hotbar_view_model.svelte';

export type ReactiveHotbarHarness = {
  /** The capability object to inject into the ViewModel. */
  playerState: HotbarPlayerStateCapabilities;
  /** Replace the reactive hotbar slots. */
  setSlots(slots: string[]): void;
  /** Replace the reactive ability-use map. */
  setUses(uses: Record<string, number | undefined>): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a hotbar double whose player state is real Svelte `$state`, plus
 * harness methods to mutate it.
 */
export const createReactiveHotbarHarness = (): ReactiveHotbarHarness => {
  let hotbarSlots = $state<string[]>([]);
  let abilityUses = $state<Record<string, number | undefined>>({});

  const playerState: HotbarPlayerStateCapabilities = {
    get hotbarSlots() {
      return hotbarSlots;
    },
    get abilityUses() {
      return abilityUses;
    },
    useAbility: () => unconfigured('useAbility'),
  };

  return {
    playerState,
    setSlots: (next) => {
      hotbarSlots = next;
    },
    setUses: (next) => {
      abilityUses = next;
    },
  };
};
