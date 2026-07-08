<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/initiative_tracker.svelte
  // C-234 Combat Enhancement: Dice & Initiative — sorted combatant list
  //
  // Shows all combatants sorted by initiative value (descending),
  // with mini HP bars, current-turn highlight, and defeated-at-bottom graying.
  //
  // Pure component — zero business logic. All state via $props().

  import type { InitiativeEntry } from '../types/combat_enhancements.ts';
  import { sortInitiative } from '../utils/dice_notation.ts';

  type Props = {
    /** All combatant initiative entries. */
    entries: InitiativeEntry[];
    /** Whether this panel is collapsed. */
    collapsed?: boolean;
    /** Toggle collapse state. */
    onToggleCollapse?: () => void;
    /** Optional label for the panel. Defaults to "Initiative". */
    label?: string;
  };

  const {
    entries = [],
    collapsed = false,
    onToggleCollapse,
    label = 'Initiative',
  }: Props = $props();

  /** Sorted entries — recalculated reactively. */
  const sortedEntries = $derived(sortInitiative(entries));
</script>

<div class="initiative-tracker rounded-lg border border-base-300 bg-base-200">
  <!-- Collapsible header -->
  <button
    class="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-base-content/70"
    onclick={onToggleCollapse}
  >
    <span>⚔️ {label} ({entries.length})</span>
    <span class="text-base-content/40">{collapsed ? '▶' : '▼'}</span>
  </button>

  {#if !collapsed}
    <div class="space-y-0.5 px-2 pb-2">
      {#each sortedEntries as entry (entry.entityId)}
        {@const rowClass = entry.isCurrentTurn && !entry.isDefeated
          ? 'flex items-center gap-2 rounded px-2 py-1 text-xs bg-primary/10'
          : 'flex items-center gap-2 rounded px-2 py-1 text-xs'}
        {@const dotClass = entry.isCurrentTurn && !entry.isDefeated
          ? 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary'
          : 'inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-base-content/20'}
        <div class="{rowClass}" class:opacity-40={entry.isDefeated}>
          <!-- Current-turn dot -->
          <span class={dotClass}></span>

          <!-- Name + initiative value -->
          <span class="font-semibold" class:text-primary={entry.isCurrentTurn && !entry.isDefeated}>
            {entry.name}
          </span>
          <span class="font-mono text-base-content/40">(Init: {entry.initiative})</span>

          {#if entry.isDefeated}
            <span class="ml-auto text-error">💀 Defeated</span>
          {:else}
            <!-- Mini HP bar — pushed to right -->
            <div class="ml-auto flex items-center gap-1">
              <progress
                class="progress h-1 w-16"
                class:progress-success={entry.currentHp / entry.maxHp > 0.5}
                class:progress-warning={entry.currentHp / entry.maxHp > 0.25 && entry.currentHp / entry.maxHp <= 0.5}
                class:progress-error={entry.currentHp / entry.maxHp <= 0.25}
                value={entry.currentHp}
                max={entry.maxHp}
              ></progress>
              <span class="font-mono tabular-nums text-base-content/50 text-[10px]">
                {entry.currentHp}/{entry.maxHp}
              </span>
            </div>
          {/if}
        </div>
      {/each}

      {#if sortedEntries.length === 0}
        <p class="py-2 text-center text-xs text-base-content/40 italic">
          No combatants in initiative.
        </p>
      {/if}
    </div>
  {/if}
</div>
