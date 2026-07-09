<script lang="ts">
  // apps/frontend/client/src/lib/views/gm/gm_system_sandbox_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import AddressModeToggleView from './address_mode_toggle_view.svelte';
  import type { GmSystemSandboxViewModelInterface } from './gm_system_sandbox_view_model.svelte.ts';
  import PushStoryButtonView from './push_story_button_view.svelte';
  import SessionSummaryPanelView from './session_summary_panel_view.svelte';

  type Props = {
    viewModel: GmSystemSandboxViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-6 space-y-6">
    <h1 class="text-2xl font-bold">GM Narrative Director — Dev Sandbox</h1>

    <!-- Address Mode Toggle -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-4">
        <h2 class="card-title text-sm">Address Mode</h2>
        <AddressModeToggleView viewModel={viewModel.addressModeViewModel} />
      </div>
    </div>

    <!-- GM Prompt Debug Panel -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-4">
        <h2 class="card-title text-sm">GM Prompt Debug</h2>
        <pre
          class="bg-base-300 p-3 rounded-lg text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap"
        >{viewModel.debugPrompt}</pre>
      </div>
    </div>

    <!-- Narrative Director Controls -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-4">
        <h2 class="card-title text-sm">
          Narrative Director
          {#if viewModel.isNarrativeDirectorRunning}
            <span class="badge badge-success badge-xs">Running</span>
          {:else}
            <span class="badge badge-ghost badge-xs">Stopped</span>
          {/if}
        </h2>

        <div class="flex items-center gap-2">
          {#if viewModel.isNarrativeDirectorRunning}
            <button
              type="button"
              class="btn btn-sm btn-warning"
              onclick={() => viewModel.stopNarrativeDirector()}
            >
              Stop
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-sm btn-success"
              onclick={() => viewModel.startNarrativeDirector()}
            >
              Start
            </button>
          {/if}
          <span class="text-sm text-base-content/50">
            Scene directions: {viewModel.sceneDirectionCount}
          </span>
        </div>

        {#if viewModel.recentDirections.length > 0}
          <div class="mt-3 space-y-2">
            <span class="text-xs font-semibold">Recent Directions:</span>
            {#each viewModel.recentDirections as direction (direction.id)}
              <div class="bg-base-300 p-2 rounded text-xs">
                <p class="text-base-content/80">{direction.description}</p>
                {#if direction.playerGuidance}
                  <p class="text-primary/70 mt-1">→ {direction.playerGuidance}</p>
                {/if}
                <p class="text-base-content/40 mt-1">
                  {direction.createdAt.toLocaleTimeString()}
                </p>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Push Story Button -->
        <div class="mt-3">
          <PushStoryButtonView viewModel={viewModel.pushStoryViewModel} />
        </div>
      </div>
    </div>

    <!-- Session Lifecycle Simulator -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-4">
        <h2 class="card-title text-sm">Session Lifecycle</h2>
        <SessionSummaryPanelView viewModel={viewModel.sessionSummaryViewModel} />
      </div>
    </div>

    <!-- Simulation Log -->
    <div class="card bg-base-200 shadow-sm">
      <div class="card-body p-4">
        <div class="flex items-center justify-between">
          <h2 class="card-title text-sm">Simulation Log</h2>
          <button type="button" class="btn btn-xs btn-ghost" onclick={() => viewModel.clearLogs()}>
            Clear
          </button>
        </div>
        <div class="bg-base-300 p-3 rounded-lg text-xs font-mono overflow-auto max-h-48">
          {#each viewModel.logs as log}
            <p class="text-base-content/70">{log}</p>
          {/each}
          {#if viewModel.logs.length === 0}
            <p class="text-base-content/40">No log entries yet.</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
