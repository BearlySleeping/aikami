<script lang="ts">
  // apps/frontend/client/src/lib/components/game/game_dice.svelte
  //
  // Shared d20 dice component used by both dialogue skill checks and
  // combat rolls. Single source of truth for dice visuals and animations.
  //
  // Contract: C-148 Combat Immersion, C-162 Interactive Dice

  /** Unified dice state used by dialogue and combat ViewModels. */
  export type DiceState = {
    /** Current visual phase. */
    phase: 'interactive' | 'rolling' | 'revealed';
    /** The rolled value (shown in revealed phase, null during rolling). */
    value: number | null;
    /** Whether the roll succeeded (controls green/red coloring). */
    isSuccess: boolean | null;
    /** Optional: skill check type + DC label (dialogue only). */
    checkInfo?: { type: string; dc: number };
    /** Optional: custom result labels. Defaults to SUCCESS!/FAILURE. */
    labels?: { success: string; failure: string };
    /** Called when the player clicks an interactive dice. */
    onRoll?: () => void;
  };

  type Props = {
    dice: DiceState | null;
  };

  const { dice }: Props = $props();

  const successLabel = $derived(dice?.labels?.success ?? 'SUCCESS!');
  const failureLabel = $derived(dice?.labels?.failure ?? 'FAILURE');
</script>

{#if dice}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="dice-overlay absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
  >
    <div class="flex flex-col items-center gap-3 rounded-2xl bg-base-100/95 p-8 shadow-2xl">
      <!-- Check type + DC label (dialogue) -->
      {#if dice.checkInfo}
        <span class="text-xs font-semibold uppercase tracking-widest text-base-content/70">
          {dice.checkInfo.type}
          Check
        </span>
        <span class="text-sm text-base-content/70">DC {dice.checkInfo.dc}</span>
      {/if}

      <!-- d20 die -->
      {#if dice.phase === 'interactive'}
        <!-- biome-ignore lint/a11y/useSemanticElements: styled dice with proper a11y attributes -->
        <div
          class="d20-die interactive cursor-pointer"
          role="button"
          tabindex="0"
          aria-label="Click to roll d20"
          onclick={dice.onRoll}
          onkeydown={(e) => e.key === 'Enter' && dice.onRoll?.()}
        >
          <span class="d20-question">?</span>
        </div>
        <span class="text-sm font-medium text-base-content/60 animate-pulse">Click to roll</span>
      {:else if dice.phase === 'rolling'}
        <div class="d20-die spinning">
          <span class="d20-question">?</span>
        </div>
      {:else if dice.phase === 'revealed'}
        <div
          class="d20-die revealed"
          class:success={dice.isSuccess === true}
          class:failure={dice.isSuccess === false}
        >
          <span class="d20-value">{dice.value}</span>
        </div>
      {/if}

      <!-- Result label (revealed phase only) -->
      {#if dice.phase === 'revealed'}
        <span
          class="text-lg font-bold"
          class:text-success={dice.isSuccess}
          class:text-error={!dice.isSuccess}
        >
          {dice.isSuccess ? successLabel : failureLabel}
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

    .interactive {
      animation: dice-pulse 2s ease-in-out infinite;
      box-shadow: 0 0 30px rgba(74, 111, 165, 0.7);
    }

    .interactive:hover {
      transform: scale(1.15);
      box-shadow: 0 0 40px rgba(74, 111, 165, 0.9);
    }

    .spinning {
      animation:
        dice-shake 0.15s ease-in-out infinite alternate,
        dice-spin 0.8s linear infinite;
      box-shadow: 0 0 30px rgba(74, 111, 165, 0.7);
    }

    .revealed {
      animation: dice-pop 0.4s ease-out;
    }

    .success {
      background: linear-gradient(135deg, #1a3a1a 0%, #225522 50%, #2d7a2d 100%);
      border-color: #4ade80;
      box-shadow: 0 0 30px rgba(74, 222, 128, 0.6);
      color: #4ade80;
    }

    .failure {
      background: linear-gradient(135deg, #3a1a1a 0%, #552222 50%, #7a2d2d 100%);
      border-color: #f87171;
      box-shadow: 0 0 30px rgba(248, 113, 113, 0.6);
      color: #f87171;
    }

    @keyframes dice-shake {
      0% {
        transform: translateX(-3px) translateY(-2px) rotate(-5deg);
      }
      100% {
        transform: translateX(3px) translateY(2px) rotate(5deg);
      }
    }

    @keyframes dice-spin {
      0% {
        transform: rotateY(0deg) rotateX(0deg);
      }
      100% {
        transform: rotateY(360deg) rotateX(360deg);
      }
    }

    @keyframes dice-pulse {
      0%,
      100% {
        box-shadow: 0 0 30px rgba(74, 111, 165, 0.5);
      }
      50% {
        box-shadow: 0 0 50px rgba(74, 111, 165, 0.9);
      }
    }

    @keyframes dice-pop {
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
