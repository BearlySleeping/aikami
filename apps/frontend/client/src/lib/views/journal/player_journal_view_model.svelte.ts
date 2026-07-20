// apps/frontend/client/src/lib/views/journal/player_journal_view_model.svelte.ts
//
// ViewModel for the Player Journal — CRUD for player-written journal entries.
// Separate from C-339 quest auto-journal.
//
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  dialogService,
} from '@aikami/frontend/services';
import { playerJournalService } from '$services/game/player_journal_service.svelte';
import type { PlayerJournalEntry } from '$types/player_journal_entry';

export type PlayerJournalViewModelInterface = BaseViewModelInterface & {
  /** All journal entries for the current campaign, ordered by createdAt descending. */
  readonly entries: PlayerJournalEntry[];
  /** Whether entries are being loaded. */
  readonly isLoading: boolean;
  /** Whether the journal editor is open. */
  readonly isEditorOpen: boolean;
  /** Whether we are editing an existing entry (vs creating new). */
  readonly isEditingExisting: boolean;
  /** Current editor title value. */
  readonly editorTitle: string;
  /** Current editor content value. */
  readonly editorContent: string;
  /** Current editor tags string (comma-separated). */
  readonly editorTags: string;
  /** Validation error message, or null. */
  readonly validationError: string | null;
  /** Whether a save operation is in progress. */
  readonly isSaving: boolean;

  /** Loads all journal entries for a campaign. */
  loadEntries(options: { campaignId: string }): Promise<void>;

  /** Opens the editor for a new entry. */
  openNewEntry(options: { campaignId: string; sessionNumber: number }): void;

  /** Opens the editor for an existing entry. */
  openEditEntry(entry: PlayerJournalEntry): void;

  /** Closes the editor without saving. */
  closeEditor(): void;

  /** Sets the editor title. */
  setEditorTitle(value: string): void;

  /** Sets the editor content. */
  setEditorContent(value: string): void;

  /** Sets the editor tags. */
  setEditorTags(value: string): void;

  /** Saves the current entry (create or update). */
  saveEntry(): Promise<void>;

  /** Deletes an entry by ID. */
  deleteEntry(options: { id: string }): Promise<void>;
};

export type PlayerJournalViewModelOptions = BaseViewModelOptions & {};

class PlayerJournalViewModel
  extends BaseViewModel<PlayerJournalViewModelOptions>
  implements PlayerJournalViewModelInterface
{
  isLoading = $state(false);
  isEditorOpen = $state(false);
  isEditingExisting = $state(false);
  editorTitle = $state('');
  editorContent = $state('');
  editorTags = $state('');
  validationError = $state<string | null>(null);
  isSaving = $state(false);

  private _editingEntryId: string | null = null;
  private _campaignId: string | null = null;
  private _sessionNumber = 0;

  get entries(): PlayerJournalEntry[] {
    return playerJournalService.entries;
  }

  /** @inheritdoc */
  async loadEntries(options: { campaignId: string }): Promise<void> {
    this.isLoading = true;
    try {
      await playerJournalService.loadEntries({ campaignId: options.campaignId });
      this._campaignId = options.campaignId;
    } finally {
      this.isLoading = false;
    }
  }

  /** @inheritdoc */
  openNewEntry(options: { campaignId: string; sessionNumber: number }): void {
    this._campaignId = options.campaignId;
    this._sessionNumber = options.sessionNumber;
    this._editingEntryId = null;
    this.isEditingExisting = false;
    this.editorTitle = '';
    this.editorContent = '';
    this.editorTags = '';
    this.validationError = null;
    this.isEditorOpen = true;
  }

  /** @inheritdoc */
  openEditEntry(entry: PlayerJournalEntry): void {
    this._editingEntryId = entry.id;
    this.isEditingExisting = true;
    this.editorTitle = entry.title;
    this.editorContent = entry.content;
    this.editorTags = entry.tags.join(', ');
    this.validationError = null;
    this.isEditorOpen = true;
  }

  /** @inheritdoc */
  closeEditor(): void {
    this.isEditorOpen = false;
    this._editingEntryId = null;
    this.editorTitle = '';
    this.editorContent = '';
    this.editorTags = '';
    this.validationError = null;
  }

  /** @inheritdoc */
  setEditorTitle(value: string): void {
    this.editorTitle = value;
    this._clearValidation();
  }

  /** @inheritdoc */
  setEditorContent(value: string): void {
    this.editorContent = value;
    this._clearValidation();
  }

  /** @inheritdoc */
  setEditorTags(value: string): void {
    this.editorTags = value;
    this._clearValidation();
  }

  /** @inheritdoc */
  async saveEntry(): Promise<void> {
    this.validationError = null;

    // Validate
    if (this.editorTitle.trim().length < 1) {
      this.validationError = 'Title is required';
      return;
    }
    if (this.editorContent.trim().length < 1) {
      this.validationError = 'Content is required';
      return;
    }

    if (!this._campaignId) {
      this.validationError = 'No campaign selected';
      return;
    }

    this.isSaving = true;

    try {
      const tags = this.editorTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (this.isEditingExisting && this._editingEntryId) {
        await playerJournalService.updateEntry({
          id: this._editingEntryId,
          title: this.editorTitle,
          content: this.editorContent,
          tags,
        });
      } else {
        await playerJournalService.createEntry({
          campaignId: this._campaignId,
          sessionNumber: this._sessionNumber,
          title: this.editorTitle,
          content: this.editorContent,
          tags,
        });
      }

      this.closeEditor();
      this.debug('saveEntry:complete');
    } catch (error) {
      this.validationError = String(error);
      this.debug('saveEntry:failed', { error: String(error) });
    } finally {
      this.isSaving = false;
    }
  }

  /** @inheritdoc */
  async deleteEntry(options: { id: string }): Promise<void> {
    const confirmed = await dialogService.open({
      type: 'confirm',
      props: {
        title: 'Delete Entry?',
        message: 'This journal entry will be permanently deleted. This action cannot be undone.',
        agreeLabel: 'Delete',
        disagreeLabel: 'Cancel',
      },
    });

    if (confirmed) {
      await playerJournalService.deleteEntry({ id: options.id });
    }
  }

  /** Clears validation error when fields change. */
  private _clearValidation(): void {
    if (this.validationError) {
      this.validationError = null;
    }
  }
}

export const getPlayerJournalViewModel = (
  options: PlayerJournalViewModelOptions,
): PlayerJournalViewModelInterface => PlayerJournalViewModel.create(options);
