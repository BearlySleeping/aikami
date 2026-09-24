// apps/frontend/client/src/lib/views/journal/journal_presentation.svelte.ts
//
// List/detail and editor-disclosure state for the production Journal surface
// (C-551). Quest and note persistence remain owned by JournalViewModel.

import type { PlayerJournalEntry } from '$types';

/** Minimal ViewModel data used to project the selected note. */
export type JournalPresentationSource = {
  readonly notes: readonly PlayerJournalEntry[];
};

/** ViewModel methods used by explicit note-editor actions. */
export type JournalEditorTarget = {
  startNewNote(): void;
  editNote(id: string): void;
};

/** ViewModel methods used by save/cancel/delete disclosure actions. */
export type JournalMutationTarget = {
  readonly canSaveNote: boolean;
  readonly noteError: string | undefined;
  saveNote(): Promise<void>;
  deleteNote(id: string): Promise<void>;
  cancelEdit?(): void;
};

/** Per-wrapper Journal selection and editor state. */
export type JournalPresentationState = {
  readonly selectedNoteId: string | undefined;
  readonly selectedNote: PlayerJournalEntry | undefined;
  readonly isEditorOpen: boolean;
  selectNote(noteId: string): void;
  isSelected(noteId: string): boolean;
  beginNewNote(target: JournalEditorTarget): void;
  beginEdit(noteId: string, target: JournalEditorTarget): void;
  closeEditor(): void;
  cancelEdit(target: { cancelEdit(): void }): void;
  saveNote(target: JournalMutationTarget): Promise<void>;
  deleteNote(noteId: string, target: JournalMutationTarget): Promise<void>;
  noteClass(noteId: string): string;
  formatTimestamp(value: string): string;
};

/** Creates list/detail and on-demand editor state for one Journal View. */
export const createJournalPresentationState = (
  source: JournalPresentationSource,
): JournalPresentationState => {
  const state = $state<{
    selectedNoteId: string | undefined;
    isEditorOpen: boolean;
  }>({ selectedNoteId: undefined, isEditorOpen: false });

  const selectedEntry = (): PlayerJournalEntry | undefined => {
    if (state.isEditorOpen && state.selectedNoteId === undefined) {
      return undefined;
    }
    const selected = source.notes.find((note) => note.id === state.selectedNoteId);
    return selected ?? source.notes[0];
  };

  return {
    get selectedNoteId(): string | undefined {
      return selectedEntry()?.id;
    },
    get selectedNote(): PlayerJournalEntry | undefined {
      return selectedEntry();
    },
    get isEditorOpen(): boolean {
      return state.isEditorOpen;
    },
    selectNote(noteId: string): void {
      if (source.notes.some((note) => note.id === noteId)) {
        state.selectedNoteId = noteId;
        state.isEditorOpen = false;
      }
    },
    isSelected(noteId: string): boolean {
      return selectedEntry()?.id === noteId;
    },
    beginNewNote(target: JournalEditorTarget): void {
      target.startNewNote();
      state.selectedNoteId = undefined;
      state.isEditorOpen = true;
    },
    beginEdit(noteId: string, target: JournalEditorTarget): void {
      if (!source.notes.some((note) => note.id === noteId)) {
        return;
      }
      target.editNote(noteId);
      state.selectedNoteId = noteId;
      state.isEditorOpen = true;
    },
    closeEditor(): void {
      state.isEditorOpen = false;
    },
    cancelEdit(target: { cancelEdit(): void }): void {
      target.cancelEdit();
      state.isEditorOpen = false;
    },
    async saveNote(target: JournalMutationTarget): Promise<void> {
      if (!target.canSaveNote) {
        return;
      }
      await target.saveNote();
      if (target.noteError === undefined) {
        state.isEditorOpen = false;
      }
    },
    async deleteNote(noteId: string, target: JournalMutationTarget): Promise<void> {
      const deletedSelection = state.selectedNoteId === noteId;
      await target.deleteNote(noteId);
      if (deletedSelection) {
        state.selectedNoteId = source.notes.find((note) => note.id !== noteId)?.id;
        state.isEditorOpen = false;
      }
    },
    noteClass(noteId: string): string {
      return selectedEntry()?.id === noteId ? 'game-journal__note--selected' : '';
    },
    formatTimestamp(value: string): string {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    },
  };
};

/** Svelte action that focuses only the standalone Journal dialog. */
export const focusJournalOnMount = (node: HTMLElement, embedded: boolean): { destroy(): void } => {
  if (!embedded) {
    node.focus();
  }
  return { destroy: () => {} };
};
