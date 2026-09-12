<script lang="ts">
// apps/frontend/client/src/lib/views/journal/journal_view.svelte
//
// Journal overlay — one management surface that keeps quests (authoritative),
// notes (player-authored), and recaps (AI-generated) visually separate.

import { BaseViewModelContainer } from '$components';
import type { JournalViewModelInterface } from './journal_view_model.svelte';

type Props = {
  viewModel: JournalViewModelInterface;
};

const { viewModel }: Props = $props();

const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  node.focus();
  return { destroy: () => {} };
};
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Journal"
    tabindex="-1"
    data-testid="journal-overlay"
    onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
    use:focusOnMount
  >
    <div
      class="mx-auto flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-base-300 bg-base-200/95 shadow-2xl"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 border-b border-base-300 px-4 py-2">
        <h2 class="text-sm font-bold text-primary">Journal</h2>
        <span class="text-xs text-base-content/50">Quests, notes, and recaps</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs ml-auto text-error"
          data-testid="journal-close"
          onclick={() => viewModel.close()}
        >
          Close
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex gap-1 border-b border-base-300 px-4 py-1.5" data-testid="journal-tabs">
        <button
          type="button"
          class="rounded-md px-3 py-1 text-sm"
          class:bg-primary={viewModel.activeTab === 'quests'}
          class:text-primary-content={viewModel.activeTab === 'quests'}
          class:text-muted={viewModel.activeTab !== 'quests'}
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
          class:text-muted={viewModel.activeTab !== 'notes'}
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
          class:text-muted={viewModel.activeTab !== 'recaps'}
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

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        {#if viewModel.activeTab === 'quests'}
          {#if viewModel.activeQuests.length === 0 && viewModel.completedQuests.length === 0 && viewModel.failedQuests.length === 0}
            <p class="text-sm text-base-content/50">No quests yet.</p>
          {:else if viewModel.hasSearchQuery && viewModel.filteredActiveQuests.length === 0 && viewModel.filteredCompletedQuests.length === 0 && viewModel.filteredFailedQuests.length === 0 && viewModel.filteredQuestJournalEntries.length === 0}
            <p class="text-sm text-base-content/50">No quests match “{viewModel.searchQuery}”.</p>
          {:else}
            {#if viewModel.filteredActiveQuests.length > 0}
              <section class="mb-4">
                <h3 class="mb-2 text-xs uppercase tracking-wide text-base-content/50">Active</h3>
                <ul class="space-y-3">
                  {#each viewModel.filteredActiveQuests as quest (quest.id)}
                    <li class="rounded-lg border border-base-300 bg-base-100 p-3">
                      <h4 class="text-sm font-semibold text-base-content">{quest.title}</h4>
                      <p class="text-xs text-base-content/60">{quest.description}</p>
                      <ul class="mt-2 space-y-1">
                        {#each quest.objectives as objective (objective.label)}
                          <li class="flex items-center gap-2 text-xs">
                            <span
                              class:text-success={objective.status === 'completed'}
                              class:text-muted={objective.status !== 'completed'}
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
                <h3 class="mb-2 text-xs uppercase tracking-wide text-base-content/50">Completed</h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredCompletedQuests as quest (quest.id)}
                    <li class="rounded-lg border border-success/30 bg-success/5 p-3">
                      <h4 class="text-sm font-semibold text-success">{quest.title}</h4>
                      <p class="text-xs text-base-content/60">{quest.description}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if viewModel.filteredFailedQuests.length > 0}
              <section class="mb-4">
                <h3 class="mb-2 text-xs uppercase tracking-wide text-base-content/50">Failed</h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredFailedQuests as quest (quest.id)}
                    <li class="rounded-lg border border-error/30 bg-error/5 p-3">
                      <h4 class="text-sm font-semibold text-error">{quest.title}</h4>
                      <p class="text-xs text-base-content/60">{quest.description}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}

            {#if viewModel.filteredQuestJournalEntries.length > 0}
              <section>
                <h3 class="mb-2 text-xs uppercase tracking-wide text-base-content/50">
                  Past quests
                </h3>
                <ul class="space-y-2">
                  {#each viewModel.filteredQuestJournalEntries as entry (entry.questId)}
                    <li data-testid="quest-journal-entry">
                      <p>
                        <span class="text-sm font-semibold text-base-content">{entry.title}</span>
                        <span class="ml-2 badge badge-sm">{entry.status}</span>
                      </p>
                      <p class="text-xs text-base-content/70">{entry.narration}</p>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          {/if}
        {:else if viewModel.activeTab === 'notes'}
          <div class="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <div>
              <div class="mb-2 flex items-center justify-between">
                <h3 class="text-xs uppercase tracking-wide text-base-content/50">Your notes</h3>
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
                <p class="text-sm text-base-content/50">No notes yet. Write your first one.</p>
              {:else if viewModel.hasSearchQuery && viewModel.filteredNotes.length === 0}
                <p class="text-sm text-base-content/50">
                  No notes match “{viewModel.searchQuery}”.
                </p>
              {:else}
                <ul class="space-y-2">
                  {#each viewModel.filteredNotes as note (note.id)}
                    <li class="rounded-lg border border-base-300 bg-base-100 p-3">
                      <p class="text-sm font-semibold text-base-content">{note.title}</p>
                      <p class="text-xs text-base-content/70">{note.content}</p>
                      <p class="mt-1 text-[10px] text-base-content/40">{note.updatedAt}</p>
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

            <div class="rounded-lg border border-base-300 bg-base-100 p-3">
              <h3 class="text-xs uppercase tracking-wide text-base-content/50">
                {viewModel.editingId ? 'Edit note' : 'New note'}
              </h3>
              <label class="mt-2 block">
                <span class="text-xs text-base-content/60">Title</span>
                <input
                  class="input input-bordered input-sm w-full"
                  data-testid="note-title"
                  value={viewModel.draftTitle}
                  oninput={(event) => viewModel.setDraftTitle(event.currentTarget.value)}
                >
              </label>
              <label class="mt-2 block">
                <span class="text-xs text-base-content/60">Note</span>
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
              <h3 class="text-xs uppercase tracking-wide text-base-content/50">Session recap</h3>
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
          <p class="text-sm text-base-content/50">
            No recap yet. A session recap is written when you end a session.
          </p>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
