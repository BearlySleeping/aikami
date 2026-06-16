<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
  import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
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

<TransitionOverlay {viewModel} />
