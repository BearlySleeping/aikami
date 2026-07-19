<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/hp_bar.svelte
//
// Always-visible player HP bar for the game HUD.
// Shows "{hp}/{maxHp}" text with a partially-filled progress bar.
// Contract: C-332 AC-1

type Props = {
  hp: number;
  maxHp: number;
  visible: boolean;
};

const { hp, maxHp, visible }: Props = $props();

const hpPercent = $derived(maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0);
const barColor = $derived(
  hpPercent > 50 ? 'bg-success' : hpPercent > 25 ? 'bg-warning' : 'bg-error',
);
</script>

{#if visible}
  <div
    class="hp-bar-hud absolute top-3 left-3 z-50 flex items-center gap-2"
    role="progressbar"
    aria-valuenow={hp}
    aria-valuemin={0}
    aria-valuemax={maxHp}
    aria-label="Player HP"
  >
    <div
      class="flex items-center gap-2 rounded-full bg-base-200/80 px-3 py-1.5 backdrop-blur-sm shadow-md border border-base-300/50"
    >
      <!-- Heart icon -->
      <span class="text-base" aria-hidden="true">❤️</span>

      <!-- Progress bar -->
      <div class="h-2 w-20 rounded-full bg-base-300/50 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300 ease-out {barColor}"
          style="width: {hpPercent}%"
        ></div>
      </div>

      <!-- HP text -->
      <span class="font-mono text-xs font-semibold tabular-nums text-base-content">
        {hp}/{maxHp}
      </span>
    </div>
  </div>
{/if}
