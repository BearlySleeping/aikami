// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/testing/game_over_reactive_fixtures.svelte.ts
//
// Reactive game-over double for the real-Svelte (Vitest Browser Mode) lane.
// `lastCombatOptions` is real `$state`, so a test can mutate it and observe the
// ViewModel's derived `canRetry` update. Overlay calls are recorded.

import type { GameOverlayType } from '$types';
import type {
  GameOverCombatCapabilities,
  GameOverEncounterOptions,
  GameOverOverlayCapabilities,
} from '../game_over_view_model.svelte';

export type ReactiveGameOverHarness = {
  /** The combat capability to inject into the ViewModel. */
  combat: GameOverCombatCapabilities;
  /** The overlay capability to inject into the ViewModel. */
  overlay: GameOverOverlayCapabilities;
  /** Replace the reactive last-combat options. */
  setLastCombatOptions(options: GameOverEncounterOptions | null): void;
  /** Overlays activated during a retry, in order. */
  readonly activations: GameOverlayType[];
  /** Recorded overlay calls. */
  readonly calls: { respawnPlayer: number; loadLastSave: number };
};

/**
 * Creates a game-over double whose `lastCombatOptions` is real Svelte `$state`,
 * plus harness methods to drive and observe it.
 */
export const createReactiveGameOverHarness = (): ReactiveGameOverHarness => {
  let lastCombatOptions = $state<GameOverEncounterOptions | null>(null);

  const activations: GameOverlayType[] = [];
  const calls = { respawnPlayer: 0, loadLastSave: 0 };

  const combat: GameOverCombatCapabilities = {
    get lastCombatOptions() {
      return lastCombatOptions;
    },
    retryEncounter: ({ setActive }) => {
      setActive('COMBAT');
    },
  };

  const overlay: GameOverOverlayCapabilities = {
    respawnPlayer: async () => {
      calls.respawnPlayer += 1;
    },
    loadLastSave: async () => {
      calls.loadLastSave += 1;
    },
    setActive: (overlayType) => {
      activations.push(overlayType);
    },
  };

  return {
    combat,
    overlay,
    setLastCombatOptions: (next) => {
      lastCombatOptions = next;
    },
    activations,
    calls,
  };
};
