<script lang="ts">
  // apps/frontend/client/src/routes/game/+page.svelte
  import CombatSidebar from '$lib/views/combat/combat_sidebar.svelte';
  import GameView from '$lib/views/game/canvas/game_view.svelte';
  import { getGameViewViewModel } from '$lib/views/game/canvas/game_view_model.svelte';
  import GameUIView from '$lib/views/game/ui/game_ui_view.svelte';
  import { getGameUIViewModel } from '$lib/views/game/ui/game_ui_view_model.svelte';

  const gameViewViewModel = getGameViewViewModel({ className: 'GameViewViewModel' });
  const gameUIViewModel = getGameUIViewModel({ className: 'GameUIViewModel' });
</script>

<!--
  Page-level layout: CSS Grid during combat, full-width canvas otherwise.

  Contract: C-164 Combat Split-Screen Layout
  - Combat mode: 35vw left (sidebar) + 1fr right (canvas + overlays)
  - Explore mode: canvas fills entire viewport
  - GameUIView overlays the canvas (pointer-events careful layering)
-->
<svelte:window onkeydown={(e) => gameUIViewModel.handleKeyDown(e)} />

<div
  class="w-screen h-screen overflow-hidden"
  class:grid={gameViewViewModel.isCombat}
  style={gameViewViewModel.isCombat ? 'grid-template-columns: 35vw 1fr;' : ''}
>
  <!-- Combat Sidebar — left grid column during combat -->
  {#if gameViewViewModel.isCombat && gameUIViewModel.combatViewModel}
    <CombatSidebar viewModel={gameUIViewModel.combatViewModel} />
  {/if}

  <!-- Right column / full viewport: Canvas + UI Layer -->
  <div class="relative w-full h-full overflow-hidden">
    <!-- Game canvas (renders PixiJS at WebGL native resolution) -->
    <GameView viewModel={gameViewViewModel} />

    <!-- Game UI overlays (pause menu, dialogue, inventory, vendor, etc.) -->
    <GameUIView viewModel={gameUIViewModel} />
  </div>
</div>
