<script lang="ts">
// apps/frontend/client/src/lib/views/chat/connected_chats_panel_view.svelte
//
// Settings panel for managing connected chats (ChatLink). Shows
// link status, notes/influences lists, and link/unlink controls.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import type { ConnectedChatsPanelViewModelInterface } from './connected_chats_panel_view_model.svelte.ts';

type Props = {
  viewModel: ConnectedChatsPanelViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-4" data-testid="connected-chats-panel">
  {#if viewModel.isLoading}
    <div class="flex justify-center py-4">
      <span class="loading loading-spinner loading-md"></span>
    </div>
  {:else if viewModel.errorMessage}
    <div class="alert alert-error">
      <span>{viewModel.errorMessage}</span>
    </div>
  {/if}

  <!-- Not linked state -->
  {#if !viewModel.activeLink}
    <div class="text-center py-4 space-y-3">
      <p class="text-sm text-base-content/60">
        Link an OOC (Out-of-Character) chat to enable bridge tags (<code class="text-xs"
          >&lt;note&gt;</code
        >,
        <code class="text-xs">&lt;influence&gt;</code>,
        <code class="text-xs">&lt;ooc&gt;</code>) in your game messages.
      </p>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => viewModel.loadLinkData()}
        disabled={viewModel.isLinking}
        data-testid="link-ooc-chat-btn"
      >
        {#if viewModel.isLinking}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        Link OOC Chat
      </button>
    </div>
  <!-- Linked state -->
  {:else}
    <!-- Link status badge -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="badge badge-success badge-sm">Connected</span>
        <span class="text-sm text-base-content/70">OOC Chat linked</span>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs text-error"
        onclick={() => viewModel.unlinkChat()}
        disabled={viewModel.isLinking}
        data-testid="unlink-chat-btn"
      >
        Unlink
      </button>
    </div>

    <!-- Notes section -->
    <div class="space-y-2">
      <h4 class="text-sm font-semibold">Durable Notes</h4>
      <p class="text-xs text-base-content/50">
        Notes are injected into every game turn. Use
        <code class="text-xs">&lt;note&gt;text&lt;/note&gt;</code>
        in messages.
      </p>
      {#if viewModel.activeLink.notes.length > 0}
        <ul class="space-y-1" data-testid="notes-list">
          {#each viewModel.activeLink.notes as note, i}
            <li class="flex items-center justify-between gap-2 bg-base-200 rounded px-2 py-1">
              <span class="text-xs flex-1 truncate">{note}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs text-error"
                onclick={() => viewModel.removeNote({ index: i })}
              >
                ✕
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-base-content/40 italic">No notes yet</p>
      {/if}
      <div class="flex gap-2">
        <input
          type="text"
          class="input input-bordered input-xs flex-1"
          placeholder="Add a note..."
          bind:value={viewModel.newNoteText}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              viewModel.addNote();
            }
          }}
          data-testid="add-note-input"
        >
        <button
          type="button"
          class="btn btn-primary btn-xs"
          onclick={() => viewModel.addNote()}
          disabled={!viewModel.newNoteText.trim()}
        >
          Add
        </button>
      </div>
    </div>

    <!-- Influences section -->
    <div class="space-y-2">
      <h4 class="text-sm font-semibold">Pending Influences</h4>
      <p class="text-xs text-base-content/50">
        One-shot influences consumed on next turn. Use
        <code class="text-xs">&lt;influence&gt;text&lt;/influence&gt;</code>
        in messages.
      </p>
      {#if viewModel.activeLink.pendingInfluences.length > 0}
        <ul class="space-y-1" data-testid="influences-list">
          {#each viewModel.activeLink.pendingInfluences as influence, i}
            <li class="flex items-center justify-between gap-2 bg-base-200 rounded px-2 py-1">
              <span class="text-xs flex-1 truncate">{influence}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs text-error"
                onclick={() => viewModel.removeInfluence({ index: i })}
              >
                ✕
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-base-content/40 italic">No pending influences</p>
      {/if}
      <div class="flex gap-2">
        <input
          type="text"
          class="input input-bordered input-xs flex-1"
          placeholder="Add an influence..."
          bind:value={viewModel.newInfluenceText}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              viewModel.addInfluence();
            }
          }}
          data-testid="add-influence-input"
        >
        <button
          type="button"
          class="btn btn-primary btn-xs"
          onclick={() => viewModel.addInfluence()}
          disabled={!viewModel.newInfluenceText.trim()}
        >
          Add
        </button>
      </div>
    </div>
  {/if}
</div>
