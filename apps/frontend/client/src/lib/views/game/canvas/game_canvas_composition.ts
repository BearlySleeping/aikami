// apps/frontend/client/src/lib/views/game/canvas/game_canvas_composition.ts
//
// Production wiring for the game canvas. This is the only module in the feature
// that imports the `$services` singletons; the ViewModel receives them as typed
// capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { campaignService, gameBootService, gameEngineService, gameModeService } from '$services';
import {
  createGameCanvasViewModel,
  type GameCanvasViewModelInterface,
} from './game_canvas_view_model.svelte';

/**
 * Builds the game-canvas ViewModel wired to the campaign, boot, engine, and
 * game-mode singletons.
 */
export const getGameCanvasViewModel = (
  options: BaseViewModelOptions,
): GameCanvasViewModelInterface =>
  createGameCanvasViewModel({
    ...options,
    campaign: campaignService,
    boot: gameBootService,
    engine: gameEngineService,
    mode: gameModeService,
  });
