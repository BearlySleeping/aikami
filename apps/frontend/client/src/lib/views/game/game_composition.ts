// apps/frontend/client/src/lib/views/game/game_composition.ts
//
// Production wiring for the game composition root. This is the only module in
// the feature that imports the `$services` singletons and the child
// compositions; the ViewModel receives them as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { gameCompositionRoot } from '$services';
import { getGameCanvasViewModel } from './canvas/game_canvas_composition.ts';
import { createGameViewModel, type GameViewModelInterface } from './game_view_model.svelte';
import { getGameUIViewModel } from './ui/game_ui_composition.ts';

/**
 * Builds the game ViewModel wired to the production composition root and child
 * compositions.
 */
export const getGameViewModel = (options: BaseViewModelOptions): GameViewModelInterface =>
  createGameViewModel({
    ...options,
    composition: gameCompositionRoot,
    createCanvasViewModel: getGameCanvasViewModel,
    createUIViewModel: getGameUIViewModel,
  });
