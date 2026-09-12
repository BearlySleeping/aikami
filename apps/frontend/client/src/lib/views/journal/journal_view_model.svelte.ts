// apps/frontend/client/src/lib/views/journal/journal_view_model.svelte.ts
//
// Journal ViewModel — the management surface that keeps three concepts
// distinct (docs/design/game_ui_hud_overhaul.md):
//
//   1. Quests — authoritative progress owned by the quest-state service.
//   2. Notes — player-authored entries owned by the player-journal service.
//   3. Recaps — the AI-generated session summary, surfaced read-only with its
//      provenance; the Journal never regenerates it or rewrites history.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures. Production wiring lives in
// ./journal_composition.ts.

import type { QuestData, QuestJournalEntry } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { PlayerJournalEntry, SessionSummary } from '$types';

/** The three journal concepts, kept visually separate. */
export type JournalTab = 'quests' | 'notes' | 'recaps';

/** Authoritative quest progress (read-only). */
export type JournalQuestCapabilities = {
  readonly quests: QuestData[];
  readonly journalEntries: readonly QuestJournalEntry[];
};

/** Player-authored notes (read + write). */
export type JournalNotesCapabilities = {
  readonly entries: PlayerJournalEntry[];
  loadEntries(options: { campaignId: string }): Promise<void>;
  createEntry(options: {
    campaignId: string;
    sessionNumber: number;
    title: string;
    content: string;
    tags?: readonly string[];
  }): Promise<PlayerJournalEntry>;
  updateEntry(options: {
    id: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
  }): Promise<void>;
  deleteEntry(options: { id: string }): Promise<void>;
};

/** The AI-generated session recap (read-only). */
export type JournalRecapCapabilities = {
  readonly summary: SessionSummary | null;
};

/** Campaign identity the notes are scoped to. */
export type JournalCampaignCapabilities = {
  readonly campaignId: string | undefined;
  readonly sessionNumber: number;
};

/** Overlay navigation invoked when the Journal closes. */
export type JournalOverlayCapabilities = {
  closeJournal(): void;
};

export type JournalViewModelOptions = BaseViewModelOptions & {
  questState: JournalQuestCapabilities;
  notes: JournalNotesCapabilities;
  recap: JournalRecapCapabilities;
  campaign: JournalCampaignCapabilities;
  overlays: JournalOverlayCapabilities;
};

export type JournalViewModelInterface = BaseViewModelInterface & {
  readonly activeTab: JournalTab;
  setActiveTab(tab: JournalTab): void;

  // Local full-text search (filters the active tab's content)
  readonly searchQuery: string;
  readonly hasSearchQuery: boolean;
  setSearchQuery(query: string): void;

  // Quests
  readonly activeQuests: readonly QuestData[];
  readonly completedQuests: readonly QuestData[];
  readonly failedQuests: readonly QuestData[];
  readonly questJournalEntries: readonly QuestJournalEntry[];
  readonly filteredActiveQuests: readonly QuestData[];
  readonly filteredCompletedQuests: readonly QuestData[];
  readonly filteredFailedQuests: readonly QuestData[];
  readonly filteredQuestJournalEntries: readonly QuestJournalEntry[];

  // Notes
  readonly notes: readonly PlayerJournalEntry[];
  readonly filteredNotes: readonly PlayerJournalEntry[];
  readonly draftTitle: string;
  readonly draftContent: string;
  readonly editingId: string | undefined;
  readonly isSavingNote: boolean;
  readonly noteError: string | undefined;
  readonly canSaveNote: boolean;
  startNewNote(): void;
  editNote(id: string): void;
  setDraftTitle(text: string): void;
  setDraftContent(text: string): void;
  saveNote(): Promise<void>;
  cancelEdit(): void;
  deleteNote(id: string): Promise<void>;

  // Recaps
  readonly recap: SessionSummary | null;
  readonly recapWhenLabel: string | undefined;

  /** Loads notes for the active campaign. */
  load(): Promise<void>;

  close(): void;
  handleBackdropClick(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
};

class JournalViewModel
  extends BaseViewModel<JournalViewModelOptions>
  implements JournalViewModelInterface
{
  private readonly _questState: JournalQuestCapabilities;
  private readonly _notes: JournalNotesCapabilities;
  private readonly _recap: JournalRecapCapabilities;
  private readonly _campaign: JournalCampaignCapabilities;
  private readonly _overlays: JournalOverlayCapabilities;

  activeTab = $state<JournalTab>('quests');
  searchQuery = $state('');
  draftTitle = $state('');
  draftContent = $state('');
  editingId = $state<string | undefined>(undefined);
  isSavingNote = $state(false);
  noteError = $state<string | undefined>(undefined);

  constructor(options: JournalViewModelOptions) {
    super(options);
    this._questState = options.questState;
    this._notes = options.notes;
    this._recap = options.recap;
    this._campaign = options.campaign;
    this._overlays = options.overlays;
  }

  async initialize(): Promise<void> {
    await this.load();
    await super.initialize();
  }

  setActiveTab(tab: JournalTab): void {
    this.activeTab = tab;
  }

  // ── Search ────────────────────────────────────────────────────────

  get hasSearchQuery(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  /** Case-insensitive match across any of the supplied fields. */
  private _matches(values: readonly string[]): boolean {
    const query = this.searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return true;
    }
    return values.some((value) => value.toLowerCase().includes(query));
  }

  // ── Quests ────────────────────────────────────────────────────────

  get activeQuests(): readonly QuestData[] {
    return this._questState.quests.filter((quest) => quest.status === 'active');
  }

  get completedQuests(): readonly QuestData[] {
    return this._questState.quests.filter((quest) => quest.status === 'completed');
  }

  get failedQuests(): readonly QuestData[] {
    return this._questState.quests.filter((quest) => quest.status === 'failed');
  }

  get questJournalEntries(): readonly QuestJournalEntry[] {
    return this._questState.journalEntries;
  }

  get filteredActiveQuests(): readonly QuestData[] {
    return this.activeQuests.filter((quest) =>
      this._matches([quest.title, quest.description, ...quest.objectives.map((o) => o.label)]),
    );
  }

  get filteredCompletedQuests(): readonly QuestData[] {
    return this.completedQuests.filter((quest) =>
      this._matches([quest.title, quest.description, ...quest.objectives.map((o) => o.label)]),
    );
  }

  get filteredFailedQuests(): readonly QuestData[] {
    return this.failedQuests.filter((quest) =>
      this._matches([quest.title, quest.description, ...quest.objectives.map((o) => o.label)]),
    );
  }

  get filteredQuestJournalEntries(): readonly QuestJournalEntry[] {
    return this.questJournalEntries.filter((entry) =>
      this._matches([entry.title, entry.narration]),
    );
  }

  // ── Notes ─────────────────────────────────────────────────────────

  get notes(): readonly PlayerJournalEntry[] {
    return this._notes.entries;
  }

  get filteredNotes(): readonly PlayerJournalEntry[] {
    return this.notes.filter((note) => this._matches([note.title, note.content, ...note.tags]));
  }

  get canSaveNote(): boolean {
    return (
      this.draftTitle.trim().length > 0 && this.draftContent.trim().length > 0 && !this.isSavingNote
    );
  }

  startNewNote(): void {
    this.activeTab = 'notes';
    this.editingId = undefined;
    this.draftTitle = '';
    this.draftContent = '';
    this.noteError = undefined;
  }

  editNote(id: string): void {
    const note = this._notes.entries.find((entry) => entry.id === id);
    if (!note) {
      return;
    }
    this.activeTab = 'notes';
    this.editingId = note.id;
    this.draftTitle = note.title;
    this.draftContent = note.content;
    this.noteError = undefined;
  }

  setDraftTitle(text: string): void {
    this.draftTitle = text;
  }

  setDraftContent(text: string): void {
    this.draftContent = text;
  }

  async saveNote(): Promise<void> {
    if (!this.canSaveNote) {
      return;
    }
    const campaignId = this._campaign.campaignId;
    if (!campaignId) {
      this.noteError = 'No active campaign — notes cannot be saved yet.';
      return;
    }

    this.isSavingNote = true;
    this.noteError = undefined;
    try {
      if (this.editingId) {
        await this._notes.updateEntry({
          id: this.editingId,
          title: this.draftTitle.trim(),
          content: this.draftContent.trim(),
        });
      } else {
        await this._notes.createEntry({
          campaignId,
          sessionNumber: this._campaign.sessionNumber,
          title: this.draftTitle.trim(),
          content: this.draftContent.trim(),
        });
      }
      this.startNewNote();
      this.activeTab = 'notes';
    } catch (error) {
      this.noteError = error instanceof Error ? error.message : String(error);
    } finally {
      this.isSavingNote = false;
    }
  }

  cancelEdit(): void {
    this.startNewNote();
  }

  async deleteNote(id: string): Promise<void> {
    try {
      await this._notes.deleteEntry({ id });
      if (this.editingId === id) {
        this.startNewNote();
      }
    } catch (error) {
      this.noteError = error instanceof Error ? error.message : String(error);
    }
  }

  // ── Recaps ────────────────────────────────────────────────────────

  get recap(): SessionSummary | null {
    return this._recap.summary;
  }

  get recapWhenLabel(): string | undefined {
    const summary = this._recap.summary;
    if (!summary) {
      return undefined;
    }
    return new Date(summary.createdAt).toLocaleString();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async load(): Promise<void> {
    const campaignId = this._campaign.campaignId;
    if (!campaignId) {
      return;
    }
    try {
      await this._notes.loadEntries({ campaignId });
    } catch (error) {
      this.noteError = error instanceof Error ? error.message : String(error);
    }
  }

  close(): void {
    this._overlays.closeJournal();
  }

  /** Closes the Journal when the backdrop itself is clicked. */
  handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }
}

/**
 * Testable factory — builds the Journal ViewModel from typed capabilities with
 * no production imports. Production wiring lives in ./journal_composition.ts.
 */
export const createJournalViewModel = (
  options: JournalViewModelOptions,
): JournalViewModelInterface => JournalViewModel.create(options);
