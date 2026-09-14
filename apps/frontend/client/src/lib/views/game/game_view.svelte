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
import { combatSheetHeight, resolveCombatLayout } from './ui/combat_layout.ts';
import GameUIView from './ui/game_ui_view.svelte';

type Props = {
  viewModel: GameViewModelInterface;
};

const { viewModel }: Props = $props();

/**
 * C-527 AC-4 — the combat container adapts to the space it actually has.
 *
 * `split` is only legal while the scene keeps a usable width AND the sidebar
 * keeps a readable minimum after the text scale is taken into account;
 * otherwise the SAME sidebar renders as an accessible bottom action sheet. One
 * resolver, ONE `CombatSidebar` instance either way — the container changes,
 * the action workflow (and its local form state) does not remount.
 */
let viewportWidth = $state(0);
let viewportHeight = $state(0);

/** Current root font size, so the rem-based combat budgets track text scale. */
const readRootFontSize = (): number => {
  if (typeof document === 'undefined') {
    return 16;
  }
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
};

const combatLayout = $derived(
  resolveCombatLayout({
    width: viewportWidth,
    height: viewportHeight,
    rootFontSize: readRootFontSize(),
  }),
);
const isSplitCombat = $derived(viewModel.isCombat && combatLayout === 'split');
const isSheetCombat = $derived(viewModel.isCombat && combatLayout === 'sheet');
const sheetHeight = $derived(`${combatSheetHeight(viewportHeight, readRootFontSize())}px`);
</script>

<svelte:window
  onkeydown={(e) => viewModel.handleKeyDown(e)}
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
/>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div
    class="w-screen h-screen overflow-hidden"
    class:grid={isSplitCombat}
    class:flex={isSheetCombat}
    class:flex-col-reverse={isSheetCombat}
    style={isSplitCombat ? 'grid-template-columns: clamp(20rem, 28vw, 32rem) minmax(0, 1fr);' : ''}
  >
    <!-- Combat surface — the single authoritative combat interaction area.
         The full-screen CombatView overlay was removed; the sidebar is the one
         interaction surface and the portrait stage is the scene.
         C-527 AC-4: ONE `CombatSidebar` instance in a container that adapts —
         a left rail when split, a bottom action sheet when narrow. Because the
         `{#if}` keys on combat, not on layout, crossing the breakpoint moves
         the SAME instance (and its unsent form state) rather than remounting. -->
    {#if viewModel.activeCombatViewModel && (isSplitCombat || isSheetCombat)}
      <section
        class="relative z-10 min-h-0 shrink-0 overflow-hidden bg-base-100 {isSplitCombat
          ? 'border-r'
          : 'border-t'} border-base-300"
        style={isSheetCombat ? `height: ${sheetHeight};` : ''}
        aria-label="Combat actions"
        data-testid={isSplitCombat ? 'combat-side-rail' : 'combat-action-sheet'}
      >
        <CombatSidebar viewModel={viewModel.activeCombatViewModel} />
      </section>
    {/if}

    <!-- Scene region: canvas + UI layer. Fills the viewport on its own, the
         remaining grid column during a split, and the space above the sheet
         when the layout is narrow. (C-527 AC-4) -->
    <div
      class="relative min-h-0 min-w-0 overflow-hidden"
      class:flex-1={viewModel.isCombat}
      class:h-full={!viewModel.isCombat}
      data-testid="game-scene-region"
    >
      <!-- Game canvas (renders PixiJS at WebGL native resolution) -->
      <GameCanvasView viewModel={viewModel.canvasViewModel} />

      <!-- Combat portrait stage — only for encounters that are NOT on the v2
           direct-control engine. Direct control needs the tactical world
           canvas visible and interactive (click-to-move), so the portrait
           stage is suppressed there; legacy combat keeps it as before.
           (C-525 R-2) -->
      {#if viewModel.activeCombatViewModel && !viewModel.activeCombatViewModel.isDirectControl}
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
