// apps/frontend/client/src/lib/views/journal/journal_presentation.test.ts

import { describe, expect, mock, test } from 'bun:test';
import type { PlayerJournalEntry } from '$types';
import {
  createJournalPresentationState,
  focusJournalOnMount,
  type JournalEditorTarget,
  type JournalMutationTarget,
  type JournalPresentationSource,
} from './journal_presentation.svelte';

const createNote = (overrides: Partial<PlayerJournalEntry> = {}): PlayerJournalEntry => ({
  id: 'note-1',
  campaignId: 'campaign-1',
  sessionNumber: 1,
  title: 'Watch the ward',
  content: 'The eastern lantern flickers after dusk.',
  tags: ['ward'],
  createdAt: '2026-09-24T00:00:00.000Z',
  updatedAt: '2026-09-24T00:00:00.000Z',
  ...overrides,
});

const createSource = (): JournalPresentationSource => ({
  notes: [createNote(), createNote({ id: 'note-2', title: 'Ask the smith' })],
});

const createEditorTarget = (overrides: Partial<JournalEditorTarget> = {}): JournalEditorTarget => ({
  startNewNote: mock(() => {}),
  editNote: mock(() => {}),
  ...overrides,
});

const createMutationTarget = (
  overrides: Partial<JournalMutationTarget> = {},
): JournalMutationTarget => ({
  canSaveNote: true,
  noteError: undefined,
  saveNote: mock(async () => {}),
  deleteNote: mock(async () => {}),
  cancelEdit: mock(() => {}),
  ...overrides,
});

describe('journal presentation state', () => {
  test('selects the first note without opening the editor', () => {
    const state = createJournalPresentationState(createSource());

    expect(state.selectedNoteId).toBe('note-1');
    expect(state.selectedNote?.title).toBe('Watch the ward');
    expect(state.isEditorOpen).toBe(false);
  });

  test('opens the existing ViewModel editor only on explicit edit', () => {
    const editNote = mock(() => {});
    const state = createJournalPresentationState(createSource());

    state.beginEdit('note-2', createEditorTarget({ editNote }));

    expect(editNote).toHaveBeenCalledWith('note-2');
    expect(state.isEditorOpen).toBe(true);
    expect(state.selectedNoteId).toBe('note-2');
  });

  test('opens a blank editor only for the explicit new-note action', () => {
    const startNewNote = mock(() => {});
    const state = createJournalPresentationState(createSource());

    state.beginNewNote(createEditorTarget({ startNewNote }));

    expect(startNewNote).toHaveBeenCalledTimes(1);
    expect(state.isEditorOpen).toBe(true);
    expect(state.selectedNoteId).toBeUndefined();
  });

  test('keeps the editor open when saving fails', async () => {
    const state = createJournalPresentationState(createSource());
    state.beginNewNote(createEditorTarget());
    const target = createMutationTarget({ noteError: 'No active campaign' });

    await state.saveNote(target);

    expect(state.isEditorOpen).toBe(true);
  });

  test('closes a successful editor and clears a deleted selection', async () => {
    const state = createJournalPresentationState(createSource());
    state.beginEdit('note-2', createEditorTarget());
    const deleteNote = mock(async () => {});

    await state.deleteNote('note-2', createMutationTarget({ deleteNote }));

    expect(deleteNote).toHaveBeenCalledWith('note-2');
    expect(state.isEditorOpen).toBe(false);
    expect(state.selectedNoteId).toBe('note-1');
  });

  test('does not show a different note when an edited note is filtered out', () => {
    const notes = [createNote(), createNote({ id: 'note-2', title: 'Ask the smith' })];
    const source: JournalPresentationSource = {
      get notes() {
        return notes;
      },
    };
    const state = createJournalPresentationState(source);
    state.beginEdit('note-2', createEditorTarget());

    notes.splice(0, notes.length, createNote({ id: 'note-3', title: 'A different clue' }));

    expect(state.selectedNoteId).toBeUndefined();
    expect(state.selectedNote).toBeUndefined();
    expect(state.isSelected('note-3')).toBe(false);
  });

  test('has no selected note when the filtered source is empty', () => {
    const notes: PlayerJournalEntry[] = [];
    const source: JournalPresentationSource = {
      get notes() {
        return notes;
      },
    };
    const state = createJournalPresentationState(source);

    expect(state.selectedNoteId).toBeUndefined();
    expect(state.selectedNote).toBeUndefined();
    expect(state.isSelected('note-1')).toBe(false);
  });

  test('keeps the selected note when deletion fails', async () => {
    const state = createJournalPresentationState(createSource());
    state.beginEdit('note-2', createEditorTarget());

    await state.deleteNote(
      'note-2',
      createMutationTarget({
        noteError: 'delete failed',
      }),
    );

    expect(state.isEditorOpen).toBe(true);
    expect(state.selectedNoteId).toBe('note-2');
  });
});

describe('journal focus action', () => {
  test('focuses only the standalone dialog', () => {
    const embeddedNode = { focus: mock(() => {}) };
    const standaloneNode = { focus: mock(() => {}) };

    focusJournalOnMount(embeddedNode, true);
    focusJournalOnMount(standaloneNode, false);

    expect(embeddedNode.focus).not.toHaveBeenCalled();
    expect(standaloneNode.focus).toHaveBeenCalledTimes(1);
  });
});
