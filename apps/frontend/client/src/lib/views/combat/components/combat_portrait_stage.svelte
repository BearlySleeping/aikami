<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/components/combat_portrait_stage.svelte
  //
  // Pure DOM portrait stage for combat — replaces the PixiJS canvas with
  // static character portraits positioned left (player) and right (enemy).
  // Uses CSS Grid/Flexbox, object-fit portrait scaling, and CSS @keyframes
  // for damage feedback (shake + red flash).
  //
  // Contract: C-167 Svelte Native Combat UI MVP

  type Props = {
    /** Display state for the player combatant. */
    playerName: string;
    playerPortraitUrl: string;
    playerCurrentHealth: number;
    playerMaxHealth: number;
    isPlayerTakingDamage: boolean;
    isPlayerActiveTurn: boolean;

    /** Display state for the enemy combatant. */
    enemyName: string;
    enemyPortraitUrl: string;
    enemyCurrentHealth: number;
    enemyMaxHealth: number;
    isEnemyTakingDamage: boolean;
    isEnemyActiveTurn: boolean;
  };

  const {
    playerName,
    playerPortraitUrl,
    playerCurrentHealth,
    playerMaxHealth,
    isPlayerTakingDamage,
    isPlayerActiveTurn,
    enemyName,
    enemyPortraitUrl,
    enemyCurrentHealth,
    enemyMaxHealth,
    isEnemyTakingDamage,
    isEnemyActiveTurn,
  }: Props = $props();
</script>

<div
  class="relative flex items-end justify-between w-full h-full p-4 gap-4"
  data-testid="combat-portrait-stage"
>
  <!-- ── Player Portrait (left) ── -->
  <div
    class="flex flex-col items-center gap-2 flex-1 max-w-[45%]"
    class:scale-105={isPlayerActiveTurn}
  >
    <div
      class="relative w-full aspect-[3/4] max-w-[280px] rounded-xl overflow-hidden border-2 {isPlayerActiveTurn ? 'border-primary shadow-lg shadow-primary/30' : 'border-success/30'} bg-base-200"
      class:animate-damage-shake={isPlayerTakingDamage}
      class:animate-damage-flash={isPlayerTakingDamage}
    >
      <img
        src={playerPortraitUrl}
        alt={playerName}
        class="w-full h-full object-cover object-top"
        loading="eager"
      >
      <!-- Damage flash overlay -->
      {#if isPlayerTakingDamage}
        <div class="absolute inset-0 bg-red-500/40 animate-flash-overlay pointer-events-none"></div>
      {/if}
    </div>

    <!-- Player name + HP bar -->
    <div class="w-full max-w-[280px] space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-success">{playerName}</span>
        <span class="text-xs tabular-nums text-base-content/70">
          {playerCurrentHealth}/{playerMaxHealth}
        </span>
      </div>
      <progress
        class="progress progress-success h-2 w-full"
        value={playerCurrentHealth}
        max={playerMaxHealth}
      ></progress>
    </div>
  </div>

  <!-- ── VS Divider ── -->
  <div class="flex flex-col items-center gap-1 self-center pb-12">
    <span class="text-3xl font-bold text-base-content/20">⚔️</span>
    <span class="text-xs font-mono text-base-content/30 tracking-widest">VS</span>
  </div>

  <!-- ── Enemy Portrait (right) ── -->
  <div
    class="flex flex-col items-center gap-2 flex-1 max-w-[45%]"
    class:scale-105={isEnemyActiveTurn}
  >
    <div
      class="relative w-full aspect-[3/4] max-w-[280px] rounded-xl overflow-hidden border-2 {isEnemyActiveTurn ? 'border-primary shadow-lg shadow-primary/30' : 'border-error/30'} bg-base-200"
      class:animate-damage-shake={isEnemyTakingDamage}
      class:animate-damage-flash={isEnemyTakingDamage}
    >
      <img
        src={enemyPortraitUrl}
        alt={enemyName}
        class="w-full h-full object-cover object-top"
        loading="eager"
      >
      <!-- Damage flash overlay -->
      {#if isEnemyTakingDamage}
        <div class="absolute inset-0 bg-red-500/40 animate-flash-overlay pointer-events-none"></div>
      {/if}
    </div>

    <!-- Enemy name + HP bar -->
    <div class="w-full max-w-[280px] space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-error">{enemyName}</span>
        <span class="text-xs tabular-nums text-base-content/70">
          {enemyCurrentHealth}/{enemyMaxHealth}
        </span>
      </div>
      <progress
        class="progress progress-error h-2 w-full"
        value={enemyCurrentHealth}
        max={enemyMaxHealth}
      ></progress>
    </div>
  </div>
</div>

<style>
  /* ── Damage shake animation ── */
  @keyframes damage-shake {
    0%,
    100% {
      transform: translate(0, 0);
    }
    10% {
      transform: translate(-3px, -1px);
    }
    20% {
      transform: translate(2px, 1px);
    }
    30% {
      transform: translate(-2px, 2px);
    }
    40% {
      transform: translate(1px, -1px);
    }
    50% {
      transform: translate(-2px, -2px);
    }
    60% {
      transform: translate(1px, 1px);
    }
    70% {
      transform: translate(-1px, -1px);
    }
    80% {
      transform: translate(1px, 0);
    }
    90% {
      transform: translate(-1px, 1px);
    }
  }

  .animate-damage-shake {
    animation: damage-shake 0.35s ease-in-out;
  }

  /* ── Damage red tint (border + shadow) ── */
  @keyframes damage-flash-border {
    0%,
    100% {
      border-color: inherit;
    }
    50% {
      border-color: rgb(239 68 68);
      box-shadow: 0 0 12px rgb(239 68 68 / 0.4);
    }
  }

  .animate-damage-flash {
    animation: damage-flash-border 0.35s ease-in-out;
  }

  /* ── Flash overlay (fades in then out) ── */
  @keyframes flash-overlay {
    0% {
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .animate-flash-overlay {
    animation: flash-overlay 0.35s ease-in-out;
  }

  /* Smooth scale transition for active turn indicator */
  :global(.scale-105) {
    transition: transform 0.3s ease;
  }
</style>
