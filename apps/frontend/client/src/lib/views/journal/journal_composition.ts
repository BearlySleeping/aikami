// apps/frontend/client/src/lib/views/journal/journal_composition.ts
//
// Production wiring for the Journal ViewModel. This is the only module in the
// feature that imports the `$services` singletons; the ViewModel receives them
// as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  campaignService,
  gameOverlayService,
  playerJournalService,
  questStateService,
  sessionService,
  sessionSummaryService,
} from '$services';
import {
  createJournalViewModel,
  type JournalViewModelInterface,
} from './journal_view_model.svelte';

/**
 * Builds the Journal ViewModel wired to the production services. Capability
 * reads use accessors so the ViewModel tracks the services' `$state` rather
 * than a snapshot.
 */
export const getJournalViewModel = (options: BaseViewModelOptions): JournalViewModelInterface =>
  createJournalViewModel({
    ...options,
    questState: {
      get quests() {
        return questStateService.quests;
      },
      get journalEntries() {
        return questStateService.journalEntries;
      },
    },
    notes: {
      get entries() {
        return playerJournalService.entries;
      },
      loadEntries: (loadOptions) => playerJournalService.loadEntries(loadOptions),
      createEntry: (entryOptions) => playerJournalService.createEntry(entryOptions),
      updateEntry: (entryOptions) => playerJournalService.updateEntry(entryOptions),
      deleteEntry: (entryOptions) => playerJournalService.deleteEntry(entryOptions),
    },
    recap: {
      get summary() {
        return sessionSummaryService.currentSummary;
      },
    },
    campaign: {
      get campaignId() {
        return campaignService.activeCampaign?.id;
      },
      get sessionNumber() {
        return sessionService.activeSession?.sessionNumber ?? 1;
      },
    },
    overlays: {
      closeJournal: () => gameOverlayService.closeJournal(),
    },
  });
