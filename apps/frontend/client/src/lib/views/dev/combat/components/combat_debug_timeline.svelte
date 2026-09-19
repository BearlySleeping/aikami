<script lang="ts">
// apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_timeline.svelte
//
// Timeline drawer for the combat debug workspace. Lists the bounded trace
// entries in buffer order with their sequence, kind, revision, turn label,
// summary and structured payload. The ViewModel exposes no filter or
// jump-to-state method, so this drawer renders the trace unfiltered and only
// reports the buffer's dropped-entry count and incompleteness — a bounded
// trace must never look complete.
//
// Zero logic: every expression is a direct property access on the ViewModel.
//
// Contract: combat debug workspace (execution plan §7, §8)

import type { CombatDebugViewModelInterface } from '../combat_debug_view_model.svelte.ts';

type Props = {
  viewModel: CombatDebugViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<section
  class="flex h-full min-h-0 flex-col border-t border-base-300 bg-base-100"
  aria-label="Trace timeline"
  data-testid="combat-debug-timeline"
>
  <div class="flex items-center justify-between border-b border-base-300 px-3 py-2">
    <h3 class="text-xs font-bold uppercase tracking-wider text-base-content/50">
      Timeline
      <span class="ml-1 font-mono font-normal normal-case text-base-content/40">
        ({viewModel.traceEntries.length}
        entries)
      </span>
    </h3>
    {#if viewModel.traceIncomplete}
      <span
        class="badge badge-warning badge-sm"
        role="status"
        data-testid="combat-debug-trace-incomplete"
      >
        Incomplete trace — {viewModel.traceDroppedCount} dropped
      </span>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
    {#if viewModel.traceEntries.length > 0}
      <ol class="space-y-1 text-xs" data-testid="combat-debug-trace-list">
        {#each viewModel.traceEntries as entry (entry.sequence)}
          <li class="rounded border border-base-300 bg-base-200/40 p-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-base-content/40">#{entry.sequence}</span>
              <span class="badge badge-outline badge-sm font-mono">{entry.kind}</span>
              <span class="font-mono text-base-content/50">rev {entry.revision}</span>
              <span class="font-mono text-base-content/50">{entry.turnLabel}</span>
              {#if entry.actorId !== undefined}
                <span class="font-mono text-base-content/50">{entry.actorId}</span>
              {/if}
              {#if entry.commandId !== undefined}
                <span class="font-mono text-base-content/50">{entry.commandId}</span>
              {/if}
            </div>
            <p class="mt-1 text-base-content/70">{entry.summary}</p>
            {#if entry.payload !== undefined}
              <pre
                class="mt-1 whitespace-pre-wrap break-all rounded bg-base-300/40 p-1 font-mono text-xs text-base-content/60"
              >{entry.payload}</pre>
              {#if entry.payloadTruncated}
                <p class="mt-0.5 text-xs italic text-warning">Payload truncated to fit budget.</p>
              {/if}
            {/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="text-xs italic text-base-content/40" role="status">
        No trace entries recorded yet.
      </p>
    {/if}
  </div>
</section>
