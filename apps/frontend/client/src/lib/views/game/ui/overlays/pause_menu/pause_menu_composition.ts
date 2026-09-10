// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_composition.ts
//
// Production wiring for the pause menu. This is the only module in the feature
// that imports the `$services` singletons; the ViewModel receives them as typed
// capabilities.

import { diceService, gameOverlayService } from '$services';
import {
  createPauseMenuViewModel,
  type PauseMenuViewModelInterface,
  type PauseMenuViewModelOptions,
} from './pause_menu_view_model.svelte';

/**
 * Builds the pause-menu ViewModel wired to the production overlay and dice
 * singletons.
 */
export const getPauseMenuViewModel = (
  options: Omit<PauseMenuViewModelOptions, 'overlay' | 'dice'>,
): PauseMenuViewModelInterface =>
  createPauseMenuViewModel({
    ...options,
    overlay: gameOverlayService,
    dice: diceService,
  });
