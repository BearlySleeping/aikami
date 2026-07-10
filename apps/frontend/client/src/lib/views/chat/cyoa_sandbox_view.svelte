<script lang="ts">
// apps/frontend/client/src/lib/views/chat/cyoa_sandbox_view.svelte
//
// Zero-logic view for the CYOA dev sandbox — mock GM narrative with
// choice buttons, selection feedback, and choice history display.
//
// Contract: C-245 CYOA Choices Branching Narrative

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ChoiceButtonsView from './choice_buttons_view.svelte';
import type { CyoaSandboxViewModelInterface } from './cyoa_sandbox_view_model.svelte.ts';

type Props = {
  viewModel: CyoaSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
    <h1 class="text-xl font-bold">CYOA Choices Sandbox</h1>
    <p class="text-sm text-base-content/60">
      C-245: choice buttons with skill-check badges, truncation, single-choice "Continue",
      dismissal, and per-chat history tracking.
    </p>

    <!-- Mock GM message -->
    <div class="chat chat-start">
      <div class="chat-bubble" data-testid="cyoa-sandbox-narrative">{viewModel.narrative}</div>
    </div>

    <!-- CYOA choice buttons -->
    <ChoiceButtonsView viewModel={viewModel.choiceButtonsViewModel} />

    <!-- Selection feedback -->
    {#if viewModel.lastSelectedLabel}
      <div class="alert alert-success" data-testid="cyoa-sandbox-selected">
        <span>Selected: {viewModel.lastSelectedLabel}</span>
      </div>
    {/if}

    <!-- Controls -->
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="btn btn-sm btn-outline"
        data-testid="cyoa-sandbox-load-mock"
        onclick={() => viewModel.loadMockChoices()}
      >
        Load 4 choices
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        data-testid="cyoa-sandbox-load-single"
        onclick={() => viewModel.loadSingleChoice()}
      >
        Load single choice
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        data-testid="cyoa-sandbox-load-empty"
        onclick={() => viewModel.loadEmptyChoices()}
      >
        Load empty (no-op)
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        data-testid="cyoa-sandbox-dismiss"
        onclick={() => viewModel.dismissChoices()}
      >
        Dismiss
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline btn-warning"
        data-testid="cyoa-sandbox-clear-history"
        onclick={() => viewModel.clearHistory()}
      >
        Clear history
      </button>
    </div>

    <!-- Choice history -->
    <div class="card bg-base-200">
      <div class="card-body p-4">
        <h2 class="card-title text-sm">Choice History</h2>
        {#if viewModel.history.length === 0}
          <p class="text-xs text-base-content/50" data-testid="cyoa-sandbox-history-empty">
            No choices recorded yet.
          </p>
        {:else}
          <ul class="list-disc list-inside text-sm" data-testid="cyoa-sandbox-history">
            {#each viewModel.history as entry (entry.choiceId)}
              <li>{entry.label}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <div data-testid="game-ready" class="hidden"></div>
  </div>
</BaseViewModelContainer>
