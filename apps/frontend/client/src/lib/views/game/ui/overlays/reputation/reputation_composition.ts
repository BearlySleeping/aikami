// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_composition.ts
//
// Production wiring for the reputation overlay. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import { gameOverlayService, relationshipService } from '$services';
import {
  createReputationViewModel,
  type ReputationViewModelInterface,
  type ReputationViewModelOptions,
} from './reputation_view_model.svelte';

/**
 * Builds the reputation ViewModel wired to the production relationship and
 * overlay singletons.
 */
export const getReputationViewModel = (
  options: Omit<ReputationViewModelOptions, 'relationship' | 'overlay'>,
): ReputationViewModelInterface =>
  createReputationViewModel({
    ...options,
    relationship: relationshipService,
    overlay: gameOverlayService,
  });
