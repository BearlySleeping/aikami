<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/combat_objectives_panel.svelte
//
// Authored encounter objectives (Combat-08 AC-1).
//
// Presentation only: every row is already projected and perception-filtered by
// `utils/objective_panel.ts`, and a HIDDEN objective never reaches this
// component. Nothing here derives progress, decides a status, or reveals a
// deadline the encounter did not author.
//
// Accessibility (contract §"Authored objectives"): the panel is a labelled
// region, each row is a list item with a single screen-reader sentence, the
// deadline is stated in text (never colour alone), and the status is written
// out — a colour-blind or screen-reader player reads exactly what a sighted one
// sees.
//
// Contract: C-532 AC-1

import type { ObjectivePanelEntry } from '../utils/objective_panel.ts';

type Props = {
  objectives: ObjectivePanelEntry[];
};

const { objectives }: Props = $props();

const statusClass = (status: ObjectivePanelEntry['status']): string => {
  if (status === 'complete') {
    return 'text-success';
  }
  if (status === 'failed') {
    return 'text-error';
  }
  return 'text-base-content';
};

const statusIcon = (status: ObjectivePanelEntry['status']): string => {
  if (status === 'complete') {
    return '✓';
  }
  if (status === 'failed') {
    return '✕';
  }
  return '•';
};
</script>

{#if objectives.length > 0}
  <section
    class="rounded border border-base-300 bg-base-200/60 p-2"
    aria-labelledby="combat-objectives-heading"
    data-testid="combat-objectives-panel"
  >
    <h3
      id="combat-objectives-heading"
      class="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/70"
    >
      Objectives
    </h3>
    <ul class="space-y-1" aria-live="polite" data-testid="combat-objectives-list">
      {#each objectives as objective (objective.objectiveId)}
        <li
          class="text-xs {statusClass(objective.status)}"
          data-testid="combat-objective-{objective.objectiveId}"
          data-objective-status={objective.status}
        >
          <span class="sr-only">{objective.accessibleLabel}</span>
          <span aria-hidden="true" class="flex items-start gap-1">
            <span class="shrink-0 tabular-nums">{statusIcon(objective.status)}</span>
            <span class="flex-1">
              <span class="font-medium">{objective.label}</span>
              {#if objective.target !== null && objective.target > 1}
                <span class="tabular-nums text-base-content/70">
                  ({objective.progress}/{objective.target})
                </span>
              {/if}
              {#if objective.deadlineRound !== null}
                <span class="block text-base-content/60">
                  {objective.status === 'pending'
                    ? `Deadline: round ${objective.deadlineRound}`
                    : `Deadline was round ${objective.deadlineRound}`}
                </span>
              {/if}
              {#if objective.required}
                <span class="block text-base-content/60">Required</span>
              {/if}
            </span>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
