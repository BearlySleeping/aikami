<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/combat_reaction_prompt.svelte
//
// Reaction decision surface (Combat-08 AC-4).
//
// Presentation only: the window, the reactor, the target, the ability and the
// consequence all come from the engine's own `COMBAT_REACTION_OPENED` event via
// the flow. Nothing here re-derives eligibility or invents a consequence.
//
// Accessibility (contract §"Player and AI policy"): the dialog is a labelled
// `role="dialog"` region, focus is moved to it when it opens, both choices are
// real buttons reachable by Tab, Escape declines, and there is NO default time
// limit — a timer only exists when the player enabled one, and when it does the
// remaining seconds are announced in text rather than conveyed by colour.
//
// Contract: C-532 AC-4

import { BaseViewModelContainer } from '$components';
import type { CombatReactionFlowViewModelInterface } from '../combat_reaction_flow.svelte.ts';

type Props = {
  viewModel: CombatReactionFlowViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="contents">
  {#if viewModel.isAwaitingPlayer && viewModel.prompt}
    {@const prompt = viewModel.prompt}
    <div class="px-3 pt-3">
      <div
        bind:this={viewModel.dialogElement}
        class="rounded border border-warning/40 bg-warning/10 p-3"
        role="dialog"
        aria-modal="false"
        aria-labelledby="combat-reaction-heading"
        aria-describedby="combat-reaction-consequence"
        tabindex="-1"
        data-testid="combat-reaction-prompt"
        onkeydown={(event) => viewModel.handleKeydown(event)}
      >
        <h3 id="combat-reaction-heading" class="text-xs font-semibold text-warning">
          Reaction available
        </h3>
        <p id="combat-reaction-consequence" class="mt-1 text-xs text-base-content">
          {prompt.consequence}
        </p>
        <dl class="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
          <dt class="text-base-content/60">Reactor</dt>
          <dd data-testid="combat-reaction-reactor">{prompt.reactorName}</dd>
          <dt class="text-base-content/60">Target</dt>
          <dd data-testid="combat-reaction-target">{prompt.targetName}</dd>
          <dt class="text-base-content/60">Ability</dt>
          <dd data-testid="combat-reaction-ability">{prompt.abilityName}</dd>
          <dt class="text-base-content/60">Cost</dt>
          <dd data-testid="combat-reaction-cost">{viewModel.costLabel}</dd>
        </dl>
        {#if viewModel.timerLabel !== null}
          <p class="mt-2 text-xs text-base-content/70" data-testid="combat-reaction-timer">
            {viewModel.timerLabel}
          </p>
        {/if}
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            class="btn btn-warning btn-xs"
            onclick={() => viewModel.accept()}
            data-testid="combat-reaction-accept"
          >
            Take the reaction
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            onclick={() => viewModel.decline()}
            data-testid="combat-reaction-decline"
          >
            Decline (Esc)
          </button>
        </div>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
