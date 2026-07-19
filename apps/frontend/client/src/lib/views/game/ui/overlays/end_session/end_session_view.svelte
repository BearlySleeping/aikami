<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view.svelte
import type { EndSessionViewModelInterface } from './end_session_view_model.svelte';

type Props = {
  viewModel: EndSessionViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-base-300/80 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="End Session"
  tabindex="-1"
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      viewModel.cancel();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const focusable = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"]), [href]'
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
  <div class="w-96 rounded-xl border border-base-300 bg-base-200 p-6 shadow-xl">
    <!-- Phase: Confirm -->
    {#if viewModel.phase === 'confirm'}
      <h2 class="text-center text-lg font-bold text-base-content">End Session?</h2>

      <p class="mt-4 text-sm text-base-content/70">
        This will lock the chat, generate a summary of your session, and save your progress. You can
        start a new session afterward.
      </p>

      <div class="mt-6 flex gap-3">
        <button type="button" class="btn btn-outline flex-1" onclick={() => viewModel.cancel()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary flex-1"
          onclick={() => viewModel.confirmEndSession()}
        >
          End Session
        </button>
      </div>
    <!-- Phase: Summarizing -->
    {:else if viewModel.phase === 'summarizing'}
      <div class="flex flex-col items-center gap-4">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <h2 class="text-lg font-bold text-base-content">Generating Summary...</h2>
        <p class="text-sm text-base-content/70 text-center">
          Summing up your session of
          {viewModel.sessionNumber > 0 ? `Session ${viewModel.sessionNumber}` : 'this session'}.
        </p>
      </div>
    <!-- Phase: Preview -->
    {:else if viewModel.phase === 'preview'}
      <h2 class="text-center text-lg font-bold text-base-content">
        Session {viewModel.sessionNumber} Summary
      </h2>

      <div class="mt-4 rounded-lg bg-base-100 p-4 max-h-64 overflow-y-auto border border-base-300">
        {#if viewModel.summarySynopsis}
          <p class="text-sm text-base-content/90 whitespace-pre-wrap">
            {viewModel.summarySynopsis}
          </p>
        {/if}

        {#if viewModel.summaryKeyEvents.length > 0}
          <ul class="mt-3 space-y-1">
            {#each viewModel.summaryKeyEvents as event}
              <li class="text-xs text-base-content/60 flex items-start gap-1">
                <span class="text-primary mt-0.5">•</span>
                <span>{event}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if viewModel.messageCount > 0}
          <p class="mt-3 text-xs text-base-content/40 font-mono">
            {viewModel.messageCount}
            messages
          </p>
        {/if}
      </div>

      <div class="mt-6 space-y-3">
        <button
          type="button"
          class="btn btn-primary btn-block"
          disabled={viewModel.isStartingNew}
          onclick={() => viewModel.startNewSession()}
        >
          {#if viewModel.isStartingNew}
            <span class="loading loading-spinner loading-xs"></span>
            Starting...
          {:else}
            Start New Session
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-block text-base-content/50"
          disabled={viewModel.isStartingNew}
          onclick={() => viewModel.cancel()}
        >
          Return to Pause Menu
        </button>
      </div>
    <!-- Phase: Locked (fallback if preview not available) -->
    {:else if viewModel.phase === 'locked'}
      <h2 class="text-center text-lg font-bold text-base-content">
        Session {viewModel.sessionNumber} Ended
      </h2>

      <p class="mt-4 text-sm text-base-content/70 text-center">
        Progress saved. Chat is now locked.
      </p>

      <div class="mt-6 space-y-3">
        <button
          type="button"
          class="btn btn-primary btn-block"
          disabled={viewModel.isStartingNew}
          onclick={() => viewModel.startNewSession()}
        >
          {#if viewModel.isStartingNew}
            <span class="loading loading-spinner loading-xs"></span>
            Starting...
          {:else}
            Start New Session
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-block text-base-content/50"
          disabled={viewModel.isStartingNew}
          onclick={() => viewModel.cancel()}
        >
          Return to Pause Menu
        </button>
      </div>
    {/if}
  </div>
</div>
