<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte
  //
  // Animated d20 dice component for combat immersion.
  // Shows a spinning/shaking d20 during a roll, then reveals the result
  // with a green (success) or red (failure) flash.
  //
  // Contract: C-148 Combat Immersion

  import type { CombatViewModelInterface } from '../combat_view_model.svelte.ts';

  type Props = {
    activeDiceRoll: CombatViewModelInterface['activeDiceRoll'];
  };

  const { activeDiceRoll }: Props = $props();
</script>

{#if activeDiceRoll}
  <div
    class="dice-roll-overlay fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
  >
    <div
      class="dice-container flex flex-col items-center gap-2"
      class:dice-rolling={activeDiceRoll.isRolling}
      class:dice-result={!activeDiceRoll.isRolling}
    >
      <!-- d20 die icon -->
      <div
        class="d20-die"
        class:d20-spinning={activeDiceRoll.isRolling}
        class:d20-reveal={!activeDiceRoll.isRolling}
        class:d20-success={!activeDiceRoll.isRolling && activeDiceRoll.isSuccess}
        class:d20-failure={!activeDiceRoll.isRolling && !activeDiceRoll.isSuccess}
      >
        {#if !activeDiceRoll.isRolling}
          <span class="d20-value">{activeDiceRoll.value}</span>
        {:else}
          <span class="d20-question">?</span>
        {/if}
      </div>

      <!-- Result label -->
      {#if !activeDiceRoll.isRolling}
        <span
          class="text-lg font-bold"
          class:text-success={activeDiceRoll.isSuccess}
          class:text-error={!activeDiceRoll.isSuccess}
        >
          {activeDiceRoll.isSuccess ? 'HIT!' : 'MISS'}
        </span>
      {/if}
    </div>
  </div>

  <style>
    .d20-die {
      width: 96px;
      height: 96px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      font-weight: 900;
      font-family: monospace;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      border: 3px solid #4a6fa5;
      color: #e0e0e0;
      box-shadow: 0 0 20px rgba(74, 111, 165, 0.4);
      transition:
        transform 0.3s ease,
        box-shadow 0.3s ease,
        background 0.3s ease;
    }

    /* Spinning animation during the roll */
    .d20-spinning {
      animation:
        d20-shake 0.15s ease-in-out infinite alternate,
        d20-spin 0.8s linear infinite;
      box-shadow: 0 0 30px rgba(74, 111, 165, 0.7);
    }

    /* Reveal flash */
    .d20-reveal {
      animation: d20-pop 0.4s ease-out;
    }

    /* Success — green glow */
    .d20-success {
      background: linear-gradient(135deg, #1a3a1a 0%, #225522 50%, #2d7a2d 100%);
      border-color: #4ade80;
      box-shadow: 0 0 30px rgba(74, 222, 128, 0.6);
      color: #4ade80;
    }

    /* Failure — red glow */
    .d20-failure {
      background: linear-gradient(135deg, #3a1a1a 0%, #552222 50%, #7a2d2d 100%);
      border-color: #f87171;
      box-shadow: 0 0 30px rgba(248, 113, 113, 0.6);
      color: #f87171;
    }

    @keyframes d20-shake {
      0% {
        transform: translateX(-3px) translateY(-2px) rotate(-5deg);
      }
      100% {
        transform: translateX(3px) translateY(2px) rotate(5deg);
      }
    }

    @keyframes d20-spin {
      0% {
        transform: rotateY(0deg) rotateX(0deg);
      }
      100% {
        transform: rotateY(360deg) rotateX(360deg);
      }
    }

    @keyframes d20-pop {
      0% {
        transform: scale(0.8);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.15);
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }
  </style>
{/if}
