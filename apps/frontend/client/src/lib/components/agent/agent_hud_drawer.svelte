<script lang="ts">
  // apps/frontend/client/src/lib/components/agent/agent_hud_drawer.svelte
  import type { AgentHudViewModelInterface } from '$views/agent/agent_hud_view_model.svelte.ts';
  import AgentStatusBadge from './agent_status_badge.svelte';

  type Props = {
    viewModel: AgentHudViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

{#if viewModel.showDrawer}
  <div
    class="fixed bottom-0 right-0 z-50 w-80 max-h-96 overflow-y-auto bg-base-200 border border-base-300 rounded-t-lg shadow-lg"
  >
    <!-- Header -->
    <div class="flex items-center justify-between p-3 border-b border-base-300">
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-semibold text-base-content">Agent Pipeline HUD</span>
        {#if viewModel.isRunning}
          <span class="loading loading-spinner loading-xs text-primary"></span>
        {/if}
      </div>
      <button
        class="btn btn-ghost btn-xs"
        onclick={() => viewModel.toggleDrawer()}
        aria-label="Close agent HUD"
      >
        ✕
      </button>
    </div>

    <!-- Phase indicator -->
    {#if viewModel.currentPhaseLabel}
      <div class="px-3 py-2 bg-base-300">
        <span class="font-mono text-xs text-base-content/70">
          {viewModel.currentPhaseLabel}
          {#if viewModel.currentAgentName}
            &raquo; {viewModel.currentAgentName}
          {/if}
        </span>
      </div>
    {/if}

    <!-- Agent results -->
    {#if viewModel.results.length > 0}
      <div class="p-3 space-y-2">
        {#each viewModel.results as result (result.agentId)}
          <AgentStatusBadge {result} />
        {/each}
      </div>

      <!-- Summary bar -->
      <div class="px-3 py-2 border-t border-base-300 flex items-center gap-3 text-xs font-mono">
        <span class="text-success">{viewModel.successCount} passed</span>
        {#if viewModel.failureCount > 0}
          <span class="text-error">{viewModel.failureCount} failed</span>
        {/if}
        <span class="text-base-content/50">{viewModel.totalDurationMs}ms</span>
      </div>
    {/if}

    <!-- Idle state -->
    {#if viewModel.results.length === 0 && !viewModel.isRunning}
      <div class="p-4 text-center text-sm text-base-content/50">
        No agent results yet. Send a message to trigger the pipeline.
      </div>
    {/if}
  </div>
{/if}

<!-- Toggle button (always visible) -->
<button
  class="fixed bottom-4 right-4 z-50 btn btn-circle btn-sm btn-primary shadow-lg"
  onclick={() => viewModel.toggleDrawer()}
  aria-label="Toggle agent HUD"
>
  <span class="font-mono text-xs">HUD</span>
</button>
