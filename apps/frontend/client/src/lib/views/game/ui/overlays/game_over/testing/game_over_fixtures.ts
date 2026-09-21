// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/testing/game_over_fixtures.ts
//
// Feature-owned test doubles for the game-over ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  GameOverCombatCapabilities,
  GameOverEncounterOptions,
  GameOverOverlayCapabilities,
} from '../game_over_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** The canonical retry options used by game-over tests. */
export const GAME_OVER_ENCOUNTER: GameOverEncounterOptions = {
  enemyName: 'Cave Troll',
  enemyHp: 40,
  enemyMaxHp: 40,
  participantIds: [1, 2],
  firstTurnEntityId: 1,
};

/** Combat capability with no last encounter until overridden. */
export const createGameOverCombat = (
  overrides: Partial<GameOverCombatCapabilities> = {},
): GameOverCombatCapabilities => ({
  lastCombatOptions: null,
  retryEncounter: () => unconfigured('retryEncounter'),
  ...overrides,
});

/** Overlay capability where every operation must be configured explicitly. */
export const createGameOverOverlay = (
  overrides: Partial<GameOverOverlayCapabilities> = {},
): GameOverOverlayCapabilities => ({
  respawnPlayer: () => unconfigured('respawnPlayer'),
  loadLastSave: () => unconfigured('loadLastSave'),
  setActive: () => unconfigured('setActive'),
  ...overrides,
});
