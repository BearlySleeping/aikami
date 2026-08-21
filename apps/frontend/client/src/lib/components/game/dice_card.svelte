<script lang="ts">
// apps/frontend/client/src/lib/components/game/dice_card.svelte
//
// Shared dice card — renders a resolved roll (DiceCardData) as a compact
// card used in both chat and combat. Shows die faces, modifier, total, and
// for a check the DC + success/failure with crit highlighting. Outcome is
// conveyed in text (Success/Failure, ✓/✗) as well as colour (C-423 a11y).
//
// Contract: C-421 AC-2
import type { DiceCardData } from '@aikami/types';

type Props = {
  card: DiceCardData;
};

const { card }: Props = $props();

/** "Nat 20" / "Nat 1" crit label for a single d20. */
const critLabel = $derived.by(() => {
  if (card.isCriticalSuccess) {
    return 'Nat 20';
  }
  if (card.isCriticalFailure) {
    return 'Nat 1';
  }
  return undefined;
});

const outcomeLabel = $derived.by(() => {
  if (card.check === undefined) {
    return undefined;
  }
  return card.check.success ? 'Success' : 'Failure';
});

const outcomeMark = $derived.by(() => {
  if (card.check === undefined) {
    return undefined;
  }
  return card.check.success ? '✓' : '✗';
});
</script>

<div
  class="dice-card rounded-xl border border-base-300 bg-base-200 p-3 shadow-sm"
  data-testid="dice-card"
>
  <div class="flex items-center gap-3">
    <!-- Die faces -->
    <div class="flex flex-wrap gap-1">
      {#each card.dice as die, i (i)}
        <span
          class="die-face flex h-9 w-9 items-center justify-center rounded-md border text-sm font-bold"
          class:die-success={card.check?.success === true}
          class:die-failure={card.check?.success === false}
        >
          {die.value}
        </span>
      {/each}
    </div>

    <!-- Notation + modifier + total -->
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="font-mono text-sm font-semibold text-base-content">{card.notation}</span>
        <span class="ml-auto font-mono text-lg font-bold text-base-content">{card.total}</span>
      </div>

      <!-- Check context -->
      {#if card.check}
        <div class="mt-1 flex items-center gap-2 text-sm">
          {#if critLabel}
            <span class="font-bold text-warning">{critLabel}</span>
          {/if}
          <span class="text-base-content/70">vs DC {card.check.dc}</span>
          <span
            class="font-bold"
            class:text-success={card.check.success}
            class:text-error={!card.check.success}
          >
            {outcomeMark} {outcomeLabel}
          </span>
        </div>
      {:else if critLabel}
        <div class="mt-1 text-sm font-bold text-warning">{critLabel}</div>
      {/if}
    </div>
  </div>
</div>

<style>
.die-face {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-color: #4a6fa5;
  color: #e0e0e0;
}
.die-success {
  background: linear-gradient(135deg, #1a3a1a 0%, #225522 50%, #2d7a2d 100%);
  border-color: #4ade80;
  color: #4ade80;
}
.die-failure {
  background: linear-gradient(135deg, #3a1a1a 0%, #552222 50%, #7a2d2d 100%);
  border-color: #f87171;
  color: #f87171;
}
</style>
