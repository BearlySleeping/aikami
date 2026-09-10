// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_composition.ts
//
// Production wiring for the gameplay settings section. This is the only module
// in the feature that imports the `$services` singleton; the ViewModel receives
// it as a typed capability.

import { questOverlayService } from '$services';
import {
  createGameplayViewModel,
  type GameplayViewModelInterface,
  type GameplayViewModelOptions,
} from './gameplay_view_model.svelte';

/**
 * Builds the gameplay settings ViewModel wired to the production quest-overlay
 * singleton.
 */
export const getGameplayViewModel = (
  options: Omit<GameplayViewModelOptions, 'overlay'>,
): GameplayViewModelInterface =>
  createGameplayViewModel({ ...options, overlay: questOverlayService });
