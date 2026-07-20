<script lang="ts">
// apps/frontend/client/src/lib/views/journal/player_journal_view.svelte
//
// Player Journal — list, create, edit, and delete journal entries.
//
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import { onMount } from 'svelte';
import type { PlayerJournalViewModelInterface } from './player_journal_view_model.svelte';

type Props = {
  viewModel: PlayerJournalViewModelInterface;
  campaignId: string;
  sessionNumber: number;
};

const { viewModel, campaignId, sessionNumber }: Props = $props();

onMount(() => {
  viewModel.loadEntries({ campaignId });
});
</script>

<div class="flex min-h-screen flex-col bg-base-200">
  <!-- Header -->
  <div class="border-b border-base-300 bg-base-100 px-6 py-4 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-bold text-base-content">📓 Player Journal</h1>
      <p class="text-sm text-base-content/50">Personal notes and observations</p>
    </div>
    <button
      type="button"
      class="btn btn-primary btn-sm"
      onclick={() => viewModel.openNewEntry({ campaignId, sessionNumber })}
    >
      + New Entry
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 p-6">
    {#if viewModel.isLoading}
      <div class="flex items-center justify-center py-20">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else if viewModel.entries.length === 0 && !viewModel.isEditorOpen}
      <div class="flex flex-col items-center justify-center py-20 text-base-content/50">
        <span class="text-4xl mb-4">📝</span>
        <p class="text-lg">No journal entries yet</p>
        <p class="text-sm">Write your first entry to start tracking your adventure</p>
      </div>
    {:else}
      <!-- Entry List -->
      <div class="mx-auto max-w-2xl space-y-4">
        {#each viewModel.entries as entry (entry.id)}
          <div
            class="rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm transition hover:shadow-md"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="text-base font-bold text-base-content">{entry.title}</h3>
                <div class="mt-1 flex flex-wrap gap-2 text-xs text-base-content/50 font-mono">
                  <span>Session {entry.sessionNumber}</span>
                  <span>
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                  {#if entry.updatedAt !== entry.createdAt}
                    <span class="text-warning">(edited)</span>
                  {/if}
                </div>
                {#if entry.tags.length > 0}
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each entry.tags as tag}
                      <span class="badge badge-sm badge-outline">{tag}</span>
                    {/each}
                  </div>
                {/if}
                <p class="mt-3 text-sm text-base-content/70 line-clamp-3 whitespace-pre-wrap">
                  {entry.content}
                </p>
              </div>
            </div>
            <div class="mt-4 flex gap-2">
              <button
                type="button"
                class="btn btn-outline btn-xs"
                onclick={() => viewModel.openEditEntry(entry)}
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs text-error"
                onclick={() => viewModel.deleteEntry({ id: entry.id })}
              >
                🗑️ Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Editor Modal -->
    {#if viewModel.isEditorOpen}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={viewModel.isEditingExisting ? 'Edit Entry' : 'New Entry'}
      >
        <div class="w-96 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
          <h2 class="text-lg font-bold text-base-content">
            {viewModel.isEditingExisting ? 'Edit Entry' : 'New Entry'}
          </h2>

          <!-- Title -->
          <div class="mt-4">
            <label class="label py-0 pb-1" for="journal-title-input">
              <span class="label-text text-xs text-base-content/60">Title</span>
            </label>
            <input
              id="journal-title-input"
              type="text"
              class="input input-bordered input-sm w-full"
              value={viewModel.editorTitle}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                viewModel.setEditorTitle(target.value);
              }}
              placeholder="Entry title..."
              maxlength={100}
            >
          </div>

          <!-- Content -->
          <div class="mt-3">
            <div class="label py-0 pb-1">
              <span class="label-text text-xs text-base-content/60">Content</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full h-32 text-sm"
              aria-label="Content"
              value={viewModel.editorContent}
              oninput={(e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                viewModel.setEditorContent(target.value);
              }}
              placeholder="What happened? What are you thinking?"
              maxlength={10000}
            ></textarea>
          </div>

          <!-- Tags -->
          <div class="mt-3">
            <label class="label py-0 pb-1" for="journal-tags-input">
              <span class="label-text text-xs text-base-content/60">Tags (comma-separated)</span>
            </label>
            <input
              id="journal-tags-input"
              type="text"
              class="input input-bordered input-sm w-full"
              value={viewModel.editorTags}
              oninput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                viewModel.setEditorTags(target.value);
              }}
              placeholder="quest, npc, theory..."
            >
          </div>

          <!-- Validation Error -->
          {#if viewModel.validationError}
            <div class="mt-3 text-xs text-error">
              {viewModel.validationError}
            </div>
          {/if}

          <!-- Actions -->
          <div class="mt-6 flex gap-3">
            <button
              type="button"
              class="btn btn-ghost flex-1"
              onclick={() => viewModel.closeEditor()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary flex-1"
              disabled={viewModel.isSaving || !viewModel.editorTitle.trim() || !viewModel.editorContent.trim()}
              onclick={() => viewModel.saveEntry()}
            >
              {#if viewModel.isSaving}
                <span class="loading loading-spinner loading-xs"></span>
                Saving...
              {:else}
                Save
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
