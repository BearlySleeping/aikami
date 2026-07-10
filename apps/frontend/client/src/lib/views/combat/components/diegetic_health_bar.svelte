<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/diegetic_health_bar.svelte
//
// Floating health bar rendered in the DOM layer on top of the PixiJS canvas.
// Positioned absolutely using screen-space coordinates projected from the
// engine via COMBAT_STATE_UPDATE.entityScreenX / entityScreenY.
//
// Contract: C-166 Diegetic Combat Stage — AC-2

type Props = {
  /** Entity ID for keying. */
  entityId: number;
  /** Current HP. */
  hp: number;
  /** Maximum HP. */
  maxHp: number;
  /** Screen-space X coordinate (CSS pixels). */
  screenX: number;
  /** Screen-space Y coordinate (CSS pixels). */
  screenY: number;
  /** Whether this combatant currently has the active turn. */
  isActiveTurn?: boolean;
  /** Display label (e.g. "Player" or enemy name). */
  label?: string;
};

const { entityId, hp, maxHp, screenX, screenY, isActiveTurn = false, label }: Props = $props();

/** HP percentage for the progress bar. */
const hpPercent = $derived(maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0);

/** HP bar color based on remaining health. */
const barColor = $derived(
  hpPercent > 50 ? 'bg-success' : hpPercent > 25 ? 'bg-warning' : 'bg-error',
);
</script>

<div
  class="diegetic-hp-bar absolute pointer-events-none transition-all duration-300"
  style="left: {screenX - 40}px; top: {screenY}px;"
  class:ring-2={isActiveTurn}
  class:ring-warning={isActiveTurn}
  class:rounded={isActiveTurn}
>
  <div class="flex flex-col items-center gap-0.5 min-w-[80px]">
    <!-- Label -->
    <span
      class="text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-none"
    >
      {label || (entityId === 1 ? 'Player' : `Entity #${entityId}`)}
    </span>

    <!-- HP numbers -->
    <span
      class="text-[9px] tabular-nums text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] leading-none"
    >
      {hp}/{maxHp}
    </span>

    <!-- HP bar -->
    <div class="w-full h-1.5 rounded-full bg-black/40 overflow-hidden border border-white/20">
      <div
        class="h-full {barColor} transition-all duration-300 rounded-full"
        style="width: {hpPercent}%"
      ></div>
    </div>
  </div>
</div>
