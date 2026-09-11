// apps/frontend/client/src/lib/views/journal/player_journal_view_model.test.ts
//
// Unit tests for PlayerJournalViewModel — entry loading, editor validation,
// create/update persistence, and delete confirmation. Collaborators are
// injected capabilities, so no global `$services` mock is required.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { PlayerJournalEntry } from '$types';
import {
  createPlayerJournalViewModel,
  type PlayerJournalDialogCapabilities,
  type PlayerJournalStoreCapabilities,
} from './player_journal_view_model.svelte';

const entry = (overrides: Partial<PlayerJournalEntry> = {}): PlayerJournalEntry => ({
  id: 'entry-1',
  campaignId: 'campaign-1',
  sessionNumber: 1,
  title: 'Title',
  content: 'Content',
  tags: [],
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  ...overrides,
});

const createStore = (
  overrides: Partial<PlayerJournalStoreCapabilities> = {},
): PlayerJournalStoreCapabilities => ({
  entries: [],
  loadEntries: mock(async () => {}),
  createEntry: mock(async (options) => entry(options)),
  updateEntry: mock(async () => {}),
  deleteEntry: mock(async () => {}),
  ...overrides,
});

const createDialog = (confirmed = true): PlayerJournalDialogCapabilities => ({
  open: mock(async () => confirmed),
});

const createViewModel = (
  store: PlayerJournalStoreCapabilities = createStore(),
  dialog: PlayerJournalDialogCapabilities = createDialog(),
) =>
  createPlayerJournalViewModel({
    className: 'PlayerJournalViewModelTest',
    campaignId: 'campaign-1',
    journal: store,
    dialog,
  });

describe('PlayerJournalViewModel — loading', () => {
  test('loads entries for the configured campaign on initialize', async () => {
    const loadEntries = mock(async () => {});
    const viewModel = createViewModel(createStore({ loadEntries }));

    await viewModel.initialize();

    expect(loadEntries).toHaveBeenCalledWith({ campaignId: 'campaign-1' });
  });
});

describe('PlayerJournalViewModel — create', () => {
  test('saves a new entry and closes the editor', async () => {
    const createEntry = mock(async (options) => entry(options));
    const viewModel = createViewModel(createStore({ createEntry }));

    viewModel.openNewEntry({ campaignId: 'campaign-1', sessionNumber: 3 });
    viewModel.setEditorTitle('Session 3');
    viewModel.setEditorContent('We survived.');
    viewModel.setEditorTags('combat, loot');
    await viewModel.saveEntry();

    expect(createEntry).toHaveBeenCalledWith({
      campaignId: 'campaign-1',
      sessionNumber: 3,
      title: 'Session 3',
      content: 'We survived.',
      tags: ['combat', 'loot'],
    });
    expect(viewModel.isEditorOpen).toBe(false);
  });

  test('refuses to save without a title or content', async () => {
    const createEntry = mock(async (options) => entry(options));
    const viewModel = createViewModel(createStore({ createEntry }));

    viewModel.openNewEntry({ campaignId: 'campaign-1', sessionNumber: 1 });
    await viewModel.saveEntry();
    expect(viewModel.validationError).toBe('Title is required');

    viewModel.setEditorTitle('Title');
    await viewModel.saveEntry();
    expect(viewModel.validationError).toBe('Content is required');

    expect(createEntry).not.toHaveBeenCalled();
  });

  test('clears validation when a field changes', async () => {
    const viewModel = createViewModel();

    viewModel.openNewEntry({ campaignId: 'campaign-1', sessionNumber: 1 });
    await viewModel.saveEntry();
    expect(viewModel.validationError).not.toBeNull();

    viewModel.setEditorTitle('Title');

    expect(viewModel.validationError).toBeNull();
  });
});

describe('PlayerJournalViewModel — edit and delete', () => {
  test('updates an existing entry', async () => {
    const existing = entry({ id: 'entry-7', title: 'Old', content: 'Old body' });
    const updateEntry = mock(async () => {});
    const viewModel = createViewModel(createStore({ updateEntry }));

    viewModel.openEditEntry(existing);
    expect(viewModel.isEditingExisting).toBe(true);
    expect(viewModel.editorTitle).toBe('Old');

    viewModel.setEditorTitle('New');
    await viewModel.saveEntry();

    expect(updateEntry).toHaveBeenCalledWith({
      id: 'entry-7',
      title: 'New',
      content: 'Old body',
      tags: [],
    });
  });

  test('deletes an entry only after confirmation', async () => {
    const deleteEntry = mock(async () => {});
    const store = createStore({ deleteEntry });
    const confirmed = createViewModel(store, createDialog(true));
    await confirmed.deleteEntry({ id: 'entry-1' });
    expect(deleteEntry).toHaveBeenCalledWith({ id: 'entry-1' });

    const declined = createViewModel(store, createDialog(false));
    await declined.deleteEntry({ id: 'entry-2' });
    expect(deleteEntry).toHaveBeenCalledTimes(1);
  });
});

describe('PlayerJournalViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
