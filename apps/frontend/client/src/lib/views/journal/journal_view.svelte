<script lang="ts">
// apps/frontend/client/src/lib/views/journal/journal_view.svelte
//
// Journal task surface (C-551): authoritative quests, player notes and
// read-only recaps remain separate. Notes use list/detail and reveal their
// editor only after an explicit create/edit action.

import { BaseViewModelContainer } from '$components';
import { createJournalPresentationState, focusJournalOnMount } from './journal_presentation.svelte';
import type { JournalViewModelInterface } from './journal_view_model.svelte';

type Props = {
  viewModel: JournalViewModelInterface;
  /** Withdraw standalone dialog semantics when hosted by management. */
  embedded?: boolean;
};

const { viewModel, embedded = false }: Props = $props();
const presentation = createJournalPresentationState({
  get notes() {
    return viewModel.notes;
  },
});
</script>

<BaseViewModelContainer {viewModel} class="h-full min-h-0">
  {#snippet children()}
    {#snippet journalBody()}
      <div
        class="game-tabs"
        role="tablist"
        aria-label="Journal sections"
        data-testid="journal-tabs"
      >
        <button
          type="button"
          role="tab"
          class={`game-tab ${viewModel.activeTab === 'quests' ? 'game-tab--selected' : ''}`}
          aria-selected={viewModel.activeTab === 'quests'}
          aria-controls="journal-panel"
          onclick={() => viewModel.setActiveTab('quests')}
        >
          Quests <span class="game-badge game-numeric">{viewModel.activeQuests.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          class={`game-tab ${viewModel.activeTab === 'notes' ? 'game-tab--selected' : ''}`}
          aria-selected={viewModel.activeTab === 'notes'}
          aria-controls="journal-panel"
          onclick={() => viewModel.setActiveTab('notes')}
        >
          Notes <span class="game-badge game-numeric">{viewModel.notes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          class={`game-tab ${viewModel.activeTab === 'recaps' ? 'game-tab--selected' : ''}`}
          aria-selected={viewModel.activeTab === 'recaps'}
          aria-controls="journal-panel"
          onclick={() => viewModel.setActiveTab('recaps')}
        >
          Recaps
        </button>
      </div>

      <label class="game-journal__search block">
        <span class="sr-only">Search journal</span>
        <input
          class="input w-full"
          type="search"
          placeholder="Search quests and notes…"
          data-testid="journal-search"
          value={viewModel.searchQuery}
          oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
        >
      </label>

      <div
        id="journal-panel"
        class="min-h-0 flex-1 overflow-y-auto"
        role="tabpanel"
        data-testid="journal-panel"
      >
        {#if viewModel.activeTab === 'quests'}
          {#if viewModel.activeQuests.length === 0 &&
      viewModel.completedQuests.length === 0 &&
      viewModel.failedQuests.length === 0}
            <div class="game-empty" data-testid="journal-quests-empty">
              <span class="text-4xl" aria-hidden="true">⚔</span>
              <p class="game-section-title">No quests yet</p>
              <p class="game-metadata max-w-md">
                Accepted quests appear here with objectives, progress and authoritative outcomes.
              </p>
            </div>
          {:else if viewModel.hasSearchQuery &&
      viewModel.filteredActiveQuests.length === 0 &&
      viewModel.filteredCompletedQuests.length === 0 &&
      viewModel.filteredFailedQuests.length === 0 &&
      viewModel.filteredQuestJournalEntries.length === 0}
            <div class="game-empty game-empty--inline">
              <p class="game-body-text font-semibold">No matching quests</p>
              <p class="game-metadata">Clear the search to return to the full journal.</p>
            </div>
          {:else}
            <div class="flex flex-col gap-4">
              {#if viewModel.filteredActiveQuests.length > 0}
                <section>
                  <h2 class="game-eyebrow mb-2">Active quests</h2>
                  <div class="grid gap-3 lg:grid-cols-2">
                    {#each viewModel.filteredActiveQuests as quest (quest.id)}
                      <article
                        class="game-surface--raised rounded-lg p-3"
                        data-testid="active-quest"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <h3 class="game-body-text font-semibold">{quest.title}</h3>
                          <span class="game-badge game-badge--accent">Active</span>
                        </div>
                        <p class="game-metadata mt-1">{quest.description}</p>
                        <ul class="mt-3 flex flex-col gap-2">
                          {#each quest.objectives as objective (objective.label)}
                            <li class="game-surface--inset flex items-center gap-2 rounded-md p-2">
                              <span
                                class={`game-numeric ${objective.status === 'completed' ? 'game-numeric--positive' : 'game-numeric--neutral'}`}
                                role="img"
                                aria-label={objective.status === 'completed' ? 'Completed' : 'Open'}
                              >
                                {objective.status === 'completed' ? '✓' : '○'}
                              </span>
                              <span class="game-body-text min-w-0 flex-1 text-sm">
                                {objective.label}
                              </span>
                              <span class="game-numeric game-metadata">
                                {objective.current}/{objective.max}
                              </span>
                            </li>
                          {/each}
                        </ul>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}

              {#if viewModel.filteredCompletedQuests.length > 0}
                <section>
                  <h2 class="game-eyebrow mb-2">Completed</h2>
                  <div class="grid gap-2 lg:grid-cols-2">
                    {#each viewModel.filteredCompletedQuests as quest (quest.id)}
                      <article class="game-journal__quest--completed rounded-lg p-3">
                        <h3 class="game-body-text font-semibold">{quest.title}</h3>
                        <p class="game-metadata mt-1">{quest.description}</p>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}

              {#if viewModel.filteredFailedQuests.length > 0}
                <section>
                  <h2 class="game-eyebrow mb-2">Failed</h2>
                  <div class="grid gap-2 lg:grid-cols-2">
                    {#each viewModel.filteredFailedQuests as quest (quest.id)}
                      <article class="game-journal__quest--failed rounded-lg p-3">
                        <h3 class="game-body-text font-semibold">{quest.title}</h3>
                        <p class="game-metadata mt-1">{quest.description}</p>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}

              {#if viewModel.filteredQuestJournalEntries.length > 0}
                <section>
                  <h2 class="game-eyebrow mb-2">Quest journal</h2>
                  <div class="flex flex-col gap-2">
                    {#each viewModel.filteredQuestJournalEntries as entry (entry.questId)}
                      <article
                        class="game-surface--inset rounded-lg p-3"
                        data-testid="quest-journal-entry"
                      >
                        <div class="flex flex-wrap items-center gap-2">
                          <h3 class="game-body-text font-semibold">{entry.title}</h3>
                          <span class="game-badge">{entry.status}</span>
                        </div>
                        <p class="game-metadata mt-1">{entry.narration}</p>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {/if}
        {:else if viewModel.activeTab === 'notes'}
          <div class="@container min-h-0 w-full">
            <div class="game-journal-layout">
              <section
                class="game-journal__list game-surface--raised"
                data-testid="journal-note-list"
              >
                <header class="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p class="game-eyebrow">Player-authored</p>
                    <h2 class="game-section-title">Your notes</h2>
                  </div>
                  <button
                    type="button"
                    class="btn btn-sm game-control--accent"
                    data-testid="note-new"
                    onclick={() => presentation.beginNewNote(viewModel)}
                  >
                    New note
                  </button>
                </header>

                {#if viewModel.notes.length === 0}
                  <div class="game-empty" data-testid="journal-notes-empty">
                    <span class="text-4xl" aria-hidden="true">✎</span>
                    <p class="game-section-title">No notes yet</p>
                    <p class="game-metadata max-w-sm">
                      Record names, clues and promises. Notes remain separate from authoritative
                      quests.
                    </p>
                  </div>
                {:else if viewModel.hasSearchQuery && viewModel.filteredNotes.length === 0}
                  <div class="game-empty game-empty--inline">
                    <p class="game-body-text font-semibold">No matching notes</p>
                    <p class="game-metadata">Clear the search to return to every note.</p>
                  </div>
                {:else}
                  <ul class="game-journal__notes">
                    {#each viewModel.filteredNotes as note (note.id)}
                      <li>
                        <button
                          type="button"
                          class={`game-journal__note ${presentation.noteClass(note.id)}`}
                          aria-pressed={presentation.isSelected(note.id)}
                          onclick={() => presentation.selectNote(note.id)}
                        >
                          <span class="game-body-text block truncate font-semibold"
                            >{note.title}</span
                          >
                          <span class="game-metadata mt-1 line-clamp-2 block">{note.content}</span>
                          <span class="game-metadata mt-2 block">
                            {presentation.formatTimestamp(note.updatedAt)}
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section
                class="game-journal__detail game-surface--raised"
                data-testid="journal-note-detail"
              >
                {#if presentation.isEditorOpen}
                  <header class="mb-3">
                    <p class="game-eyebrow">Draft</p>
                    <h2 class="game-section-title">
                      {viewModel.editingId ? 'Edit note' : 'New note'}
                    </h2>
                  </header>
                  <label class="block">
                    <span class="game-metadata">Title</span>
                    <input
                      class="input mt-1 w-full"
                      data-testid="note-title"
                      value={viewModel.draftTitle}
                      oninput={(event) => viewModel.setDraftTitle(event.currentTarget.value)}
                    >
                  </label>
                  <label class="mt-3 block">
                    <span class="game-metadata">Note</span>
                    <textarea
                      class="textarea mt-1 w-full"
                      rows="8"
                      data-testid="note-content"
                      value={viewModel.draftContent}
                      oninput={(event) => viewModel.setDraftContent(event.currentTarget.value)}
                    ></textarea>
                  </label>
                  {#if viewModel.noteError}
                    <p class="game-numeric--negative mt-2" role="alert">{viewModel.noteError}</p>
                  {/if}
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="btn game-control--accent"
                      data-testid="note-save"
                      disabled={!viewModel.canSaveNote}
                      onclick={() => void presentation.saveNote(viewModel)}
                    >
                      Save note
                    </button>
                    <button
                      type="button"
                      class="btn game-control--quiet"
                      onclick={() => presentation.cancelEdit(viewModel)}
                    >
                      Cancel
                    </button>
                  </div>
                {:else if presentation.selectedNote}
                  <header class="mb-3">
                    <p class="game-eyebrow">Selected note</p>
                    <h2 class="game-section-title">{presentation.selectedNote.title}</h2>
                    <p class="game-metadata mt-1">
                      Updated {presentation.formatTimestamp(presentation.selectedNote.updatedAt)}
                    </p>
                  </header>
                  <p class="game-narrative whitespace-pre-wrap">
                    {presentation.selectedNote.content}
                  </p>
                  {#if presentation.selectedNote.tags.length > 0}
                    <div class="mt-3 flex flex-wrap gap-1">
                      {#each presentation.selectedNote.tags as tag}
                        <span class="game-badge">{tag}</span>
                      {/each}
                    </div>
                  {/if}
                  <div class="mt-auto flex flex-wrap gap-2 pt-4">
                    <button
                      type="button"
                      class="btn game-control--accent"
                      onclick={() => presentation.beginEdit(presentation.selectedNoteId ?? '', viewModel)}
                    >
                      Edit note
                    </button>
                    <button
                      type="button"
                      class="btn game-control--danger"
                      onclick={() =>
                    void presentation.deleteNote(presentation.selectedNoteId ?? '', viewModel)}
                    >
                      Delete
                    </button>
                  </div>
                {:else}
                  <div class="game-empty">
                    <span class="text-3xl" aria-hidden="true">▤</span>
                    <p class="game-section-title">No note selected</p>
                    <p class="game-metadata max-w-sm">
                      Choose a note to read it here. Create or edit actions open the editor in this
                      panel.
                    </p>
                  </div>
                {/if}
              </section>
            </div>
          </div>
        {:else if viewModel.recap}
          <section class="game-surface--raised rounded-lg p-4" data-testid="journal-recap">
            <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="game-eyebrow">Read-only record</p>
                <h2 class="game-section-title">Session recap</h2>
              </div>
              {#if viewModel.recapWhenLabel}
                <span class="game-metadata">{viewModel.recapWhenLabel}</span>
              {/if}
            </header>
            <p class="game-narrative whitespace-pre-wrap">{viewModel.recap.synopsis}</p>

            {#if viewModel.recap.keyEvents.length > 0}
              <h3 class="game-eyebrow mt-5 mb-2">Key events</h3>
              <ul class="game-detail-list">
                {#each viewModel.recap.keyEvents as keyEvent (keyEvent)}
                  <li>{keyEvent}</li>
                {/each}
              </ul>
            {/if}

            {#if viewModel.recap.npcInteractions.length > 0}
              <h3 class="game-eyebrow mt-5 mb-2">People</h3>
              <div class="flex flex-col gap-2">
                {#each viewModel.recap.npcInteractions as interaction (interaction.npcName)}
                  <div class="game-surface--inset rounded-lg p-3">
                    <p class="game-body-text font-semibold">{interaction.npcName}</p>
                    <p class="game-metadata">{interaction.context}</p>
                  </div>
                {/each}
              </div>
            {/if}
            <p class="game-metadata mt-5">
              Generated at session end. The Journal never rewrites this record.
            </p>
          </section>
        {:else}
          <div class="game-empty" data-testid="journal-recap-empty">
            <span class="text-4xl" aria-hidden="true">☾</span>
            <p class="game-section-title">No session recap yet</p>
            <p class="game-metadata max-w-md">
              A recap becomes available after you end a session. It remains read-only here.
            </p>
          </div>
        {/if}
      </div>
    {/snippet}

    {#if embedded}
      <div
        class="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden p-3"
        data-testid="journal-overlay"
        use:focusJournalOnMount={embedded}
      >
        {@render journalBody()}
      </div>
    {:else}
      <div
        class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Journal"
        tabindex="-1"
        data-testid="journal-overlay"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
        use:focusJournalOnMount={embedded}
      >
        <div
          class="game-surface flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl shadow-2xl"
        >
          <header class="flex items-center gap-3 border-b border-current/15 px-4 py-3">
            <div>
              <p class="game-eyebrow">Campaign record</p>
              <h2 class="game-section-title">Journal</h2>
            </div>
            <button
              type="button"
              class="btn btn-sm game-control--quiet ml-auto"
              data-testid="journal-close"
              onclick={() => viewModel.close()}
            >
              Close
            </button>
          </header>
          <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
            {@render journalBody()}
          </div>
        </div>
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
