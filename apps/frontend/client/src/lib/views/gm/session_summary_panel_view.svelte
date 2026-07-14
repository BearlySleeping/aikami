<script lang="ts">
// apps/frontend/client/src/lib/views/gm/session_summary_panel_view.svelte
import type { SessionSummaryPanelViewModelInterface } from './session_summary_panel_view_model.svelte.ts';

type Props = {
  viewModel: SessionSummaryPanelViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="card bg-base-200 shadow-sm">
  <div class="card-body p-4">
    <h3 class="card-title text-sm">Session Summary</h3>

    {#if viewModel.summaryError}
      <div class="alert alert-error text-sm">
        <span>{viewModel.summaryError}</span>
      </div>
    {/if}

    {#if viewModel.isGenerating}
      <div class="flex items-center gap-2">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-sm text-base-content/70">Generating session summary...</span>
      </div>
    {:else if viewModel.isReady && viewModel.summary}
      <div class="space-y-2 text-sm">
        <p class="text-base-content/70">Playtime: {viewModel.summary.playtimeMinutes} min</p>
        <p>{viewModel.summary.synopsis}</p>

        {#if viewModel.summary.keyEvents.length > 0}
          <div>
            <span class="font-semibold text-xs">Key Events:</span>
            <ul class="list-disc list-inside text-xs text-base-content/70">
              {#each viewModel.summary.keyEvents as event}
                <li>{event}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="flex gap-2 mt-3">
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            onclick={() => viewModel.dismissSummary()}
          >
            Dismiss
          </button>
        </div>
      </div>
    {:else}
      <p class="text-sm text-base-content/50">No summary generated yet.</p>
      <button
        type="button"
        class="btn btn-sm btn-primary mt-2"
        onclick={() => viewModel.endSession()}
      >
        End Session & Generate Summary
      </button>
    {/if}
  </div>
</div>
