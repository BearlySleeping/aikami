<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay.svelte
//
// Optional in-game active-quest mini overlay. Shows the current quest title,
// description, and per-objective progress. Mirrors the music player overlay
// pattern — visibility is persisted (default on) and toggled from
// Settings > Gameplay or hidden via the ✕ button.

import { BaseViewModelContainer } from '$components';
import {
  getQuestOverlayViewModel,
  type QuestOverlayViewModelInterface,
} from './quest_overlay_view_model.svelte';

type Props = {
  viewModel?: QuestOverlayViewModelInterface;
};

const { viewModel = getQuestOverlayViewModel({ className: 'QuestOverlayVM' }) }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.visible}
    <section
      class="pointer-events-auto absolute top-16 right-3 z-40 flex w-80 flex-col gap-2 rounded-xl border border-base-content/10 bg-base-200/90 p-3 shadow-2xl backdrop-blur-md"
      aria-label="Active quest"
      data-testid="quest-overlay"
    >
      <!-- Header: quest title + hide -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p
            class="truncate text-sm font-bold text-primary {viewModel.hasActiveQuest
              ? ''
              : 'text-base-content/40'}"
            title={viewModel.questTitle}
          >
            📜 {viewModel.questTitle}
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-circle shrink-0"
          onclick={() => viewModel.hide()}
          aria-label="Hide quest overlay"
          title="Hide quest overlay"
        >
          ✕
        </button>
      </div>

      {#if viewModel.hasActiveQuest}
        <!-- Description -->
        <p class="text-[11px] leading-snug text-base-content/60">
          {viewModel.questDescription}
        </p>

        <!-- Objectives -->
        <ul class="flex flex-col gap-1">
          {#each viewModel.objectives as objective}
            {@const isComplete =
              objective.status === 'completed' ||
              (objective.status !== 'failed' && objective.current >= objective.max)}
            {@const isCurrent = objective === viewModel.objectives[viewModel.currentObjectiveIndex]}
            <li
              class="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] leading-snug {isCurrent
                ? 'bg-primary/10 ring-1 ring-primary/30'
                : ''} {isComplete ? 'text-base-content/40 line-through' : 'text-base-content/80'}"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span class="shrink-0" aria-hidden="true">
                {#if objective.status === 'failed'}
                  ✖
                {:else if isComplete}
                  ✓
                {:else if objective.status === 'locked'}
                  🔒
                {:else}
                  ◌
                {/if}
              </span>
              <span class="min-w-0 flex-1">{objective.label}</span>
              {#if objective.max > 1 && objective.status !== 'locked'}
                <span class="shrink-0 tabular-nums text-base-content/50">
                  {objective.current}/{objective.max}
                </span>
              {/if}
            </li>
          {/each}
        </ul>

        <!-- Current objective progress bar (counters only) -->
        {#if viewModel.currentObjectiveIndex >= 0 && viewModel.currentObjectivePercent > 0 && viewModel.currentObjectivePercent < 100}
          <div
            class="h-1 w-full overflow-hidden rounded-full bg-base-content/10"
            role="progressbar"
            aria-valuenow={viewModel.currentObjectivePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              class="h-full rounded-full bg-primary transition-all"
              style="width: {viewModel.currentObjectivePercent}%"
            ></div>
          </div>
        {/if}
      {:else}
        <p class="text-[11px] text-base-content/40">
          No active quest — talk to Elder Thalia in the village to get started.
        </p>
      {/if}
    </section>
  {/if}
</BaseViewModelContainer>
