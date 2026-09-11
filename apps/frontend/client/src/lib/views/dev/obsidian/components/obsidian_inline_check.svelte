<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_inline_check.svelte
//
// The inline check card. One authoritative record, three visual phases
// (pending / rolling / resolved). The roll never occupies the screen, never
// re-rolls once committed, and keeps its modifiers inspectable.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';
import type { ObsidianCheck } from '../obsidian_types';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
  check: ObsidianCheck;
};

const { viewModel, check }: Props = $props();
</script>

<article
  class="my-2 rounded-xl border border-brass/30 bg-elevated p-3"
  data-testid="inline-check"
  data-check-phase={check.phase}
>
  <header class="flex items-start gap-2">
    <span class="font-display text-sm text-base-content">{check.label}</span>
    <span class="ml-auto shrink-0 text-xs uppercase tracking-wide text-brass">
      {viewModel.checkPhaseLabel(check)}
    </span>
  </header>

  <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-base-content/70">
    <div class="flex gap-1">
      <dt>{viewModel.checkDisplay(check).abilityLabel}</dt>
      <dd class="font-mono text-base-content">
        {viewModel.checkDisplay(check).abilityModifierLabel}
      </dd>
    </div>
    <div class="flex gap-1">
      <dt>Proficiency</dt>
      <dd class="font-mono text-base-content">
        {viewModel.checkDisplay(check).proficiencyLabel}
      </dd>
    </div>
    <div class="flex gap-1">
      <dt>Bonus</dt>
      <dd class="font-mono text-base-content">{viewModel.checkDisplay(check).modifierLabel}</dd>
    </div>
    <div class="flex gap-1">
      <dt>Difficulty</dt>
      <dd class="font-mono text-base-content">{viewModel.checkDisplay(check).dcLabel}</dd>
    </div>
  </dl>

  {#if check.phase === 'pending'}
    <div class="mt-2 flex flex-col gap-1 text-xs text-base-content/60">
      <span>Success: {check.stakes.success}</span>
      <span>On failure: {check.stakes.failure}</span>
    </div>
    <button
      type="button"
      class="btn btn-primary btn-sm mt-2"
      data-testid="roll-check"
      onclick={() => void viewModel.rollActiveCheck()}
    >
      Roll d20 {viewModel.checkDisplay(check).modifierLabel} · need
      {viewModel.checkDisplay(check)
        .targetLabel}
      or higher
    </button>
    <p class="mt-1 text-[11px] text-base-content/45">{viewModel.skillCheckNote}</p>
  {:else if check.phase === 'rolling'}
    <div class="mt-2 flex items-center gap-2" data-testid="check-rolling">
      <span
        class="d20-pending flex h-10 w-10 items-center justify-center rounded-lg border border-brass/40 bg-ink font-mono text-lg font-bold text-base-content/70"
      >
        ?
      </span>
      <span class="text-xs text-base-content/60">The die tumbles…</span>
    </div>
  {:else}
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <span
        class="flex h-10 w-10 items-center justify-center rounded-lg border font-mono text-lg font-bold"
        class:border-success={check.isSuccess === true}
        class:text-success={check.isSuccess === true}
        class:border-error={check.isSuccess === false}
        class:text-error={check.isSuccess === false}
        data-testid="check-natural"
      >
        {check.natural}
      </span>
      <span class="font-mono text-sm text-base-content">
        {viewModel.checkDisplay(check).modifierLabel}
      </span>
      <span class="font-mono text-base-content/60">= {check.total}</span>
      <span class="font-mono text-xs text-base-content/60"
        >{viewModel.checkDisplay(check).dcLabel}</span
      >
      <span
        class="ml-auto text-sm font-bold"
        class:text-success={check.isSuccess === true}
        class:text-error={check.isSuccess === false}
      >
        {check.isSuccess ? '✓ Success' : '✗ Failure'}
      </span>
    </div>
  {/if}
</article>
