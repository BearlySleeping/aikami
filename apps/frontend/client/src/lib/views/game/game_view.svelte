<script lang="ts">
  // apps/frontend/client/src/lib/views/game/game_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { GameViewModelInterface } from './game_view_model.svelte.ts';

  type Props = {
    viewModel: GameViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<svelte:window onkeydown={(e) => viewModel.handleKeyDown(e)} />

<BaseViewModelContainer {viewModel} fillHeight={true} class="relative">
  <!-- PixiJS canvas — the game engine owns this DOM element -->
  <canvas bind:this={viewModel.canvasElement} class="absolute inset-0 w-full h-full"></canvas>

  <!-- Player HUD — top-left overlay -->
  {#if viewModel.isGameReady}
    <div
      class="absolute top-3 left-3 z-10 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
    >
      <span class="text-xs font-medium text-base-content/70">Player</span>
      <span class="ml-1.5 text-sm font-semibold text-primary">{viewModel.playerDisplayName}</span>
    </div>
  {/if}

  <!-- Options overlay (Escape key) -->
  {#if viewModel.showOptions}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div
      class="absolute inset-0 z-20 flex items-center justify-center bg-base-100/90 backdrop-blur-sm"
      role="dialog"
      aria-label="Game options"
    >
      <div class="w-72 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
        <h2 class="text-center text-lg font-bold text-base-content">Options</h2>

        <div class="mt-4 space-y-2">
          <button class="btn btn-primary btn-block" onclick={() => viewModel.closeOptions()}>
            Resume
          </button>

          <button class="btn btn-outline btn-block" onclick={() => viewModel.goToDashboard()}>
            Back to PWA
          </button>
        </div>

        <!-- Save Game Section -->
        <div class="mt-4 border-t border-base-300 pt-3">
          <h3 class="text-sm font-semibold text-base-content/70">Save Game</h3>

          <div class="mt-2">
            <label for="save-slot-select" class="text-xs text-base-content/50">Slot</label>
            <select
              id="save-slot-select"
              class="select select-bordered select-sm mt-1 w-full"
              value={viewModel.saveSlotNumber}
              onchange={(e) => viewModel.setSaveSlotNumber(Number(e.currentTarget.value))}
            >
              {#each [1, 2, 3] as slot}
                <option value={slot}>Slot {slot}</option>
              {/each}
            </select>
          </div>

          <button
            class="btn btn-accent btn-sm mt-2 w-full"
            disabled={viewModel.isSaving}
            onclick={() => viewModel.saveGame(viewModel.saveSlotNumber)}
          >
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              Saving...
            {:else}
              Save to Slot {viewModel.saveSlotNumber}
            {/if}
          </button>

          {#if viewModel.saveMessage}
            <p
              class="mt-2 text-center text-xs"
              class:text-success={viewModel.saveMessage.startsWith('Game saved')}
              class:text-error={viewModel.saveMessage.startsWith('Save failed') || viewModel.saveMessage.startsWith('You must')}
            >
              {viewModel.saveMessage}
            </p>
          {/if}
        </div>

        <p class="mt-4 text-center text-xs text-base-content/50">Press Escape to close</p>
      </div>
    </div>
  {/if}

  <!-- Svelte UI overlay — owns the DOM above the canvas -->
  {#if viewModel.activeDialog}
    <div class="absolute bottom-0 inset-x-0 p-4">
      <div class="mx-auto max-w-lg rounded-lg border border-base-300 bg-base-200 p-4 shadow-lg">
        <p class="text-sm font-bold text-primary">{viewModel.activeDialog.npcName}</p>
        <p class="mt-1 text-sm text-base-content">{viewModel.activeDialog.dialog}</p>
      </div>
    </div>
  {/if}

  {#if viewModel.gameError}
    <div
      class="absolute top-4 inset-x-0 mx-auto max-w-sm rounded-lg border border-error/30 bg-error/10 p-3 text-center"
    >
      <p class="text-sm text-error">{viewModel.gameError}</p>
    </div>
  {/if}

  {#if !viewModel.isGameReady && !viewModel.gameError}
    <div class="absolute inset-0 flex items-center justify-center bg-base-100/80">
      <p class="text-sm text-base-content/60">Loading game engine...</p>
    </div>
  {/if}
</BaseViewModelContainer>
