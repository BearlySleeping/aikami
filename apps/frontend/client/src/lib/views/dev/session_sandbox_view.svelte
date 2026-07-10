<script lang="ts">
// apps/frontend/client/src/lib/views/dev/session_sandbox_view.svelte
import type { SessionSandboxViewModelInterface } from './session_sandbox_view_model.svelte';

type Props = {
  viewModel: SessionSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="min-h-screen bg-base-200 p-8">
  <div class="mx-auto max-w-3xl">
    <h1 class="text-2xl font-bold text-base-content mb-2">Session Management Sandbox</h1>
    <p class="text-sm text-base-content/50 mb-6">
      Dev sandbox for testing C-240 session lifecycle.
    </p>

    <!-- Status -->
    <div class="grid grid-cols-3 gap-4 mb-6">
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Active Session</span>
        <p class="text-lg font-bold text-base-content">
          {viewModel.activeSession?.sessionNumber ?? '—'}
        </p>
      </div>
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Chat Locked</span>
        <p class="text-lg font-bold {viewModel.chatLocked ? 'text-error' : 'text-success'}">
          {viewModel.chatLocked ? 'Yes' : 'No'}
        </p>
      </div>
      <div class="rounded-lg bg-base-100 p-4 border border-base-300">
        <span class="text-xs text-base-content/50 font-mono">Saved Sessions</span>
        <p class="text-lg font-bold text-base-content">
          {viewModel.sessions.length}
        </p>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap gap-3 mb-6">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => viewModel.mockStartSession()}
      >
        Start Session
      </button>
      <button
        type="button"
        class="btn btn-warning btn-sm"
        disabled={!viewModel.activeSession}
        onclick={() => viewModel.mockEndSession()}
      >
        End Session
      </button>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => viewModel.mockNewSession()}
      >
        New Session
      </button>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => viewModel.mockLoadSessions()}
      >
        Load Sessions
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={() => viewModel.mockAddMessages({ count: 10 })}
      >
        +10 Messages
      </button>
    </div>

    <!-- Session List -->
    <div class="mb-6">
      <h2 class="text-lg font-bold text-base-content mb-3">Sessions</h2>
      {#if viewModel.sessions.length === 0}
        <p class="text-sm text-base-content/50">No saved sessions</p>
      {:else}
        <div class="space-y-2">
          {#each viewModel.sessions as session (session.id)}
            <div class="rounded-lg bg-base-100 p-3 border border-base-300">
              <div class="flex items-center gap-3">
                <span class="badge badge-primary">Session {session.sessionNumber}</span>
                {#if session.isActive}
                  <span class="badge badge-success">Active</span>
                {/if}
                <span class="text-xs text-base-content/50 font-mono">
                  {new Date(session.startedAt).toLocaleString()}
                  — {session.messageCount} msgs
                </span>
              </div>
              {#if session.summary}
                <p class="mt-2 text-xs text-base-content/70 line-clamp-2">
                  {session.summary.synopsis}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Mock message count alert -->
    {#if viewModel.testMessageCount >= 10}
      <div class="alert alert-info text-sm mb-4">
        Mock messages: {viewModel.testMessageCount}
        {#if viewModel.testMessageCount >= 100}
          (Would trigger auto-summary toast)
        {/if}
      </div>
    {/if}

    <!-- Test Log -->
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-bold text-base-content">Test Log</h2>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => viewModel.clearLog()}>
        Clear
      </button>
    </div>
    <div class="rounded-lg bg-base-300 p-4 max-h-64 overflow-y-auto">
      {#if viewModel.testLog.length === 0}
        <p class="text-sm text-base-content/50 font-mono">No log entries</p>
      {:else}
        <div class="space-y-1">
          {#each viewModel.testLog as entry (entry)}
            <p class="text-xs text-base-content/70 font-mono">{entry}</p>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
