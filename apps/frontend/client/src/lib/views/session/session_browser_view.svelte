<script lang="ts">
// apps/frontend/client/src/lib/views/session/session_browser_view.svelte
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
        <p class="text-sm">Start a game to create your first session</p>
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
                </div>

                {#if session.summary}
                  <p class="mt-3 text-sm text-base-content/70 line-clamp-3">
                    {session.summary.synopsis}
                  </p>
                {/if}
              </div>

              {#if session.isActive}
                <span class="text-xs text-success font-semibold whitespace-nowrap">
                  In Progress
                </span>
              {/if}
            </div>

            <div class="mt-4 flex gap-2">
              {#if session.summary}
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  onclick={() => viewModel.viewSession(session)}
                >
                  View Summary
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
