<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import ClockHud from '$lib/components/game/clock_hud.svelte';
  import InventoryView from '../../inventory/inventory_view.svelte';
  import QuestView from '../../quest/quest_view.svelte';
  import VendorView from '../../vendor/vendor_view.svelte';
  import CharacterDashboardView from '../dashboard/character_dashboard_view.svelte';
  import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
  import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
  import GameOverOverlay from './overlays/game_over_overlay.svelte';
  import PauseMenuOverlay from './overlays/pause_menu_overlay.svelte';
  import TransitionOverlay from './overlays/transition_overlay.svelte';

  type Props = {
    viewModel: GameUIViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- biome-ignore lint/a11y/noStaticElementInteractions: svelte:window is a valid global key handler -->
<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

<!-- Clock HUD — always visible when no full-screen overlay is active (C-213) -->
{#if viewModel.activeOverlay !== 'PAUSE_MENU' && viewModel.activeOverlay !== 'GAME_OVER'}
  <ClockHud
    gameHour={viewModel.gameHour}
    gameMinute={viewModel.gameMinute}
    windVelocity={viewModel.windVelocity}
    rainIntensity={viewModel.rainIntensity}
  />
{/if}

{#if viewModel.activeOverlay === 'PAUSE_MENU'}
  <PauseMenuOverlay
    onResume={() => viewModel.resumeGame()}
    onSave={() => viewModel.saveGame()}
    onSettings={() => viewModel.goToSettings()}
    onQuit={() => viewModel.quitToMainMenu()}
    isSaving={viewModel.isSaving}
    saveMessage={viewModel.saveMessage}
  />
{/if}

{#if viewModel.activeOverlay === 'DIALOGUE'}
  {#if viewModel.dialogueViewModel}
    <DialogueOverlay viewModel={viewModel.dialogueViewModel} />
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <div class="rounded-xl bg-base-200 p-8">
        <p class="text-lg font-bold text-error">BROKEN — dialogueViewModel is undefined</p>
        <p class="text-sm">activeOverlay: {viewModel.activeOverlay}</p>
        <p class="text-sm">dialogueNpc: {viewModel.dialogueNpc?.npcName ?? 'undefined'}</p>
      </div>
    </div>
  {/if}
{/if}

{#if viewModel.activeOverlay === 'INVENTORY'}
  {#if viewModel.inventoryViewModel}
    <InventoryView viewModel={viewModel.inventoryViewModel} />
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <p class="text-lg font-bold text-error">Inventory loading...</p>
    </div>
  {/if}
{/if}

{#if viewModel.activeOverlay === 'CHARACTER_DASHBOARD'}
  {#if viewModel.dashboardViewModel}
    <CharacterDashboardView viewModel={viewModel.dashboardViewModel} />
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <p class="text-lg font-bold text-error">Character Dashboard loading...</p>
    </div>
  {/if}
{/if}

{#if viewModel.activeOverlay === 'QUEST_LOG'}
  {#if viewModel.questViewModel}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div class="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl">
        <QuestView viewModel={viewModel.questViewModel} />
      </div>
    </div>
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <p class="text-lg font-bold text-error">Quest Log loading...</p>
    </div>
  {/if}
{/if}

{#if viewModel.activeOverlay === 'GAME_OVER'}
  <GameOverOverlay
    onRespawn={() => viewModel.respawnPlayer()}
    onLoadLastSave={() => viewModel.loadLastSave()}
  />
{/if}

{#if viewModel.activeOverlay === 'VENDOR'}
  {#if viewModel.vendorViewModel}
    <VendorView viewModel={viewModel.vendorViewModel} />
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <p class="text-lg font-bold text-error">Vendor loading...</p>
    </div>
  {/if}
{/if}

<TransitionOverlay {viewModel} />

<!-- Auto-Save Toast — Contract C-155 AC-2 -->
{#if viewModel.autoSaveStatus !== 'idle'}
  <div
    class="pointer-events-none fixed bottom-6 right-6 z-30 rounded-lg bg-base-300 px-4 py-2 text-sm shadow-lg transition-opacity duration-300"
    class:opacity-100={viewModel.autoSaveStatus === 'saving'}
    class:opacity-90={viewModel.autoSaveStatus === 'saved' || viewModel.autoSaveStatus === 'error'}
  >
    {#if viewModel.autoSaveStatus === 'saving'}
      <span class="flex items-center gap-2">
        <span class="loading loading-spinner loading-xs"></span>
        Auto-Saving...
      </span>
    {:else if viewModel.autoSaveStatus === 'saved'}
      <span class="flex items-center gap-2 text-success">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clip-rule="evenodd"
          />
        </svg>
        Saved!
      </span>
    {:else if viewModel.autoSaveStatus === 'error'}
      <span class="flex items-center gap-2 text-error">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clip-rule="evenodd"
          />
        </svg>
        Auto-save failed
      </span>
    {/if}
  </div>
{/if}
