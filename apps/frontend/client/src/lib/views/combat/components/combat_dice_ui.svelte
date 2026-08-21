<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte
//
// Combat dice wrapper — shows the animated GameDice while rolling, then the
// shared DiceCard for the resolved result. Both chat and combat render the
// same DiceCard component (C-421 AC-2).
//
// Contract: C-148 Combat Immersion, C-421 Dice That Actually Roll
import type { DiceCardData } from '@aikami/types';
import DiceCard from '$lib/components/game/dice_card.svelte';
import GameDice, { type DiceState } from '$lib/components/game/game_dice.svelte';
import type { CombatViewModelInterface } from '../combat_view_model.svelte.ts';

type Props = {
  activeDiceRoll: CombatViewModelInterface['activeDiceRoll'];
};

const { activeDiceRoll }: Props = $props();

const dice = $derived.by((): DiceState | null => {
  if (!activeDiceRoll) {
    return null;
  }
  return {
    phase: activeDiceRoll.isRolling ? 'rolling' : 'revealed',
    value: activeDiceRoll.value,
    isSuccess: activeDiceRoll.isSuccess,
    labels: { success: 'HIT!', failure: 'MISS' },
  };
});

/** Builds a DiceCardData from the combat roll for the shared card render. */
const card = $derived.by((): DiceCardData | null => {
  if (!activeDiceRoll || activeDiceRoll.isRolling) {
    return null;
  }
  const value = activeDiceRoll.value;
  return {
    id: crypto.randomUUID(),
    notation: 'd20',
    dice: [{ sides: 20, value }],
    modifier: 0,
    total: value,
    isCriticalSuccess: value === 20,
    isCriticalFailure: value === 1,
    timestamp: new Date().toISOString(),
  };
});
</script>

{#if activeDiceRoll?.isRolling}
  <GameDice {dice} />
{:else if card}
  <DiceCard {card} />
{/if}
