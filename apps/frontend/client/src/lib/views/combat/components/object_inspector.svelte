<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/object_inspector.svelte
//
// Authored-object inspector for a v2 encounter (C-531 AC-1, AC-2, AC-4, AC-8).
//
// The panel is a pure render of the ViewModel's projection: the object list,
// the availability the ENGINE reported (with the reason an action is
// unavailable), the engine's forecast for the chosen action, and the two
// explicit controls — Confirm and Cancel. Nothing here computes a mechanic, and
// nothing commits without the player pressing Confirm.
//
// Accessibility (AC-8): every object and action is a real button (keyboard
// reachable), the selected action is marked with aria-pressed, and the
// hazard/cover state is written out as text as well as colour.
//
// Contract: C-531 AC-1, AC-2, AC-4, AC-8

import type { CombatViewModelInterface } from '../combat_view_model.svelte.ts';

type Props = {
  viewModel: CombatViewModelInterface;
};

const { viewModel }: Props = $props();

/** Text equivalent for the cover vocabulary — colour is never the only signal. */
const coverLabel = (cover: 'none' | 'half' | 'full'): string =>
  cover === 'none' ? 'no cover' : `${cover} cover`;

/** Renders the engine's check forecast as a readable line. */
const checkSummary = (): string => {
  const check = viewModel.inspectorPreview?.checkOutcome;
  if (check === null || check === undefined) {
    return 'No check — this action always succeeds.';
  }
  if (!check.modifierAvailable) {
    return `Requires ${check.category} (DC ${check.dc}); your sheet has no ${check.modifierSource} modifier.`;
  }
  return `${check.category} (DC ${check.dc}) with ${check.modifier >= 0 ? '+' : ''}${check.modifier} — ${Math.round(check.successOdds * 100)}% chance.`;
};
</script>

{#if viewModel.inspectedObjects.length > 0}
  <div
    class="border-b border-base-300 px-3 py-2"
    data-testid="combat-object-inspector"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/60">
        Objects
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={() => viewModel.refreshObjectInspector()}
        data-testid="combat-object-refresh"
      >
        Refresh
      </button>
    </div>

    <ul class="flex flex-col gap-1">
      {#each viewModel.inspectedObjects as object (object.objectId)}
        <li>
          <button
            type="button"
            class="w-full rounded px-2 py-1 text-left text-xs hover:bg-base-200"
            class:bg-base-200={viewModel.inspectedObjectId === object.objectId}
            aria-pressed={viewModel.inspectedObjectId === object.objectId}
            onclick={() => viewModel.selectInspectedObject(object.objectId)}
            data-testid="combat-object-{object.objectId}"
          >
            <span class="font-medium">{object.name}</span>
            <span class="ml-1 text-base-content/50">
              ({object.state}{object.ignited ? ', burning' : ''}, {coverLabel(object.cover)})
            </span>
          </button>

          {#if viewModel.inspectedObjectId === object.objectId}
            <ul class="mt-1 mb-2 ml-2 flex flex-col gap-1">
              {#each object.affordances as affordance (affordance.affordanceId)}
                <li>
                  <button
                    type="button"
                    class="btn btn-xs w-full justify-start"
                    class:btn-primary={viewModel.inspectorPreview?.affordanceId ===
                      affordance.affordanceId}
                    aria-pressed={viewModel.inspectorPreview?.affordanceId ===
                      affordance.affordanceId}
                    disabled={!affordance.available}
                    onclick={() => viewModel.previewInspectedAction(affordance.affordanceId)}
                    data-testid="combat-object-action-{affordance.affordanceId}"
                  >
                    {affordance.name}
                    <span class="ml-1 text-base-content/50">({affordance.actionCost})</span>
                    {#if !affordance.available}
                      <span class="ml-1 text-base-content/40">— unavailable</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>

    {#if viewModel.inspectorPreview}
      <div
        class="mt-2 rounded bg-base-200 p-2 text-xs"
        data-testid="combat-object-preview"
      >
        <p class="font-medium">{checkSummary()}</p>
        {#if viewModel.inspectorPreview.impactCells.length > 0}
          <p class="mt-1 text-base-content/60">
            Affects {viewModel.inspectorPreview.impactCells.length} cell(s).
          </p>
        {/if}
        {#if viewModel.inspectorPreview.effects.length > 0}
          <ul class="mt-1 list-disc pl-4 text-base-content/60">
            {#each viewModel.inspectorPreview.effects as effect, index (index)}
              <li>{effect.change.replace(/([A-Z])/g, ' $1').toLowerCase()}</li>
            {/each}
          </ul>
        {/if}
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            class="btn btn-primary btn-xs"
            onclick={() => viewModel.confirmInspectedAction()}
            data-testid="combat-object-confirm"
          >
            Confirm
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            onclick={() => viewModel.cancelInspectedAction()}
            data-testid="combat-object-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}

    {#if viewModel.inspectorRejectionKey}
      <p class="mt-2 text-xs text-error" data-testid="combat-object-rejection">
        That action is not available right now.
      </p>
    {/if}
  </div>
{/if}
