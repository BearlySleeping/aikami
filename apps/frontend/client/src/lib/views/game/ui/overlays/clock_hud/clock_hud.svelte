<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/clock_hud/clock_hud.svelte
//
// Diegetic game-time HUD overlay. Displays in-game hour:minute with a
// diurnal phase icon and optional weather indicator.
//
// Contract: C-213 Environment, Time, and Weather Core System

type Props = {
  /** Game hour (0–24). */
  gameHour: number;
  /** Game minute (0–59). */
  gameMinute: number;
  /** Wind velocity (−1.0 to 1.0). */
  windVelocity?: number;
  /** Rain intensity (0.0 to 1.0). */
  rainIntensity?: number;
  /** Whether to show weather indicators. Default true. */
  showWeather?: boolean;
};

const {
  gameHour,
  gameMinute,
  windVelocity = 0,
  rainIntensity = 0,
  showWeather = true,
}: Props = $props();

/**
 * Formats a number as a zero-padded two-digit string.
 */
const pad = (n: number): string => {
  return String(n).padStart(2, '0');
};

/** Returns the diurnal phase label based on the game hour. */
const diurnalLabel = $derived.by(() => {
  if (gameHour >= 5 && gameHour < 7) {
    return 'Dawn';
  }
  if (gameHour >= 7 && gameHour < 17) {
    return 'Day';
  }
  if (gameHour >= 17 && gameHour < 19) {
    return 'Dusk';
  }
  return 'Night';
});

/** Returns the sun/moon icon based on the diurnal phase. */
const diurnalIcon = $derived.by(() => {
  if (gameHour >= 5 && gameHour < 7) {
    return '🌅';
  }
  if (gameHour >= 7 && gameHour < 17) {
    return '☀️';
  }
  if (gameHour >= 17 && gameHour < 19) {
    return '🌇';
  }
  return '🌙';
});

/** Returns a weather description string. */
const _weatherLabel = $derived.by(() => {
  if (rainIntensity > 0.6) {
    return 'Storm';
  }
  if (rainIntensity > 0.3) {
    return 'Rain';
  }
  if (rainIntensity > 0.05) {
    return 'Drizzle';
  }
  if (Math.abs(windVelocity) > 0.5) {
    return 'Windy';
  }
  return 'Clear';
});

/** Returns a weather icon emoji. */
const weatherIcon = $derived.by(() => {
  if (rainIntensity > 0.6) {
    return '⛈️';
  }
  if (rainIntensity > 0.3) {
    return '🌧️';
  }
  if (rainIntensity > 0.05) {
    return '🌦️';
  }
  if (Math.abs(windVelocity) > 0.5) {
    return '💨';
  }
  return '✨';
});
</script>

<div class="clock-hud pointer-events-none absolute top-3 right-3 z-50 flex items-center gap-3">
  <!-- Main time pill -->
  <div
    class="flex items-center gap-2 rounded-full bg-base-200/80 px-3 py-1.5 text-sm backdrop-blur-sm shadow-md border border-base-300/50"
  >
    <span class="text-base">{diurnalIcon}</span>
    <span class="font-mono font-semibold tabular-nums text-base-content">
      {pad(gameHour)}:{pad(gameMinute)}
    </span>
    {#if showWeather && (rainIntensity > 0.05 || Math.abs(windVelocity) > 0.3)}
      <span class="text-xs text-base-content/60">
        {weatherIcon}
      </span>
    {/if}
  </div>

  <!-- Diurnal phase label (small, below the pill) -->
  <span class="text-xs text-base-content/50 font-medium hidden sm:inline">
    {diurnalLabel}
  </span>
</div>
