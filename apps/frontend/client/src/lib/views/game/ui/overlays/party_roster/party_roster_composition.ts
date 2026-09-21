// apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_composition.ts
//
// Production wiring for the party roster overlay. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import { gameEngineService, gameOverlayService, partyRosterService } from '$services';
import {
  createPartyRosterViewModel,
  type PartyRosterViewModelInterface,
  type PartyRosterViewModelOptions,
} from './party_roster_view_model.svelte';

/**
 * Builds the party-roster ViewModel wired to the production roster, engine, and
 * overlay singletons.
 */
export const getPartyRosterViewModel = (
  options: Omit<PartyRosterViewModelOptions, 'roster' | 'engine' | 'overlay'>,
): PartyRosterViewModelInterface =>
  createPartyRosterViewModel({
    ...options,
    roster: partyRosterService,
    engine: gameEngineService,
    overlay: gameOverlayService,
  });
