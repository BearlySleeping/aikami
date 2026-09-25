<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte
import type { PauseMenuViewModelInterface } from './pause_menu_view_model.svelte';

type Props = {
  viewModel: PauseMenuViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="game-pause-scrim pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    aria-label="Pause Menu"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    viewModel.resumeGame();
    return;
  }
  // Focus trap — Tab/Shift+Tab cycle within the dialog
  if (e.key === 'Tab') {
    e.preventDefault();
    const focusable = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      return;
    }
    const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
    const direction = e.shiftKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
    focusable[nextIndex].focus();
  }
}}
  >
    <div
      class="game-surface game-pause-panel w-full max-w-sm p-5 shadow-xl"
      data-testid="pause-menu"
    >
      {#if viewModel.confirmingQuit}
        <h2 class="game-section-title text-center">Quit to Main Menu?</h2>
        <p class="mt-2 text-center text-sm text-base-content/70">
          Your campaign and existing local saves stay on this device. Changes since the last save
          may not be available when you return.
        </p>

        <div class="mt-6 space-y-3">
          <button
            type="button"
            class="btn game-control--neutral btn-block"
            onclick={() => viewModel.confirmQuit()}
          >
            Quit
          </button>

          <button
            type="button"
            class="btn btn-outline btn-block"
            onclick={() => viewModel.cancelQuit()}
          >
            Cancel
          </button>
        </div>
      {:else}
        <h2 class="game-section-title text-center">Paused</h2>

        <div class="mt-5 space-y-2">
          <button
            type="button"
            class="btn game-control--accent btn-block"
            onclick={() => viewModel.resumeGame()}
          >
            Resume
          </button>

          <button
            type="button"
            class="btn game-control--quiet btn-block"
            disabled={viewModel.isSaving}
            onclick={() => viewModel.saveGame()}
          >
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              Saving…
            {:else}
              Save now
            {/if}
          </button>

          <p class="game-pause-save-status text-center text-sm" role="status" aria-live="polite">
            {viewModel.saveStatusLabel}
          </p>

          <button
            type="button"
            class="btn game-control--quiet btn-block"
            onclick={() => viewModel.goToSettings()}
          >
            Settings
          </button>

          <!-- C-528: HUD customization opens the paused editor. -->
          <button
            type="button"
            class="btn game-control--quiet btn-block"
            data-testid="pause-customize-hud"
            disabled={!viewModel.isHudEditorEnabled}
            onclick={() => viewModel.openHudEditor()}
          >
            Customize HUD
          </button>

          <button
            type="button"
            class="btn game-control--quiet btn-block"
            onclick={() => viewModel.openEndSession()}
          >
            End Session
          </button>

          <button
            type="button"
            class="btn game-control--quiet btn-block"
            onclick={() => viewModel.requestQuit()}
          >
            Quit to Main Menu
          </button>
        </div>
      {/if}

      <p class="mt-4 text-center text-xs text-base-content/60">Press Escape to resume</p>
    </div>
  </div>
</BaseViewModelContainer>
