// apps/frontend/client/src/lib/views/game/boot/testing/game_boot_reactive_fixtures.svelte.ts
//
// Reactive game-boot double for the real-Svelte (Vitest Browser Mode) lane.
// `bootProgress` and `isBooting` are real `$state`, so a test can advance the
// boot stages and observe the ViewModel's computed getters update.

import type {
  GameBootCapabilities,
  GameBootProgress,
  GameBootRouterCapabilities,
} from '../game_boot_view_model.svelte';

export type ReactiveGameBootHarness = {
  /** The capability object to inject into the ViewModel. */
  boot: GameBootCapabilities;
  /** Router capability (inert). */
  router: GameBootRouterCapabilities;
  /** Replace the reactive boot progress. */
  setProgress(progress: GameBootProgress): void;
  /** Set the reactive booting flag. */
  setBooting(booting: boolean): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a game-boot double whose progress is real Svelte `$state`, plus
 * harness methods to advance it.
 */
export const createReactiveGameBootHarness = (): ReactiveGameBootHarness => {
  let bootProgress = $state<GameBootProgress>({
    stage: 'starting',
    stageIndex: 0,
    stageCount: 4,
  });
  let isBooting = $state(true);

  const boot: GameBootCapabilities = {
    get bootProgress() {
      return bootProgress;
    },
    get isBooting() {
      return isBooting;
    },
    resetForRetry: () => unconfigured('resetForRetry'),
    teardown: () => unconfigured('teardown'),
  };
  const router: GameBootRouterCapabilities = {
    goToHref: () => unconfigured('goToHref'),
  };

  return {
    boot,
    router,
    setProgress: (next) => {
      bootProgress = next;
    },
    setBooting: (next) => {
      isBooting = next;
    },
  };
};
