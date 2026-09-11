// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/game_over_composition.ts
//
// Production wiring for the game-over overlay. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import { combatService, gameOverlayService } from '$services';
import {
  createGameOverViewModel,
  type GameOverViewModelInterface,
  type GameOverViewModelOptions,
} from './game_over_view_model.svelte';

/**
 * Builds the game-over ViewModel wired to the production combat and overlay
 * singletons.
 */
export const getGameOverViewModel = (
  options: Omit<GameOverViewModelOptions, 'combat' | 'overlay'>,
): GameOverViewModelInterface =>
  createGameOverViewModel({ ...options, combat: combatService, overlay: gameOverlayService });
