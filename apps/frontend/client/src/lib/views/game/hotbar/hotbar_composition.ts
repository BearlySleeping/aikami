// apps/frontend/client/src/lib/views/game/hotbar/hotbar_composition.ts
//
// Production wiring for the HUD hotbar. This is the only module in the feature
// that imports the `$services` singleton; the ViewModel receives it as a typed
// capability.

import { playerStateService } from '$services';
import {
  createHotbarViewModel,
  type HotbarViewModelInterface,
  type HotbarViewModelOptions,
} from './hotbar_view_model.svelte';

/**
 * Builds the hotbar ViewModel wired to the production player-state singleton.
 */
export const getHotbarViewModel = (
  options: Omit<HotbarViewModelOptions, 'playerState'>,
): HotbarViewModelInterface =>
  createHotbarViewModel({ ...options, playerState: playerStateService });
