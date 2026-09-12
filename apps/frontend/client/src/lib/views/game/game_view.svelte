<script lang="ts">
// apps/frontend/client/src/lib/views/game/game_view.svelte
//
// Main game view — combines the game canvas, UI overlay layer,
// and combat sidebar. The ViewModel owns all sub-ViewModels.
//
// Contract: C-314 — Production game composition root

import { BaseViewModelContainer } from '$components';
import CombatSidebar from '../combat/combat_sidebar.svelte';
import CombatPortraitStage from '../combat/components/combat_portrait_stage.svelte';
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
    style={viewModel.isCombat
      ? 'grid-template-columns: min(28vw, 32rem) minmax(0, 1fr);'
      : ''}
  >
    <!-- Combat surface — the single authoritative combat interaction area.
         The full-screen CombatView overlay was removed; the sidebar is the
         one interaction surface and the portrait stage is the scene. -->
    {#if viewModel.activeCombatViewModel}
      <CombatSidebar viewModel={viewModel.activeCombatViewModel} />
    {/if}

    <!-- Right column / full viewport: Canvas + UI Layer -->
    <div class="relative w-full h-full overflow-hidden">
      <!-- Game canvas (renders PixiJS at WebGL native resolution) -->
      <GameCanvasView viewModel={viewModel.canvasViewModel} />

      <!-- Combat portrait stage — replaces the (paused) world canvas while
           combat is active, mirroring the /dev/combat reference layout. -->
      {#if viewModel.activeCombatViewModel}
        <div class="absolute inset-0 z-0 bg-[#1a1a2e]">
          <CombatPortraitStage
            playerName={viewModel.activeCombatViewModel.playerName}
            playerPortraitUrl={viewModel.activeCombatViewModel.playerPortraitUrl}
            playerCurrentHealth={viewModel.activeCombatViewModel.playerHp}
            playerMaxHealth={viewModel.activeCombatViewModel.playerMaxHp}
            isPlayerTakingDamage={viewModel.activeCombatViewModel.isPlayerTakingDamage}
            isPlayerActiveTurn={viewModel.activeCombatViewModel.isPlayerActiveTurn}
            playerEyesSrc={viewModel.activeCombatViewModel.playerEyesSrc}
            playerEyebrowsSrc={viewModel.activeCombatViewModel.playerEyebrowsSrc}
            playerMouthSrc={viewModel.activeCombatViewModel.playerMouthSrc}
            enemyName={viewModel.activeCombatViewModel.enemyName}
            enemyPortraitUrl={viewModel.activeCombatViewModel.enemyPortraitUrl}
            enemyCurrentHealth={viewModel.activeCombatViewModel.enemyHp}
            enemyMaxHealth={viewModel.activeCombatViewModel.enemyMaxHp}
            isEnemyTakingDamage={viewModel.activeCombatViewModel.isEnemyTakingDamage}
            isEnemyActiveTurn={viewModel.activeCombatViewModel.isEnemyActiveTurn}
            enemyEyesSrc={viewModel.activeCombatViewModel.enemyEyesSrc}
            enemyEyebrowsSrc={viewModel.activeCombatViewModel.enemyEyebrowsSrc}
            enemyMouthSrc={viewModel.activeCombatViewModel.enemyMouthSrc}
          />
        </div>
      {/if}

      <!-- Game UI overlays (pause menu, dialogue, inventory, vendor, etc.) -->
      <GameUIView viewModel={viewModel.uiViewModel} />
    </div>
  </div>
</BaseViewModelContainer>
