<script lang="ts">
  // apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte
  import type { PauseMenuViewModelInterface } from './pause_menu_view_model.svelte';

  type Props = {
    viewModel: PauseMenuViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
  role="dialog"
  aria-label="Pause Menu"
>
  <div class="w-72 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
    <h2 class="text-center text-lg font-bold text-base-content">Paused</h2>

    <div class="mt-6 space-y-3">
      <button
        type="button"
        class="btn btn-primary btn-block"
        onclick={() => viewModel.resumeGame()}
      >
        Resume Game
      </button>

      <button
        type="button"
        class="btn btn-outline btn-block"
        disabled={viewModel.isSaving}
        onclick={() => viewModel.saveGame()}
      >
        {#if viewModel.isSaving}
          <span class="loading loading-spinner loading-xs"></span>
          Saving...
        {:else}
          Save Game
        {/if}
      </button>

      {#if viewModel.saveMessage}
        <p
          class="text-center text-sm"
          class:text-success={viewModel.saveMessage === 'Game Saved!'}
          class:text-error={viewModel.saveMessage === 'Save failed'}
        >
          {viewModel.saveMessage}
        </p>
      {/if}

      <button
        type="button"
        class="btn btn-outline btn-block"
        onclick={() => viewModel.goToSettings()}
      >
        Settings
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-block text-error"
        onclick={() => viewModel.quitToMainMenu()}
      >
        Quit to Main Menu
      </button>
    </div>

    <p class="mt-4 text-center text-xs text-base-content/50">Press Escape to resume</p>
  </div>
</div>
