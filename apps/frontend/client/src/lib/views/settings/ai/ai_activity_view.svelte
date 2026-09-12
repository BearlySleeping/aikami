<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/ai_activity_view.svelte
//
// Logicless view for the AI Activity settings section: task routing and the
// rolling text-generation telemetry buffer.

import { BaseViewModelContainer } from '$components';
import type { AiActivityViewModelInterface } from './ai_activity_view_model.svelte';

type Props = {
  viewModel: AiActivityViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="max-w-2xl mx-auto p-4 space-y-8">
    <section>
      <h2 class="text-lg font-bold mb-1">Task routing</h2>
      <p class="text-sm text-base-content/60 mb-4">
        Every kind of text call resolves through the role assigned in Connections. Change a role
        there to reroute its tasks.
      </p>
      <div class="card card-bordered border-base-300 bg-base-100">
        <div class="card-body p-4 space-y-2">
          {#each viewModel.taskRoutingRows as row (row.task)}
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="font-mono">{row.label}</span>
              <span class="font-mono text-base-content/50">{row.role}</span>
              <span class="font-mono truncate max-w-[40%] text-right">{row.connectionLabel}</span>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <section>
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-lg font-bold">Activity &amp; cost</h2>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => viewModel.clearActivity()}
        >
          Clear
        </button>
      </div>
      <p class="text-sm text-base-content/60 mb-4">
        Rolling log of the last {viewModel.activitySummary.count} text-generation calls.
      </p>

      <div class="grid grid-cols-4 gap-2 mb-4 text-sm">
        <div class="stat card card-bordered border-base-300 bg-base-100 p-3">
          <span class="text-base-content/50 text-xs">Calls</span>
          <span class="font-mono">{viewModel.activitySummary.count}</span>
        </div>
        <div class="stat card card-bordered border-base-300 bg-base-100 p-3">
          <span class="text-base-content/50 text-xs">Median</span>
          <span class="font-mono">{viewModel.activitySummary.medianTotalMs}ms</span>
        </div>
        <div class="stat card card-bordered border-base-300 bg-base-100 p-3">
          <span class="text-base-content/50 text-xs">Est. tokens</span>
          <span class="font-mono">{viewModel.activitySummary.totalTokens}</span>
        </div>
        <div class="stat card card-bordered border-base-300 bg-base-100 p-3">
          <span class="text-base-content/50 text-xs">Errors</span>
          <span class="font-mono">{viewModel.activitySummary.errorCount}</span>
        </div>
      </div>

      {#if viewModel.activitySpans.length === 0}
        <p class="text-sm text-base-content/50 italic">No calls recorded yet.</p>
      {:else}
        <div class="card card-bordered border-base-300 bg-base-100">
          <div class="card-body p-4 space-y-2">
            {#each viewModel.activitySpans as span (span.id)}
              <div class="flex items-center justify-between gap-3 text-xs">
                <span class="font-mono w-28 truncate">{span.task ?? 'text'}</span>
                <span class="font-mono flex-1 truncate text-base-content/60"
                  >{span.model || span.provider}</span
                >
                <span class="font-mono">{span.totalMs}ms</span>
                <span class="font-mono text-base-content/50">
                  {#if span.ttftMs !== undefined}
                    {span.ttftMs}ms ttft
                  {:else}
                    —
                  {/if}
                </span>
                <span class="font-mono">{span.promptTokens + span.completionTokens} tok</span>
                {#if !span.ok}
                  <span class="badge badge-error badge-xs">error</span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </section>
  </div>
</BaseViewModelContainer>
