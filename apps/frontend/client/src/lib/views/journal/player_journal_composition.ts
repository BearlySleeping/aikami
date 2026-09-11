// apps/frontend/client/src/lib/views/journal/player_journal_composition.ts
//
// Production wiring for the Player Journal feature. This is the only module in
// the feature that imports the `$services` singletons; the ViewModel receives
// them as typed capabilities.

import { dialogService, playerJournalService } from '$services';
import {
  createPlayerJournalViewModel,
  type PlayerJournalViewModelInterface,
  type PlayerJournalViewModelOptions,
} from './player_journal_view_model.svelte';

/**
 * Builds the player-journal ViewModel wired to the production journal store and
 * dialog singletons.
 */
export const getPlayerJournalViewModel = (
  options: Omit<PlayerJournalViewModelOptions, 'journal' | 'dialog'>,
): PlayerJournalViewModelInterface =>
  createPlayerJournalViewModel({
    ...options,
    journal: playerJournalService,
    dialog: dialogService,
  });
