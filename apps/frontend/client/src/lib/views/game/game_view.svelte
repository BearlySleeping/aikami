<script lang="ts">
// apps/frontend/client/src/lib/views/game/game_view.svelte
//
// Main game view — combines the game canvas, UI overlay layer,
// and combat sidebar. The ViewModel owns all sub-ViewModels.
//
// Contract: C-314 — Production game composition root

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import CombatSidebar from '../combat/combat_sidebar.svelte';
import GameCanvasView from './canvas/game_canvas_view.svelte';
import type { GameViewModelInterface } from './game_view_model.svelte';
import GameUIView from './ui/game_ui_view.svelte';

type Props = {
  viewModel: GameViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div
    class="w-screen h-screen overflow-hidden"
    class:grid={viewModel.isCombat}
    style={viewModel.isCombat ? 'grid-template-columns: 35vw 1fr;' : ''}
  >
    <!-- Combat Sidebar — left grid column during combat -->
    {#if viewModel.isCombat && viewModel.combatViewModel}
      <CombatSidebar viewModel={viewModel.combatViewModel} />
    {/if}

    <!-- Right column / full viewport: Canvas + UI Layer -->
    <div class="relative w-full h-full overflow-hidden">
      <!-- Game canvas (renders PixiJS at WebGL native resolution) -->
      <GameCanvasView viewModel={viewModel.canvasViewModel} />

      <!-- Game UI overlays (pause menu, dialogue, inventory, vendor, etc.) -->
      <GameUIView viewModel={viewModel.uiViewModel} />
    </div>
  </div>
</BaseViewModelContainer>
