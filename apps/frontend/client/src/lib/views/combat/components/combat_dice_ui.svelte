<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte
  //
  // Combat dice wrapper — delegates to the shared GameDice component.
  // Maps CombatViewModel.activeDiceRoll → unified DiceState.
  //
  // Contract: C-148 Combat Immersion

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
</script>

<GameDice {dice} />
