// apps/frontend/client/src/lib/views/game/boot/game_boot_composition.ts
//
// Production wiring for the game boot view. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import { gameBootService, routerService } from '$services';
import {
  createGameBootViewModel,
  type GameBootViewModelInterface,
  type GameBootViewModelOptions,
} from './game_boot_view_model.svelte';

/**
 * Builds the game-boot ViewModel wired to the production boot service and
 * router.
 */
export const getGameBootViewModel = (
  options: Omit<GameBootViewModelOptions, 'boot' | 'router'>,
): GameBootViewModelInterface =>
  createGameBootViewModel({
    ...options,
    boot: gameBootService,
    router: routerService,
  });
