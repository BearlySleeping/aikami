// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/testing/pause_menu_fixtures.ts
//
// Feature-owned test doubles for the pause-menu ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type { DiceHistoryEntry } from '$types';
import type {
  PauseMenuDiceCapabilities,
  PauseMenuOverlayCapabilities,
} from '../pause_menu_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Overlay capability with inert state and operations that throw until overridden. */
export const createPauseMenuOverlay = (
  overrides: Partial<PauseMenuOverlayCapabilities> = {},
): PauseMenuOverlayCapabilities => ({
  isSaving: false,
  saveMessage: undefined,
  resumeGame: () => unconfigured('resumeGame'),
  saveGame: () => unconfigured('saveGame'),
  goToSettings: () => unconfigured('goToSettings'),
  quitToMainMenu: () => unconfigured('quitToMainMenu'),
  openEndSession: () => unconfigured('openEndSession'),
  replayOnboarding: () => unconfigured('replayOnboarding'),
  openReputation: () => unconfigured('openReputation'),
  ...overrides,
});

/** Dice capability with an empty history until overridden. */
export const createPauseMenuDice = (
  history: DiceHistoryEntry[] = [],
): PauseMenuDiceCapabilities => ({ history });
