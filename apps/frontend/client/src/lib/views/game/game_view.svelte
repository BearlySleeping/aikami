<script lang="ts">
// apps/frontend/client/src/lib/views/game/game_view.svelte
//
// Main game view — combines the game canvas, UI overlay layer,
// and combat sidebar. The ViewModel owns all sub-ViewModels.
//
// Contract: C-314 — Production game composition root

import { onMount } from 'svelte';
import { BaseViewModelContainer } from '$components';
import { gameOverlayService, memoryRetrievalService } from '$services';
import CombatSidebar from '../combat/combat_sidebar.svelte';
import GameCanvasView from './canvas/game_canvas_view.svelte';
import type { GameViewModelInterface } from './game_view_model.svelte';
import GameUIView from './ui/game_ui_view.svelte';

type Props = {
  viewModel: GameViewModelInterface;
};

const { viewModel }: Props = $props();

// E2E save hook (C-492 AC-3): a document-level `aikami:quick-save` event
// drives the real persistence path (gameOverlayService.saveGame) so tests can
// save+reload the campaign without UI chrome. Inert in normal play.
onMount(() => {
  const onQuickSave = (): void => {
    void gameOverlayService.saveGame();
  };
  window.addEventListener('aikami:quick-save', onQuickSave);
  return () => window.removeEventListener('aikami:quick-save', onQuickSave);
});
</script>

<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <!--
    Memory-retrieval readiness (C-492 AC-2) — inert, visually-hidden test hook
    that appears once the post-hydration boot hook has initialised the memory
    index. Never alters production behaviour; used by the AC-3 E2E.
  -->
  {#if memoryRetrievalService.isReady}
    <div data-testid="game-boot-memory-ready" class="hidden" aria-hidden="true"></div>
  {/if}

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
