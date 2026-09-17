<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay.svelte
//
// Optional in-game active-quest mini overlay. Shows the current quest title,
// description, and per-objective progress. Mirrors the music player overlay
// pattern — visibility is persisted (default on) and toggled from
// Settings > Gameplay or hidden via the ✕ button.

import { BaseViewModelContainer } from '$components';
import { getQuestOverlayViewModel } from './quest_overlay_composition.ts';
import type { QuestOverlayViewModelInterface } from './quest_overlay_view_model.svelte';

type Props = {
  viewModel?: QuestOverlayViewModelInterface;
};

const { viewModel = getQuestOverlayViewModel({ className: 'QuestOverlayVM' }) }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.visible}
    <!-- Geometry is owned by the HUD objective slot (C-527 Directive 7), so the
         card itself carries no viewport coordinates. -->
    <section
      class="hud-objective pointer-events-auto"
      aria-label="Active quest"
      data-testid="quest-overlay"
      data-sampled-truth={viewModel.sampledTruthId ?? undefined}
    >
      <!-- Header: quest title + hide -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p
            class="hud-objective__title truncate {viewModel.hasActiveQuest
              ? ''
              : 'text-muted-content'}"
            title={viewModel.questTitle}
          >
            {viewModel.questTitle}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-circle shrink-0"
          onclick={() => viewModel.hide()}
          disabled={viewModel.awaitingEndingChoice}
          aria-label="Hide quest overlay"
          title={viewModel.awaitingEndingChoice
            ? 'Decide the outcome before dismissing'
            : 'Hide quest overlay'}
        >
          ✕
        </button>
      </div>

      {#if viewModel.hasActiveQuest}
        <!-- Description -->
        <p class="game-metadata leading-snug">
          {viewModel.questDescription}
        </p>

        {#if viewModel.hasEndingOptions}
          <fieldset class="flex flex-col gap-1" data-testid="quest-ending-options">
            <legend
              class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-base-content/60"
            >
              Decide the outcome
            </legend>
            {#each viewModel.endingOptions as ending}
              <button
                type="button"
                class={ending.buttonClass}
                disabled={ending.disabled}
                aria-pressed={ending.selected}
                data-ending-id={ending.id}
                onclick={() => viewModel.selectEnding(ending.id)}
              >
                <span>{ending.title}</span>
                <span class="text-[10px] opacity-60">{ending.statusLabel}</span>
              </button>
            {/each}
          </fieldset>
        {/if}

        <!-- Objectives -->
        <ul class="flex flex-col gap-1">
          {#each viewModel.objectives as objective}
            {@const isComplete =
              objective.status === 'completed' ||
              (objective.status !== 'failed' && objective.current >= objective.max)}
            {@const isCurrent = objective === viewModel.objectives[viewModel.currentObjectiveIndex]}
            <li
              class="hud-objective__row {isCurrent
                ? 'hud-objective__row--active'
                : ''} {isComplete ? 'text-muted-content line-through' : ''}"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span class="shrink-0" aria-hidden="true">
                {#if objective.status === 'failed'}
                  ×
                {:else if isComplete}
                  ✓
                {:else if objective.status === 'locked'}
                  –
                {:else}
                  •
                {/if}
              </span>
              <span class="min-w-0 flex-1">{objective.label}</span>
              {#if objective.max > 1 && objective.status !== 'locked'}
                <span class="shrink-0 game-numeric text-muted-content">
                  {objective.current}/{objective.max}
                </span>
              {/if}
            </li>
          {/each}
        </ul>

        <!-- Current objective progress bar (counters only) -->
        {#if viewModel.currentObjectiveIndex >= 0 && viewModel.currentObjectivePercent > 0 && viewModel.currentObjectivePercent < 100}
          <div
            class="hud-objective__progress"
            role="progressbar"
            aria-valuenow={viewModel.currentObjectivePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style="inline-size: {viewModel.currentObjectivePercent}%"></span>
          </div>
        {/if}
      {:else}
        <p class="game-metadata">
          No active quest — talk to Elder Thalia in the village to get started.
        </p>
      {/if}
    </section>
  {/if}
</BaseViewModelContainer>
