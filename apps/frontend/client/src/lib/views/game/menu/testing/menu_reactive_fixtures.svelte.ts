// apps/frontend/client/src/lib/views/game/menu/testing/menu_reactive_fixtures.svelte.ts
//
// Reactive menu double for the real-Svelte (Vitest Browser Mode) lane. The
// available-saves list is real `$state`, so a test can populate it and observe
// the ViewModel's `canContinue` / `latestSave` getters update.

import type { SaveSlotInfo } from '$types';
import type { MenuGameSaveCapabilities } from '../menu_view_model.svelte';

export type ReactiveMenuHarness = {
  /** The save-slot capability to inject into the ViewModel. */
  gameSave: MenuGameSaveCapabilities;
  /** Replace the reactive available-saves list. */
  setSaves(saves: SaveSlotInfo[]): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a menu double whose available saves are real Svelte `$state`, plus a
 * harness method to replace them.
 */
export const createReactiveMenuHarness = (): ReactiveMenuHarness => {
  let availableSaves = $state<SaveSlotInfo[]>([]);

  const gameSave: MenuGameSaveCapabilities = {
    get availableSaves() {
      return availableSaves;
    },
    fetchAvailableSaves: () => unconfigured('fetchAvailableSaves'),
  };

  return {
    gameSave,
    setSaves: (next) => {
      availableSaves = next;
    },
  };
};
