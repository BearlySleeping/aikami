<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu_overlay.svelte
import { gameOverlayService } from '$services';

type Props = {
  isSaving?: boolean;
  saveMessage?: string;
};

const { isSaving = false, saveMessage }: Props = $props();
</script>

<div
  class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Pause Menu"
  tabindex="-1"
  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { gameOverlayService.resumeGame(); } }}
>
  <div class="w-72 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
    <h2 class="text-center text-lg font-bold text-base-content">Paused</h2>

    <div class="mt-6 space-y-3">
      <button
        type="button"
        class="btn btn-primary btn-block"
        onclick={() => gameOverlayService.resumeGame()}
      >
        Resume Game
      </button>

      <button
        type="button"
        class="btn btn-outline btn-block"
        disabled={isSaving}
        onclick={() => gameOverlayService.saveGame()}
      >
        {#if isSaving}
          <span class="loading loading-spinner loading-xs"></span>
          Saving...
        {:else}
          Save Game
        {/if}
      </button>

      {#if saveMessage}
        <p
          class="text-center text-sm"
          class:text-success={saveMessage === 'Game Saved!'}
          class:text-error={saveMessage === 'Save failed'}
        >
          {saveMessage}
        </p>
      {/if}

      <button
        type="button"
        class="btn btn-outline btn-block"
        onclick={() => gameOverlayService.goToSettings()}
      >
        Settings
      </button>

      <button
        type="button"
        class="btn btn-outline btn-block"
        onclick={() => gameOverlayService.openReputation()}
      >
        Reputation
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-block text-error"
        onclick={() => gameOverlayService.quitToMainMenu()}
      >
        Quit to Main Menu
      </button>
    </div>

    <p class="mt-4 text-center text-xs text-base-content/50">Press Escape to resume</p>
  </div>
</div>
