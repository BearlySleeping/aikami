<script lang="ts">
// apps/frontend/client/src/lib/views/chat/choice_buttons_view.svelte
//
// Zero-logic view: CYOA choice buttons rendered as a DaisyUI join
// stack below the latest AI message. All state and logic lives in
// ChoiceButtonsViewModel.
//
// Contract: C-245 CYOA Choices Branching Narrative

import type { ChoiceButtonsViewModelInterface } from './choice_buttons_view_model.svelte.ts';

type Props = {
  viewModel: ChoiceButtonsViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.visible}
  <div class="join join-vertical w-full max-w-md" data-testid="cyoa-choices">
    {#each viewModel.items as item (item.id)}
      <div class="tooltip w-full" data-tip={item.tooltip || undefined}>
        <button
          type="button"
          class="btn join-item w-full justify-between gap-2 normal-case"
          data-testid="cyoa-choice-{item.id}"
          disabled={viewModel.disabled}
          onclick={() => viewModel.selectChoice(item.id)}
        >
          <span class="truncate text-left">{item.displayLabel}</span>
          {#if item.badgeText}
            <span class="badge badge-accent badge-sm shrink-0">{item.badgeText}</span>
          {/if}
        </button>
      </div>
    {/each}
  </div>
{/if}
