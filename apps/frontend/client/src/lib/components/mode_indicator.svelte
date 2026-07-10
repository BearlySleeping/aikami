<script lang="ts">
// apps/frontend/client/src/lib/components/mode_indicator.svelte
import { gameStateService } from '$services';

/**
 * Color classes keyed by game mode — derived reactively via $derived.
 *
 * EXPLORE → green (success), DIALOGUE → blue (info), MENU → gray (neutral).
 */
const badgeColor = $derived(
  gameStateService.currentMode === 'EXPLORE'
    ? 'badge-success'
    : gameStateService.currentMode === 'DIALOGUE'
      ? 'badge-info'
      : 'badge-ghost',
);
</script>

<!--
  Floating mode indicator badge — non-intrusive, positioned top-right.
  pointer-events-auto ensures it's clickable even inside an overlay layer.
-->
<div class="pointer-events-auto fixed top-3 right-3 z-[60]">
  <span class="badge badge-lg font-mono {badgeColor}">
    {gameStateService.currentMode}
  </span>
</div>
