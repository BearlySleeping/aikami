// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/testing/pause_menu_reactive_fixtures.svelte.ts
//
// Reactive pause-menu double for the real-Svelte (Vitest Browser Mode) lane.
// Overlay state and dice history are real `$state`, so a test can mutate them
// and observe the ViewModel's getters update through the real runtime.

import type { DiceHistoryEntry } from '$types';
import type {
  PauseMenuDiceCapabilities,
  PauseMenuOverlayCapabilities,
} from '../pause_menu_view_model.svelte';

export type ReactivePauseMenuHarness = {
  /** Overlay capability (reactive). */
  overlay: PauseMenuOverlayCapabilities;
  /** Dice capability (reactive). */
  dice: PauseMenuDiceCapabilities;
  /** Set the reactive saving flag. */
  setSaving(saving: boolean): void;
  /** Set the reactive save message. */
  setSaveMessage(message: string | undefined): void;
  /** Replace the reactive dice history. */
  setHistory(history: DiceHistoryEntry[]): void;
};

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/**
 * Creates a pause-menu double whose overlay state and dice history are real
 * Svelte `$state`, plus harness methods to mutate them.
 */
export const createReactivePauseMenuHarness = (): ReactivePauseMenuHarness => {
  let isSaving = $state(false);
  let saveMessage = $state<string | undefined>(undefined);
  let history = $state<DiceHistoryEntry[]>([]);

  const overlay: PauseMenuOverlayCapabilities = {
    get isSaving() {
      return isSaving;
    },
    get saveMessage() {
      return saveMessage;
    },
    resumeGame: () => unconfigured('resumeGame'),
    saveGame: () => unconfigured('saveGame'),
    goToSettings: () => unconfigured('goToSettings'),
    quitToMainMenu: () => unconfigured('quitToMainMenu'),
    openEndSession: () => unconfigured('openEndSession'),
    replayOnboarding: () => unconfigured('replayOnboarding'),
    openReputation: () => unconfigured('openReputation'),
  };
  const dice: PauseMenuDiceCapabilities = {
    get history() {
      return history;
    },
  };

  return {
    overlay,
    dice,
    setSaving: (next) => {
      isSaving = next;
    },
    setSaveMessage: (next) => {
      saveMessage = next;
    },
    setHistory: (next) => {
      history = next;
    },
  };
};
