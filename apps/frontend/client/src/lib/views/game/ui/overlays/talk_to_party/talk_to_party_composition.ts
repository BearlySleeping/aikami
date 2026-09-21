// apps/frontend/client/src/lib/views/game/ui/overlays/talk_to_party/talk_to_party_composition.ts
//
// Production wiring for the Talk to Party overlay. This is the only module in
// the feature that imports the `$services` singletons; the ViewModel receives
// them as typed capabilities, so unit tests never touch the global service
// registry.

import { gameOverlayService, partyRosterService } from '$services';
import {
  createTalkToPartyViewModel,
  type TalkToPartyViewModelInterface,
  type TalkToPartyViewModelOptions,
} from './talk_to_party_view_model.svelte';

/**
 * Builds the talk-to-party ViewModel wired to the production party-roster and
 * overlay singletons.
 */
export const getTalkToPartyViewModel = (
  options: Omit<TalkToPartyViewModelOptions, 'partyRoster' | 'overlays'>,
): TalkToPartyViewModelInterface =>
  createTalkToPartyViewModel({
    ...options,
    partyRoster: partyRosterService,
    overlays: gameOverlayService,
  });
