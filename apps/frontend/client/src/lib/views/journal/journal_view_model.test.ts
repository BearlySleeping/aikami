// apps/frontend/client/src/lib/views/journal/journal_view_model.test.ts
//
// Unit tests for the Journal ViewModel — the three-concept split (quests,
// notes, recaps), note CRUD, and overlay navigation. Exercises the ViewModel
// through feature-owned capability fixtures; no shared barrel mock.

import { describe, expect, mock, test } from 'bun:test';
import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine/sim';
import type { PlayerJournalEntry, SessionSummary } from '$types';
import {
  createJournalViewModel,
  type JournalNotesCapabilities,
  type JournalViewModelOptions,
} from './journal_view_model.svelte';

// ── Fixtures ──────────────────────────────────────────────────────────────

const createQuest = (overrides: Partial<QuestData> = {}): QuestData => ({
  id: 'quest-1',
  title: 'The Ashfen Gate',
  description: 'Gain entry to Ashfen.',
  status: 'active',
  objectives: [{ label: 'Reach the gate', current: 1, max: 1, status: 'completed' }],
  ...overrides,
});

const createJournalEntry = (overrides: Partial<QuestJournalEntry> = {}): QuestJournalEntry => ({
  questId: 'quest-old',
  title: 'A Sealed Letter',
  status: 'completed',
  timestamp: 1_700_000_000_000,
  narration: 'The seal was delivered unbroken.',
  objectiveResults: [{ label: 'Deliver it', status: 'completed' }],
  rewards: [],
  worldStateFlags: [],
  ...overrides,
});

const createNote = (overrides: Partial<PlayerJournalEntry> = {}): PlayerJournalEntry => ({
  id: 'note-1',
  campaignId: 'campaign-1',
  sessionNumber: 1,
  title: 'Gatehouse details',
  content: 'Two guards on the wall.',
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const createSummary = (): SessionSummary => ({
  id: 'summary-1',
  createdAt: 1_700_000_000_000,
  playtimeMinutes: 30,
  synopsis: 'The party reached Ashfen.',
  keyEvents: ['Reached the gate'],
  npcInteractions: [{ npcName: 'Mira', context: 'Challenged the party' }],
  resumePoint: 'At the gate.',
});

const createNotes = (initial: PlayerJournalEntry[] = []): JournalNotesCapabilities => {
  let entries = initial;
  return {
    get entries() {
      return entries;
    },
    loadEntries: mock(async () => {}),
    createEntry: mock(async (options) => {
      const entry = createNote({
        id: `note-${entries.length + 1}`,
        campaignId: options.campaignId,
        sessionNumber: options.sessionNumber,
        title: options.title,
        content: options.content,
      });
      entries = [entry, ...entries];
      return entry;
    }),
    updateEntry: mock(async (options) => {
      entries = entries.map((entry) =>
        entry.id === options.id
          ? {
              ...entry,
              title: options.title ?? entry.title,
              content: options.content ?? entry.content,
            }
          : entry,
      );
    }),
    deleteEntry: mock(async (options) => {
      entries = entries.filter((entry) => entry.id !== options.id);
    }),
  };
};

const createOptions = (
  overrides: Partial<JournalViewModelOptions> = {},
): JournalViewModelOptions => {
  const closeJournal = mock(() => {});
  return {
    className: 'JournalViewModelTest',
    questState: {
      quests: [
        createQuest(),
        createQuest({ id: 'quest-2', title: 'A Sealed Letter', status: 'completed' }),
        createQuest({ id: 'quest-3', title: 'The Broken Oath', status: 'failed' }),
      ],
      journalEntries: [createJournalEntry()],
    },
    notes: createNotes(),
    recap: { summary: createSummary() },
    campaign: { campaignId: 'campaign-1', sessionNumber: 2 },
    overlays: { closeJournal },
    ...overrides,
  };
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('JournalViewModel — quests', () => {
  test('splits quests into active, completed, and failed buckets', () => {
    const viewModel = createJournalViewModel(createOptions());

    expect(viewModel.activeQuests.map((quest) => quest.id)).toEqual(['quest-1']);
    expect(viewModel.completedQuests.map((quest) => quest.id)).toEqual(['quest-2']);
    expect(viewModel.failedQuests.map((quest) => quest.id)).toEqual(['quest-3']);
  });

  test('exposes the authoritative quest journal entries', () => {
    const viewModel = createJournalViewModel(createOptions());

    expect(viewModel.questJournalEntries).toHaveLength(1);
    expect(viewModel.questJournalEntries[0]?.title).toBe('A Sealed Letter');
  });
});

describe('JournalViewModel — notes', () => {
  test('canSaveNote requires both a title and content', () => {
    const viewModel = createJournalViewModel(createOptions());

    expect(viewModel.canSaveNote).toBe(false);
    viewModel.setDraftTitle('A theory');
    expect(viewModel.canSaveNote).toBe(false);
    viewModel.setDraftContent('The crest is forged.');
    expect(viewModel.canSaveNote).toBe(true);
  });

  test('creates a new note with the campaign and session context', async () => {
    const notes = createNotes();
    const viewModel = createJournalViewModel(createOptions({ notes }));

    viewModel.startNewNote();
    viewModel.setDraftTitle('A theory');
    viewModel.setDraftContent('The crest is forged.');
    await viewModel.saveNote();

    expect(notes.createEntry).toHaveBeenCalledTimes(1);
    expect(notes.createEntry.mock.calls[0]?.[0]).toMatchObject({
      campaignId: 'campaign-1',
      sessionNumber: 2,
      title: 'A theory',
      content: 'The crest is forged.',
    });
    expect(viewModel.draftTitle).toBe('');
    expect(viewModel.draftContent).toBe('');
    expect(viewModel.notes).toHaveLength(1);
  });

  test('editing a note prefills the draft and saves via updateEntry', async () => {
    const notes = createNotes([createNote()]);
    const viewModel = createJournalViewModel(createOptions({ notes }));

    viewModel.editNote('note-1');
    expect(viewModel.editingId).toBe('note-1');
    expect(viewModel.draftTitle).toBe('Gatehouse details');

    viewModel.setDraftContent('Updated observation.');
    await viewModel.saveNote();

    expect(notes.updateEntry).toHaveBeenCalledTimes(1);
    expect(notes.updateEntry.mock.calls[0]?.[0]).toMatchObject({
      id: 'note-1',
      content: 'Updated observation.',
    });
  });

  test('saving without a campaign surfaces an actionable error', async () => {
    const viewModel = createJournalViewModel(
      createOptions({ campaign: { campaignId: undefined, sessionNumber: 1 } }),
    );

    viewModel.setDraftTitle('A theory');
    viewModel.setDraftContent('The crest is forged.');
    await viewModel.saveNote();

    expect(viewModel.noteError).toContain('No active campaign');
    expect(viewModel.notes).toHaveLength(0);
  });

  test('deleting the note being edited clears the editor', async () => {
    const notes = createNotes([createNote()]);
    const viewModel = createJournalViewModel(createOptions({ notes }));

    viewModel.editNote('note-1');
    await viewModel.deleteNote('note-1');

    expect(notes.deleteEntry).toHaveBeenCalledTimes(1);
    expect(viewModel.editingId).toBeUndefined();
  });

  test('load reads notes for the active campaign', async () => {
    const notes = createNotes();
    const viewModel = createJournalViewModel(createOptions({ notes }));

    await viewModel.load();

    expect(notes.loadEntries).toHaveBeenCalledWith({ campaignId: 'campaign-1' });
  });
});

describe('JournalViewModel — search', () => {
  test('filters notes by title and content, case-insensitively', () => {
    const notes = createNotes([
      createNote({ id: 'note-a', title: 'Gatehouse', content: 'Two guards on the wall.' }),
      createNote({ id: 'note-b', title: 'The crest', content: 'Three towers.' }),
    ]);
    const viewModel = createJournalViewModel(createOptions({ notes }));

    viewModel.setSearchQuery('CREST');

    expect(viewModel.hasSearchQuery).toBe(true);
    expect(viewModel.filteredNotes.map((note) => note.id)).toEqual(['note-b']);
  });

  test('filters quests across title, description, and objectives', () => {
    const viewModel = createJournalViewModel(createOptions());

    viewModel.setSearchQuery('sealed');

    expect(viewModel.filteredActiveQuests).toHaveLength(0);
    expect(viewModel.filteredCompletedQuests.map((quest) => quest.id)).toEqual(['quest-2']);
  });

  test('a blank query returns everything', () => {
    const viewModel = createJournalViewModel(createOptions());

    viewModel.setSearchQuery('   ');

    expect(viewModel.hasSearchQuery).toBe(false);
    expect(viewModel.filteredActiveQuests).toHaveLength(1);
    expect(viewModel.filteredNotes).toHaveLength(0);
  });
});

describe('JournalViewModel — recaps and navigation', () => {
  test('exposes the AI summary read-only with a timestamp label', () => {
    const viewModel = createJournalViewModel(createOptions());

    expect(viewModel.recap?.synopsis).toBe('The party reached Ashfen.');
    expect(viewModel.recapWhenLabel).toBeDefined();
  });

  test('close delegates to the overlay capability', () => {
    const closeJournal = mock(() => {});
    const viewModel = createJournalViewModel(createOptions({ overlays: { closeJournal } }));

    viewModel.close();

    expect(closeJournal).toHaveBeenCalledTimes(1);
  });

  test('Escape closes the overlay', () => {
    const closeJournal = mock(() => {});
    const preventDefault = mock(() => {});
    const stopPropagation = mock(() => {});
    const viewModel = createJournalViewModel(createOptions({ overlays: { closeJournal } }));

    viewModel.handleKeyDown({ key: 'Escape', preventDefault, stopPropagation } as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(closeJournal).toHaveBeenCalledTimes(1);
  });

  test('switches tabs', () => {
    const viewModel = createJournalViewModel(createOptions());

    viewModel.setActiveTab('recaps');
    expect(viewModel.activeTab).toBe('recaps');
  });
});
