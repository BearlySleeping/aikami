// apps/frontend/client/src/lib/views/lorebook/lorebook_editor_view_model.svelte.ts
//
// ViewModel for the Lorebook Editor view. Manages CRUD for lorebooks
// and entries, keyword chip management, constant toggle, priority,
// drag reorder state, and AI generator output validation.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { lorebookStore } from '$services';
import type { Lorebook, LorebookEntry, LorebookEntryInput } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LorebookEditorViewModelInterface = BaseViewModelInterface & {
  /** All lorebooks from the store. */
  readonly lorebooks: Lorebook[];
  /** Currently selected lorebook, or undefined. */
  readonly selectedLorebook: Lorebook | undefined;
  /** ID of the currently selected lorebook. */
  readonly selectedLorebookId: string | undefined;

  /** Form state for a new/editing lorebook name. */
  readonly lorebookName: string;
  /** Form state for a new/editing lorebook description. */
  readonly lorebookDescription: string;

  /** Form state for entry keyword input (comma-separated). */
  readonly entryKeywordInput: string;
  /** Form state for entry content. */
  readonly entryContent: string;
  /** Form state for entry priority. */
  readonly entryPriority: number;
  /** Form state for entry constant toggle. */
  readonly entryConstant: boolean;
  /** ID of entry being edited, or undefined for new entry. */
  readonly editingEntryId: string | undefined;

  /** Entries from the selected lorebook. */
  readonly entries: LorebookEntry[];

  /** AI generator output entries awaiting user confirmation. */
  readonly generatedEntries: LorebookEntryInput[];
  /** Whether the AI generator is currently loading. */
  readonly isGenerating: boolean;

  /** Selects a lorebook for editing. */
  selectLorebook: (options: { id: string }) => void;
  /** Creates a new lorebook from form state. */
  createLorebook: () => string;
  /** Updates the selected lorebook from form state. */
  updateLorebookName: () => void;
  /** Deletes the selected lorebook. */
  deleteSelectedLorebook: () => void;

  /** Updates the lorebook name form field. */
  setLorebookName: (value: string) => void;
  /** Updates the lorebook description form field. */
  setLorebookDescription: (value: string) => void;

  /** Sets keyword input (comma-separated string). */
  setEntryKeywordInput: (value: string) => void;
  /** Sets entry content text. */
  setEntryContent: (value: string) => void;
  /** Sets entry priority. */
  setEntryPriority: (value: number) => void;
  /** Toggles entry constant state. */
  toggleEntryConstant: () => void;

  /** Starts editing an existing entry (loads into form). */
  startEditingEntry: (options: { entryId: string }) => void;
  /** Cancels entry editing, resets form. */
  cancelEditingEntry: () => void;
  /** Saves the current entry form (creates or updates). */
  saveEntry: () => string | undefined;
  /** Deletes an entry from the selected lorebook. */
  deleteEntry: (options: { entryId: string }) => void;

  /** Reorders entries in the selected lorebook. */
  reorderEntries: (options: { entryIds: string[] }) => void;

  /** Accepts generated entries from the AI generator. */
  acceptGeneratedEntries: (entries: LorebookEntryInput[]) => void;
  /** Clears the generated entries preview. */
  clearGeneratedEntries: () => void;
  /** Sets the generating state. */
  setGenerating: (value: boolean) => void;
};

export type LorebookEditorViewModelOptions = BaseViewModelOptions & {};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class LorebookEditorViewModel
  extends BaseViewModel<LorebookEditorViewModelOptions>
  implements LorebookEditorViewModelInterface
{
  // ── Lorebook state ──────────────────────────────────────────────────────

  selectedLorebookId = $state<string | undefined>();

  lorebookName = $state('');
  lorebookDescription = $state('');

  // ── Entry form state ────────────────────────────────────────────────────

  entryKeywordInput = $state('');
  entryContent = $state('');
  entryPriority = $state(0);
  entryConstant = $state(false);
  editingEntryId = $state<string | undefined>();

  // ── Generator state ─────────────────────────────────────────────────────

  generatedEntries = $state<LorebookEntryInput[]>([]);
  isGenerating = $state(false);

  // ── Derived ─────────────────────────────────────────────────────────────

  get lorebooks(): Lorebook[] {
    return lorebookStore.lorebooks;
  }

  get selectedLorebook(): Lorebook | undefined {
    if (!this.selectedLorebookId) {
      return undefined;
    }
    return this.lorebooks.find((lb) => lb.id === this.selectedLorebookId);
  }

  get entries(): LorebookEntry[] {
    return this.selectedLorebook?.entries ?? [];
  }

  // ── Lorebook actions ────────────────────────────────────────────────────

  selectLorebook(options: { id: string }): void {
    const { id } = options;
    this.selectedLorebookId = id;
    const lb = this.selectedLorebook;
    if (lb) {
      this.lorebookName = lb.name;
      this.lorebookDescription = lb.description;
    }
    this._resetEntryForm();
  }

  createLorebook(): string {
    const name = this.lorebookName.trim();
    if (!name) {
      return '';
    }
    const id = lorebookStore.addLorebook({ name, description: this.lorebookDescription.trim() });
    this.selectedLorebookId = id;
    this._resetEntryForm();
    return id;
  }

  updateLorebookName(): void {
    if (!this.selectedLorebookId) {
      return;
    }
    lorebookStore.updateLorebook({
      id: this.selectedLorebookId,
      patch: {
        name: this.lorebookName.trim(),
        description: this.lorebookDescription.trim(),
      },
    });
  }

  deleteSelectedLorebook(): void {
    if (!this.selectedLorebookId) {
      return;
    }
    lorebookStore.deleteLorebook({ id: this.selectedLorebookId });
    this.selectedLorebookId = undefined;
    this.lorebookName = '';
    this.lorebookDescription = '';
    this._resetEntryForm();
  }

  // ── Form field setters ──────────────────────────────────────────────────

  setLorebookName(value: string): void {
    this.lorebookName = value;
  }

  setLorebookDescription(value: string): void {
    this.lorebookDescription = value;
  }

  setEntryKeywordInput(value: string): void {
    this.entryKeywordInput = value;
  }

  setEntryContent(value: string): void {
    this.entryContent = value;
  }

  setEntryPriority(value: number): void {
    this.entryPriority = value;
  }

  toggleEntryConstant(): void {
    this.entryConstant = !this.entryConstant;
  }

  // ── Entry actions ───────────────────────────────────────────────────────

  startEditingEntry(options: { entryId: string }): void {
    const { entryId } = options;
    const entry = this.entries.find((e) => e.id === entryId);
    if (!entry) {
      return;
    }
    this.editingEntryId = entryId;
    this.entryKeywordInput = entry.keywords.join(', ');
    this.entryContent = entry.content;
    this.entryPriority = entry.priority;
    this.entryConstant = entry.constant;
  }

  cancelEditingEntry(): void {
    this._resetEntryForm();
  }

  saveEntry(): string | undefined {
    if (!this.selectedLorebookId) {
      return undefined;
    }

    const keywords = this._parseKeywords(this.entryKeywordInput);
    if (keywords.length === 0 && !this.entryConstant) {
      this.warn('saveEntry:empty-keywords');
      return undefined;
    }

    const content = this.entryContent.trim();
    if (!content) {
      this.warn('saveEntry:empty-content');
      return undefined;
    }

    if (this.editingEntryId) {
      lorebookStore.updateEntry({
        lorebookId: this.selectedLorebookId,
        entryId: this.editingEntryId,
        patch: {
          keywords,
          content,
          priority: this.entryPriority,
          constant: this.entryConstant,
        },
      });
      this._resetEntryForm();
      return this.editingEntryId;
    }

    const id = lorebookStore.addEntry({
      lorebookId: this.selectedLorebookId,
      entry: {
        keywords,
        content,
        priority: this.entryPriority,
        constant: this.entryConstant,
      },
    });
    this._resetEntryForm();
    return id;
  }

  deleteEntry(options: { entryId: string }): void {
    if (!this.selectedLorebookId) {
      return;
    }
    lorebookStore.deleteEntry({
      lorebookId: this.selectedLorebookId,
      entryId: options.entryId,
    });
  }

  reorderEntries(options: { entryIds: string[] }): void {
    if (!this.selectedLorebookId) {
      return;
    }
    lorebookStore.reorderEntries({
      lorebookId: this.selectedLorebookId,
      entryIds: options.entryIds,
    });
  }

  // ── Generator actions ───────────────────────────────────────────────────

  acceptGeneratedEntries(entries: LorebookEntryInput[]): void {
    if (!this.selectedLorebookId) {
      return;
    }
    for (const entry of entries) {
      lorebookStore.addEntry({
        lorebookId: this.selectedLorebookId,
        entry: {
          keywords: entry.keywords,
          content: entry.content,
          priority: entry.priority ?? 0,
          constant: entry.constant ?? false,
        },
      });
    }
    this.generatedEntries = [];
  }

  clearGeneratedEntries(): void {
    this.generatedEntries = [];
  }

  setGenerating(value: boolean): void {
    this.isGenerating = value;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Resets the entry form to defaults. */
  private _resetEntryForm(): void {
    this.entryKeywordInput = '';
    this.entryContent = '';
    this.entryPriority = 0;
    this.entryConstant = false;
    this.editingEntryId = undefined;
  }

  /** Parses a comma-separated keyword string into an array of trimmed keywords. */
  private _parseKeywords(input: string): string[] {
    return input
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }
}

export const getLorebookEditorViewModel = (
  options: LorebookEditorViewModelOptions,
): LorebookEditorViewModelInterface => LorebookEditorViewModel.create(options);
