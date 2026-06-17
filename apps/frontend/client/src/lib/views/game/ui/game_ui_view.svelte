<script lang="ts">
  import CombatView from '../../combat/combat_view.svelte';
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import InventoryView from '../../inventory/inventory_view.svelte';
  import QuestView from '../../quest/quest_view.svelte';
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

<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

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

{#if viewModel.activeOverlay === 'COMBAT'}
  {#if viewModel.combatViewModel}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <CombatView viewModel={viewModel.combatViewModel} />
    </div>
  {:else}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/50"
    >
      <p class="text-lg font-bold text-error">Combat loading...</p>
    </div>
  {/if}
{/if}

{#if viewModel.activeOverlay === 'GAME_OVER'}
  <GameOverOverlay
    onRespawn={() => viewModel.respawnPlayer()}
    onLoadLastSave={() => viewModel.loadLastSave()}
  />
{/if}

<TransitionOverlay {viewModel} />
