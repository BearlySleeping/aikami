<script lang="ts">
// apps/frontend/client/src/lib/views/journal/journal_view.svelte
//
// Journal overlay — one management surface that keeps quests (authoritative),
// notes (player-authored), and recaps (AI-generated) visually separate.

import { BaseViewModelContainer } from '$components';
import type { JournalViewModelInterface } from './journal_view_model.svelte';

type Props = {
  viewModel: JournalViewModelInterface;
  /**
   * C-527: when embedded in the management host, the host owns the dialog
   * boundary, backdrop, focus containment and close action, so the standalone
   * modal semantics are withdrawn.
   */
  embedded?: boolean;
};

const { viewModel, embedded = false }: Props = $props();

const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  if (!embedded) {
    node.focus();
  }
  return { destroy: () => {} };
};
</script>

<BaseViewModelContainer {viewModel}>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: conditional role — the literal `dialog` role is applied only for the standalone modal presentation; when embedded, the management host owns the boundary -->
  <!-- biome-ignore lint/a11y/useAriaPropsSupportedByRole: conditional role — `aria-modal` applies only to the standalone modal presentation -->
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex {embedded ? '' : 'items-center justify-center bg-black/70 backdrop-blur-sm'}"
    role={embedded ? undefined : 'dialog'}
    aria-modal={embedded ? undefined : 'true'}
    aria-label="Journal"
    tabindex="-1"
    data-testid="journal-overlay"
    onclick={(event: MouseEvent) => {
  if (!embedded) {
    viewModel.handleBackdropClick(event);
  }
}}
    onkeydown={(event: KeyboardEvent) => {
  if (!embedded) {
    viewModel.handleKeyDown(event);
  }
}}
    use:focusOnMount
  >
    <div
      class="flex w-full flex-col overflow-hidden {embedded
  ? 'h-full'
  : 'mx-auto h-[85vh] max-w-4xl rounded-xl border border-base-300 bg-base-200/95 shadow-2xl'}"
    >
      <!-- Header: standalone only — the management host owns the workspace title and Return action. -->
      {#if !embedded}
        <div class="flex items-center gap-2 border-b border-base-300 px-4 py-2">
          <h2 class="game-section-title">Journal</h2>
          <span class="game-metadata">Quests, notes, and recaps</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto text-error"
            data-testid="journal-close"
            onclick={() => viewModel.close()}
          >
            Close
          </button>
        </div>
      {/if}

      <!-- Tabs -->
      <div class="flex gap-1 border-b border-base-300 px-4 py-1.5" data-testid="journal-tabs">
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'quests'}
          class:text-primary-content={viewModel.activeTab === 'quests'}
          class:text-muted-content={viewModel.activeTab !== 'quests'}
          aria-pressed={viewModel.activeTab === 'quests'}
          onclick={() => viewModel.setActiveTab('quests')}
        >
          Quests ({viewModel.activeQuests.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'notes'}
          class:text-primary-content={viewModel.activeTab === 'notes'}
          class:text-muted-content={viewModel.activeTab !== 'notes'}
          aria-pressed={viewModel.activeTab === 'notes'}
          onclick={() => viewModel.setActiveTab('notes')}
        >
          Notes ({viewModel.notes.length})
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'recaps'}
          class:text-primary-content={viewModel.activeTab === 'recaps'}
          class:text-muted-content={viewModel.activeTab !== 'recaps'}
          aria-pressed={viewModel.activeTab === 'recaps'}
          onclick={() => viewModel.setActiveTab('recaps')}
        >
          Recaps
        </button>
      </div>

      <div class="shrink-0 border-b border-base-300 px-4 py-1.5">
        <label class="block">
          <span class="sr-only">Search journal</span>
          <input
            class="input input-bordered input-sm w-full"
            type="search"
            placeholder="Search quests and notes…"
            data-testid="journal-search"
            value={viewModel.searchQuery}
            oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
          >
        </label>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {#if viewModel.activeTab === 'quests'}
          {#if viewModel.activeQuests.length === 0 &&
  viewModel.completedQuests.length === 0 &&
  viewModel.failedQuests.length === 0}
            <div class="game-empty">
              <p class="game-section-title">No quests yet</p>
              <p class="game-metadata max-w-sm">
                Quests you accept while exploring appear here with their objectives and progress.
              </p>
            </div>
          {:else if viewModel.hasSearchQuery &&
  viewModel.filteredActiveQuests.length === 0 &&
  viewModel.filteredCompletedQuests.length === 0 &&
  viewModel.filteredFailedQuests.length === 0 &&
  viewModel.filteredQuestJournalEntries.length === 0}
            <p class="game-metadata">No quests match “{viewModel.searchQuery}”.</p>
          {:else}
            {#if viewModel.filteredActiveQuests.length > 0}
              <section class="mb-4">
                <h3 class="game-eyebrow mb-2">Active</h3>
                <ul class="space-y-3">
                  {#each viewModel.filteredActiveQuests as quest (quest.id)}
                    <li class="rounded-lg border border-base-300 bg-base-100 p-3">
                      <h4 class="game-body-text font-semibold">{quest.title}</h4>
                      <p class="game-metadata">{quest.description}</p>
                      <ul class="mt-2 space-y-1">
                        {#each quest.objectives as objective (objective.label)}
                          <li class="flex items-center gap-2 text-xs">
                            <span
                              class:text-success={objective.status === 'completed'}
                              class:text-muted-content={objective.status !== 'completed'}
                            >
                              {objective.status === 'completed' ? '✓' : '○'}
                            </span>
                            <span class="text-base-content/80">{objective.label}</span>
                            <span class="ml-auto font-mono text-base-content/50">
                              {objective.current}/{objective.max}
                            </span>
                          </li>
                        {/each}
                      </ul>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if viewModel.filteredCompletedQuests.length > 0}
              <section class="mb-4">
                <h3 class="game-eyebrow mb-2">Completed</h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredCompletedQuests as quest (quest.id)}
                    <li class="rounded-lg border border-success/30 bg-success/5 p-3">
                      <h4 class="text-sm font-semibold text-success">{quest.title}</h4>
                      <p class="game-metadata">{quest.description}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if viewModel.filteredFailedQuests.length > 0}
              <section class="mb-4">
                <h3 class="game-eyebrow mb-2">Failed</h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredFailedQuests as quest (quest.id)}
                    <li class="rounded-lg border border-error/30 bg-error/5 p-3">
                      <h4 class="text-sm font-semibold text-error">{quest.title}</h4>
                      <p class="game-metadata">{quest.description}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if viewModel.filteredQuestJournalEntries.length > 0}
              <section>
                <h3 class="game-eyebrow mb-2">Past quests</h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredQuestJournalEntries as entry (entry.questId)}
                    <li data-testid="quest-journal-entry">
                      <p>
                        <span class="game-body-text font-semibold">{entry.title}</span>
                        <span class="ml-2 badge badge-sm">{entry.status}</span>
                      </p>
                      <p class="game-metadata">{entry.narration}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          {/if}
        {:else if viewModel.activeTab === 'notes'}
          <div class="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div class="game-surface--raised flex min-w-0 flex-col rounded-lg p-3">
              <div class="mb-2 flex items-center justify-between gap-2">
                <h3 class="game-eyebrow">Your notes</h3>
                <button
                  type="button"
                  class="btn btn-primary btn-xs"
                  data-testid="note-new"
                  onclick={() => viewModel.startNewNote()}
                >
                  New note
                </button>
              </div>
              {#if viewModel.notes.length === 0}
                <div class="game-empty">
                  <p class="game-section-title">No notes yet</p>
                  <p class="game-metadata max-w-sm">
                    Use “New note” to write your first note for this campaign.
                  </p>
                </div>
              {:else if viewModel.hasSearchQuery && viewModel.filteredNotes.length === 0}
                <p class="game-metadata">No notes match “{viewModel.searchQuery}”.</p>
              {:else}
                <ul class="space-y-2">
                  {#each viewModel.filteredNotes as note (note.id)}
                    <li class="game-surface--inset rounded-lg p-3">
                      <p class="game-body-text font-semibold">{note.title}</p>
                      <p class="game-metadata">{note.content}</p>
                      <p class="mt-1 game-metadata">{note.updatedAt}</p>
                      <div class="mt-2 flex gap-2">
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          onclick={() => viewModel.editNote(note.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-error"
                          onclick={() => void viewModel.deleteNote(note.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <div class="game-surface--raised flex min-w-0 flex-col rounded-lg p-3">
              <h3 class="game-eyebrow">
                {viewModel.editingId ? 'Edit note' : 'New note'}
              </h3>
              <label class="mt-2 block">
                <span class="game-metadata">Title</span>
                <input
                  class="input input-bordered input-sm w-full"
                  data-testid="note-title"
                  value={viewModel.draftTitle}
                  oninput={(event) => viewModel.setDraftTitle(event.currentTarget.value)}
                >
              </label>
              <label class="mt-2 block">
                <span class="game-metadata">Note</span>
                <textarea
                  class="textarea textarea-bordered w-full text-sm"
                  rows="6"
                  data-testid="note-content"
                  value={viewModel.draftContent}
                  oninput={(event) => viewModel.setDraftContent(event.currentTarget.value)}
                ></textarea>
              </label>
              {#if viewModel.noteError}
                <p class="mt-1 text-xs text-error">{viewModel.noteError}</p>
              {/if}
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  data-testid="note-save"
                  disabled={!viewModel.canSaveNote}
                  onclick={() => void viewModel.saveNote()}
                >
                  Save
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={() => viewModel.cancelEdit()}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        {:else if viewModel.recap}
          <section data-testid="journal-recap">
            <div class="mb-2 flex items-center gap-2">
              <h3 class="game-eyebrow">Session recap</h3>
              <span class="text-[10px] text-base-content/40">{viewModel.recapWhenLabel}</span>
            </div>
            <p class="text-sm leading-relaxed text-base-content/85">{viewModel.recap.synopsis}</p>

            {#if viewModel.recap.keyEvents.length > 0}
              <h4 class="mt-3 text-xs uppercase tracking-wide text-base-content/50">Key events</h4>
              <ul class="mt-1 list-disc pl-5 text-sm text-base-content/80">
                {#each viewModel.recap.keyEvents as keyEvent (keyEvent)}
                  <li>{keyEvent}</li>
                {/each}
              </ul>
            {/if}

            {#if viewModel.recap.npcInteractions.length > 0}
              <h4 class="mt-3 text-xs uppercase tracking-wide text-base-content/50">People</h4>
              <ul class="mt-1 space-y-1 text-sm text-base-content/80">
                {#each viewModel.recap.npcInteractions as interaction (interaction.npcName)}
                  <li>
                    <span class="font-semibold text-base-content">{interaction.npcName}</span>
                    — {interaction.context}
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="mt-3 text-[10px] text-base-content/40">
              Generated at session end; the Journal never rewrites this record.
            </p>
          </section>
        {:else}
          <div class="game-empty">
            <p class="game-section-title">No recap yet</p>
            <p class="game-metadata max-w-sm">A session recap is written when you end a session.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
