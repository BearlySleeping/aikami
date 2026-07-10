<script lang="ts">
  import InventoryView from '../../inventory/inventory_view.svelte';
  import QuestView from '../../quest/quest_view.svelte';
  import VendorView from '../../vendor/vendor_view.svelte';
  import CharacterSheetView from '../dashboard/character_sheet_view.svelte';
  import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import ClockHud from './overlays/clock_hud/clock_hud.svelte';
  import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
  import EndSessionView from './overlays/end_session/end_session_view.svelte';
  import GameOverOverlay from './overlays/game_over_overlay.svelte';
  import PauseMenuView from './overlays/pause_menu/pause_menu_view.svelte';
  import TransitionOverlay from './overlays/transition_overlay.svelte';

  type Props = {
    viewModel: GameUIViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!--
  Game UI layer — absolutely positioned over the canvas.
  pointer-events-none allows clicks to pass through to the canvas
  unless a child element explicitly sets pointer-events-auto.
-->
<div class="absolute inset-0 z-10 pointer-events-none">
  <!-- Clock HUD — visible when no full-screen overlay blocks the game (C-213) -->
  {#if viewModel.showClockHud}
    <ClockHud
      gameHour={viewModel.gameHour}
      gameMinute={viewModel.gameMinute}
      windVelocity={viewModel.windVelocity}
      rainIntensity={viewModel.rainIntensity}
    />
  {/if}

  <!-- Overlay router -->
  {#if viewModel.chatLocked}
    <!-- Chat locked banner (C-240) -->
    <div
      class="pointer-events-auto fixed top-0 left-0 right-0 z-50 bg-warning/90 px-4 py-2 text-center text-sm font-semibold text-warning-content"
      role="alert"
    >
      Session ended. Start a new session to continue chatting.
    </div>
  {/if}

  {#if viewModel.activeOverlay === 'PAUSE_MENU' && viewModel.pauseMenuViewModel}
    <PauseMenuView viewModel={viewModel.pauseMenuViewModel} />
  {:else if viewModel.activeOverlay === 'DIALOGUE' && viewModel.dialogueViewModel}
    <DialogueOverlay viewModel={viewModel.dialogueViewModel} />
  {:else if viewModel.activeOverlay === 'GAME_OVER'}
    <GameOverOverlay
      onRespawn={() => viewModel.respawnPlayer()}
      onLoadLastSave={() => viewModel.loadLastSave()}
    />
  {:else if viewModel.activeOverlay === 'INVENTORY' && viewModel.inventoryViewModel}
    <InventoryView viewModel={viewModel.inventoryViewModel} />
  {:else if viewModel.activeOverlay === 'QUEST_LOG' && viewModel.questViewModel}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div class="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl">
        <QuestView viewModel={viewModel.questViewModel} />
      </div>
    </div>
  {:else if viewModel.activeOverlay === 'CHARACTER_DASHBOARD' && viewModel.dashboardViewModel}
    <CharacterSheetView viewModel={viewModel.dashboardViewModel} />
  {:else if viewModel.activeOverlay === 'VENDOR' && viewModel.vendorViewModel}
    <VendorView viewModel={viewModel.vendorViewModel} />
  {:else if viewModel.activeOverlay === 'END_SESSION' && viewModel.endSessionViewModel}
    <EndSessionView viewModel={viewModel.endSessionViewModel} />
  {/if}

  <TransitionOverlay {viewModel} />
</div>
