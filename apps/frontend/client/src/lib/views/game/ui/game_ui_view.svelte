<script lang="ts">
  import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import PauseMenuOverlay from './overlays/pause_menu_overlay.svelte';

  type Props = {
    viewModel: GameUIViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!--
  Global keydown listener for overlay toggling (Escape → pause menu).
  Previously handled in game_view.svelte's GameViewModel; now lives in
  the overlay controller per C-125.
-->
<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

<!-- Pause Menu -->
{#if viewModel.activeOverlay === 'PAUSE_MENU'}
  <PauseMenuOverlay
    onResume={() => viewModel.resumeGame()}
    onSettings={() => viewModel.goToSettings()}
    onQuit={() => viewModel.quitToMainMenu()}
  />
{/if}

<!-- DIALOGUE and COMBAT overlays are out of scope for C-125. -->