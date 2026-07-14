<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/turn_tracker_header.svelte
// C-234 Combat Enhancement: Dice & Initiative — turn tracking header
//
// Banner showing "Your Turn" / "Enemy Turn" with action economy dots
// (Action / Bonus Action / Reaction) and an End Turn button.
//
// Pure component — zero business logic. All state via $props().

import type { ActionEconomy, TurnState } from '../types/combat_enhancements.ts';

type Props = {
  /** Current turn state. */
  turnState: TurnState | null;
  /** Current action economy consumed this turn. */
  actionEconomy: ActionEconomy;
  /** Callback to end the current turn. */
  onEndTurn: () => void;
  /** Whether the End Turn button is disabled. */
  isEndTurnDisabled: boolean;
};

const { turnState, actionEconomy, onEndTurn, isEndTurnDisabled = false }: Props = $props();

/** Build the dot class: colored when available, muted when consumed. */
const dotClass = (available: boolean, color: string): string =>
  `inline-block h-2.5 w-2.5 rounded-full ${available ? color : 'bg-base-content/20'}`;

/** Build the label class: full opacity when available, dimmed when consumed. */
const labelClass = (available: boolean): string =>
  `text-xs ${available ? 'text-base-content/70' : 'text-base-content/30'}`;
</script>

{#if turnState}
  {@const headerClass = turnState.isPlayerTurn
    ? 'turn-tracker-header rounded-lg border px-4 py-3 bg-success/5 border-success/40'
    : 'turn-tracker-header rounded-lg border px-4 py-3 bg-error/5 border-error/40'}
  <div class={headerClass}>
    <!-- Turn banner + End Turn button -->
    <div class="mb-2 flex items-center justify-between">
      <span
        class="text-sm font-bold"
        class:text-success={turnState.isPlayerTurn}
        class:text-error={!turnState.isPlayerTurn}
      >
        {turnState.isPlayerTurn ? '🎯 Your Turn' : '👹 Enemy Turn'}
      </span>
      <span class="text-xs font-mono text-base-content/40 tabular-nums">
        Turn {turnState.turnNumber}
      </span>
    </div>

    <div class="flex items-center justify-between">
      <!-- Action economy dots -->
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <span class={dotClass(!actionEconomy.action, 'bg-success')}></span>
          <span class={labelClass(!actionEconomy.action)}>Action</span>
        </div>
        <div class="flex items-center gap-1">
          <span class={dotClass(!actionEconomy.bonusAction, 'bg-warning')}></span>
          <span class={labelClass(!actionEconomy.bonusAction)}>Bonus</span>
        </div>
        <div class="flex items-center gap-1">
          <span class={dotClass(!actionEconomy.reaction, 'bg-info')}></span>
          <span class={labelClass(!actionEconomy.reaction)}>Reaction</span>
        </div>
      </div>

      <!-- End Turn button (only during player turn) -->
      {#if turnState.isPlayerTurn}
        <button
          type="button"
          class="btn btn-outline btn-xs"
          onclick={onEndTurn}
          disabled={isEndTurnDisabled}
        >
          End Turn
        </button>
      {/if}
    </div>
  </div>
{/if}
