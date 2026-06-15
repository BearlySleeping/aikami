<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
  import { OllamaClient } from '@aikami/frontend/api-core';
  import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
  import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
  import { DialogueOverlayViewModel } from './overlays/dialogue/dialogue_overlay_view_model.svelte';
  import PauseMenuOverlay from './overlays/pause_menu_overlay.svelte';

  type Props = {
    viewModel: GameUIViewModelInterface;
  };

  const { viewModel }: Props = $props();

  /**
   * Lazily created DialogueOverlayViewModel — only instantiated when the
   * dialogue overlay becomes active. Recreated each time a new dialogue starts.
   */
  let dialogueVM = $state<DialogueOverlayViewModel | undefined>(undefined);

  $effect(() => {
    if (viewModel.activeOverlay === 'DIALOGUE' && viewModel.dialogueNpc) {
      // Create OllamaClient for direct local streaming.
      // Falls back gracefully if Ollama is not running (errors caught in VM).
      dialogueVM = new DialogueOverlayViewModel({
        className: 'DialogueOverlayViewModel',
        npcData: viewModel.dialogueNpc,
        onEndChat: () => viewModel.endDialogue(),
        ollamaClient: new OllamaClient(),
      });
    } else if (viewModel.activeOverlay !== 'DIALOGUE') {
      dialogueVM = undefined;
    }
  });
</script>

<!--
  Global keydown listener for overlay toggling (Escape → pause menu or end dialogue).
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

<!-- Dialogue Overlay -->
{#if viewModel.activeOverlay === 'DIALOGUE' && dialogueVM}
  <DialogueOverlay viewModel={dialogueVM} />
{/if}

<!-- COMBAT overlay is out of scope for C-125 and C-128. -->