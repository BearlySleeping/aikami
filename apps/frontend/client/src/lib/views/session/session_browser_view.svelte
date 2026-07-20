<script lang="ts">
// apps/frontend/client/src/lib/views/session/session_browser_view.svelte
//
// Session Browser — list sessions with checkpoints, view summaries,
// continue, and fork from checkpoints.
//
// Contract: C-240 Session Management
// Contract: C-344 Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

import type { SessionBrowserViewModelInterface } from './session_browser_view_model.svelte';

type Props = {
  viewModel: SessionBrowserViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="flex min-h-screen flex-col bg-base-200">
  <!-- Header -->
  <div class="border-b border-base-300 bg-base-100 px-6 py-4">
    <h1 class="text-xl font-bold text-base-content">Session History</h1>
    <p class="text-sm text-base-content/50">View and continue past game sessions</p>
  </div>

  <!-- Content -->
  <div class="flex-1 p-6">
    {#if viewModel.isLoading}
      <div class="flex items-center justify-center py-20">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
    {:else if viewModel.sessions.length === 0}
      <div class="flex flex-col items-center justify-center py-20 text-base-content/50">
        <span class="text-4xl mb-4">📜</span>
        <p class="text-lg">No sessions yet</p>
        <p class="text-sm">Start a campaign and end your first session to see it here.</p>
      </div>
    {:else}
      <div class="mx-auto max-w-2xl space-y-4">
        {#each viewModel.sessions as session (session.id)}
          <div
            class="rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm transition hover:shadow-md"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="text-base font-bold text-base-content">
                  Session {session.sessionNumber}
                  {#if session.isActive}
                    <span class="badge badge-success ml-2 text-xs">Active</span>
                  {/if}
                  {#if session.recapReviewed}
                    <span class="badge badge-info ml-2 text-xs">Recap reviewed</span>
                  {/if}
                </h3>

                <div class="mt-2 flex flex-wrap gap-3 text-xs text-base-content/50 font-mono">
                  <span>
                    {new Date(session.startedAt).toLocaleDateString()}
                    {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {#if session.durationMinutes}
                    <span>{session.durationMinutes} min</span>
                  {/if}
                  <span>{session.messageCount} messages</span>
                  {#if session.checkpointIds.length > 0}
                    <span class="text-primary">{session.checkpointIds.length} checkpoints</span>
                  {/if}
                </div>

                {#if session.summary}
                  <p class="mt-3 text-sm text-base-content/70 line-clamp-3">
                    {session.editedSynopsis ?? session.summary.synopsis}
                  </p>
                {:else if !session.isActive && session.messageCount > 0}
                  <p class="mt-3 text-sm text-base-content/40 italic">
                    No summary generated — session was too short.
                  </p>
                {/if}
              </div>

              {#if session.isActive}
                <span class="text-xs text-success font-semibold whitespace-nowrap">
                  In Progress
                </span>
              {/if}
            </div>

            <div class="mt-4 flex gap-2 flex-wrap">
              {#if session.summary}
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  onclick={() => viewModel.viewSession(session)}
                >
                  View Summary
                </button>
              {/if}
              {#if !session.isActive}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  onclick={() => viewModel.continueFromSession(session)}
                >
                  ▶ Continue
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  onclick={() => viewModel.continueFromSession(session)}
                >
                  ▶ Resume
                </button>
              {/if}
            </div>

            <!-- Checkpoints nested under session (C-344) -->
            {#if viewModel.checkpoints.filter(c => c.sessionId === session.id).length > 0}
              <div class="mt-4 border-t border-base-300 pt-3 space-y-2">
                <h4 class="text-xs font-semibold text-base-content/50 uppercase tracking-wide">
                  Checkpoints
                </h4>
                {#each viewModel.checkpoints.filter(c => c.sessionId === session.id) as checkpoint (checkpoint.id)}
                  <div class="flex items-center justify-between rounded-lg bg-base-200 px-3 py-2">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-base-content truncate">
                          {checkpoint.label}
                        </span>
                        {#if checkpoint.hasForks}
                          <span class="badge badge-xs badge-warning">forked</span>
                        {/if}
                      </div>
                      {#if checkpoint.description}
                        <p class="text-xs text-base-content/40 truncate mt-0.5">
                          {checkpoint.description}
                        </p>
                      {/if}
                      <span class="text-xs text-base-content/30 font-mono">
                        {new Date(checkpoint.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn btn-outline btn-xs ml-2 whitespace-nowrap"
                      onclick={() => viewModel.openForkConfirm(checkpoint)}
                    >
                      Fork from here
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Fork Confirmation Dialog (C-344) -->
  {#if viewModel.showForkConfirm && viewModel.forkCheckpoint}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Fork from checkpoint"
    >
      <div class="w-96 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
        <h2 class="text-lg font-bold text-base-content">Fork from Checkpoint?</h2>

        <p class="mt-3 text-sm text-base-content/70">
          This will create a new branch from checkpoint
          <strong>"{viewModel.forkCheckpoint.label}"</strong>. The original save will not be
          modified. A new session will start with the checkpoint's game state.
        </p>

        {#if viewModel.forkError}
          <div class="mt-3 text-xs text-error">
            {viewModel.forkError}
          </div>
        {/if}

        <div class="mt-6 flex gap-3">
          <button
            type="button"
            class="btn btn-ghost flex-1"
            onclick={() => viewModel.closeForkConfirm()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary flex-1"
            disabled={viewModel.isForking}
            onclick={() => viewModel.confirmFork()}
          >
            {#if viewModel.isForking}
              <span class="loading loading-spinner loading-xs"></span>
              Forking...
            {:else}
              Fork & Continue
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Read-Only Session View (existing C-240) -->
  {#if viewModel.showReadOnly && viewModel.selectedSession}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Session Summary"
    >
      <div
        class="w-96 max-h-[80vh] rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl overflow-y-auto"
      >
        <h2 class="text-lg font-bold text-base-content">
          Session {viewModel.selectedSession.sessionNumber} Summary
        </h2>

        <div class="mt-4 rounded-lg bg-base-100 p-4 border border-base-300">
          {#if viewModel.selectedSession.summary}
            <p class="text-sm text-base-content/90 whitespace-pre-wrap">
              {viewModel.selectedSession.editedSynopsis ?? viewModel.selectedSession.summary.synopsis}
            </p>

            {#if viewModel.selectedSession.summary.keyEvents.length > 0}
              <ul class="mt-3 space-y-1">
                {#each viewModel.selectedSession.summary.keyEvents as event}
                  <li class="text-xs text-base-content/60 flex items-start gap-1">
                    <span class="text-primary mt-0.5">•</span>
                    <span>{event}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else}
            <p class="text-sm text-base-content/40 italic">
              No summary generated — session was too short.
            </p>
          {/if}
        </div>

        <div class="mt-6">
          <button
            type="button"
            class="btn btn-outline btn-block"
            onclick={() => viewModel.closeReadOnly()}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
