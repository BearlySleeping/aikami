<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/dice_history_feed.svelte
//
// Roll-history feed (C-421 AC-4) — lists past rolls from DiceService.history
// with notation, total, timestamp, and where present the DC + success/failure.
import type { DiceHistoryEntry } from '$lib/services/dice/dice_service.svelte.ts';

type Props = {
  entries: DiceHistoryEntry[];
  onClose: () => void;
};

const { entries, onClose }: Props = $props();

const formatTime = (date: Date): string =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Roll History"
  tabindex="-1"
>
  <div class="w-full max-w-96 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold text-base-content">Roll History</h2>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Close roll history"
        autofocus
        onclick={onClose}
      >
        ✕
      </button>
    </div>

    {#if entries.length === 0}
      <p class="mt-4 text-center text-sm text-base-content/60">No rolls yet.</p>
    {:else}
      <ul class="mt-4 max-h-80 space-y-2 overflow-y-auto">
        {#each entries as entry, i (i)}
          <li class="rounded-lg border border-base-300 bg-base-100 p-3">
            <div class="flex items-baseline justify-between">
              <span class="font-mono text-sm font-semibold text-base-content">
                {entry.notation ?? `d${entry.sides}`}
              </span>
              <span class="font-mono text-base font-bold text-base-content">{entry.total}</span>
            </div>
            <div class="mt-1 flex items-center justify-between text-xs text-base-content/60">
              <span>{formatTime(entry.timestamp)}</span>
              {#if entry.dc !== undefined}
                <span
                  class="font-semibold"
                  class:text-success={entry.success}
                  class:text-error={!entry.success}
                >
                  vs DC {entry.dc} — {entry.success ? 'Success ✓' : 'Failure ✗'}
                </span>
              {:else}
                <span>Flat roll</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
