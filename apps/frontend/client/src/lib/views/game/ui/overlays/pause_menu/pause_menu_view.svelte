<script lang="ts">
import { BaseViewModelContainer } from '$components';
import DiceHistoryFeed from './dice_history_feed.svelte';
// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte
import type { PauseMenuViewModelInterface } from './pause_menu_view_model.svelte';

type Props = {
  viewModel: PauseMenuViewModelInterface;
};

const { viewModel }: Props = $props();

/** Ref to the Roll History trigger so focus can be restored when the dialog closes. */
let rollHistoryTrigger = $state<HTMLButtonElement | null>(null);
/** Tracks the previous open state so focus is only restored on an open→close transition. */
let wasRollHistoryOpen = false;

// Restore focus to the Roll History trigger when the history dialog closes,
// keeping keyboard navigation within the pause menu.
$effect(() => {
  const open = viewModel.isRollHistoryOpen;
  if (!open && wasRollHistoryOpen) {
    rollHistoryTrigger?.focus();
  }
  wasRollHistoryOpen = open;
});
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Pause Menu"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (viewModel.isRollHistoryOpen) {
        viewModel.closeRollHistory();
      } else {
        viewModel.resumeGame();
      }
      return;
    }
    // Focus trap — Tab/Shift+Tab cycle within the dialog
    if (e.key === 'Tab') {
      e.preventDefault();
      const focusable = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    <div class="w-72 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
      {#if viewModel.isRollHistoryOpen}
        <DiceHistoryFeed
          entries={viewModel.rollHistory}
          onClose={() => viewModel.closeRollHistory()}
        />
      {:else if viewModel.confirmingQuit}
        <h2 class="text-center text-lg font-bold text-base-content">Quit to Main Menu?</h2>
        <p class="mt-2 text-center text-sm text-base-content/60">
          Any unsaved progress will be lost.
        </p>

        <div class="mt-6 space-y-3">
          <button
            type="button"
            class="btn btn-error btn-block"
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
            class="btn btn-ghost btn-block"
            onclick={() => viewModel.openEndSession()}
          >
            End Session
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-block"
            onclick={() => viewModel.openReputation()}
          >
            Reputation
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-block"
            bind:this={rollHistoryTrigger}
            onclick={() => viewModel.openRollHistory()}
          >
            Roll History
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-block"
            onclick={() => viewModel.replayOnboarding()}
          >
            Replay Tutorial
          </button>

          <button
            type="button"
            class="btn btn-ghost btn-block text-error"
            onclick={() => viewModel.requestQuit()}
          >
            Quit to Main Menu
          </button>
        </div>
      {/if}

      <p class="mt-4 text-center text-xs text-base-content/50">Press Escape to resume</p>
    </div>
  </div>
</BaseViewModelContainer>
