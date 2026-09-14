<!--
  apps/frontend/client/src/lib/views/combat/components/companion_control_panel.svelte

  Companion control modes + the approval surface (C-526 AC-6).

  Views are logicless: every value here comes from the ViewModel and every
  interaction delegates to it. Nothing in this component commits a command — the
  Approve button calls `approveCompanionPlan()`, which is the only path that
  reaches the engine, and it is reachable only from an explicit click.

  Contract: C-526 AC-6
-->
<script lang="ts">
import type { CompanionControlMode } from '@aikami/types';
import type { CombatViewModelInterface } from '../combat_view_model.svelte';

type Props = { viewModel: CombatViewModelInterface };

let { viewModel }: Props = $props();

/**
 * The four §12.5 modes, with the wording the player sees.
 *
 * Order matters: Direct → Suggest → Intent → Autonomous matches the contract's
 * table and the docs page.
 */
const MODES: Array<{ mode: CompanionControlMode; label: string; hint: string }> = [
  { mode: 'direct', label: 'Direct', hint: 'You control every action' },
  { mode: 'suggest', label: 'Suggest', hint: 'Companion proposes; you approve' },
  { mode: 'intent', label: 'Intent', hint: 'Standing goal; you still approve' },
  { mode: 'autonomous', label: 'Autonomous', hint: 'Companion decides; you confirm' },
];
</script>

{#if viewModel.companionControls.length > 0}
  <div class="space-y-2" data-testid="companion-control-panel">
    {#each viewModel.companionControls as companion (companion.combatantId)}
      <div
        class="rounded-box border border-base-content/15 bg-base-200/40 p-2"
        data-testid={`companion-mode-${companion.combatantId}`}
      >
        <p class="text-xs font-semibold text-base-content/80">{companion.name}</p>

        <!--
          A native radio group: keyboard/pointer reachable and correctly
          announced without hand-rolled ARIA. The visible label is the radio's
          own <label>, so the control and the text cannot drift apart.
        -->
        <fieldset class="mt-1 flex flex-wrap gap-1 border-0 p-0">
          <legend class="sr-only">{companion.name} control mode</legend>
          {#each MODES as option (option.mode)}
            <label
              class="btn btn-xs {companion.mode === option.mode
                ? 'btn-primary'
                : 'btn-ghost border border-base-content/20'}"
              title={option.hint}
            >
              <input
                type="radio"
                name={`companion-mode-${companion.combatantId}`}
                class="sr-only"
                checked={companion.mode === option.mode}
                onchange={() =>
                  viewModel.setCompanionMode({
                    combatantId: companion.combatantId,
                    mode: option.mode,
                    intent: viewModel.companionIntentDraft({
                      combatantId: companion.combatantId,
                      persistedIntent: companion.intent,
                    }),
                  })}
                data-testid={`companion-mode-${companion.combatantId}-${option.mode}`}
              >
              {option.label}
            </label>
          {/each}
        </fieldset>

        {#if companion.mode === 'intent'}
          <form
            class="mt-1 flex gap-1"
            onsubmit={(event: SubmitEvent) => {
              event.preventDefault();
              viewModel.setCompanionMode({
                combatantId: companion.combatantId,
                mode: 'intent',
                intent: viewModel.companionIntentDraft({
                  combatantId: companion.combatantId,
                  persistedIntent: companion.intent,
                }),
              });
            }}
          >
            <input
              type="text"
              class="input input-bordered input-xs flex-1"
              placeholder="Standing goal, e.g. protect Mara"
              aria-label={`${companion.name} standing goal`}
              value={viewModel.companionIntentDraft({
                combatantId: companion.combatantId,
                persistedIntent: companion.intent,
              })}
              oninput={(event: Event) => {
                const value = (event.currentTarget as HTMLInputElement).value;
                viewModel.setCompanionIntentDraft({
                  combatantId: companion.combatantId,
                  intent: value,
                });
              }}
              data-testid={`companion-intent-${companion.combatantId}`}
            >
            <button
              type="submit"
              class="btn btn-xs"
              data-testid={`companion-intent-save-${companion.combatantId}`}
            >
              Set
            </button>
          </form>
          {#if companion.intent.length > 0}
            <p
              class="mt-1 text-xs text-base-content/60"
              data-testid={`companion-intent-current-${companion.combatantId}`}
            >
              Goal: {companion.intent}
            </p>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}

<!--
  The proposal. Same shape and numbers as the player's own language preview,
  because it is the same compiled plan type — the companion's plan is a plan,
  not a special case.
-->
{#if viewModel.companionProposal !== null}
  {@const proposal = viewModel.companionProposal}
  <div
    class="space-y-1 rounded-box border border-accent/40 bg-accent/5 p-2"
    data-testid="companion-proposal"
  >
    <p class="text-xs font-semibold text-base-content/80" aria-live="polite">
      {viewModel.displayNameForCombatant(proposal.combatantId)}
      proposes: {proposal.preview.commandKind}
      {#if proposal.preview.destination !== null}
        → ({proposal.preview.destination.x}, {proposal.preview.destination.y})
      {/if}
    </p>
    {#if proposal.intent.length > 0}
      <p class="text-xs text-base-content/60" data-testid="companion-proposal-goal">
        Goal: {proposal.intent}
      </p>
    {/if}
    <p class="text-xs text-base-content/70" data-testid="companion-proposal-costs">
      {#if proposal.preview.movementCost !== null}
        Cost {proposal.preview.movementCost} cell(s)
      {/if}
      {#if proposal.preview.hitPercentage !== null}
        · {proposal.preview.hitPercentage}% to hit
      {/if}
      {#if proposal.preview.damageMinimum !== null}
        · {proposal.preview.damageMinimum}–{proposal.preview.damageMaximum}
        dmg
      {/if}
    </p>
    {#if proposal.preview.warnings.length > 0}
      <p class="text-xs text-warning" data-testid="companion-proposal-warnings">
        {proposal.preview.warnings.join(' · ')}
      </p>
    {/if}

    <!-- Edit: re-point the plan and re-preview it. Nothing is committed. -->
    {#if proposal.preview.commandKind === 'useAbility'}
      <div class="flex flex-wrap gap-1" data-testid="companion-proposal-targets">
        {#each proposal.targets as target (target.combatantId)}
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.editCompanionTarget(target.combatantId)}
            data-testid={`companion-target-${target.combatantId}`}
          >
            {target.name}
          </button>
        {/each}
      </div>
    {:else if proposal.preview.commandKind === 'move'}
      <div class="flex flex-wrap gap-1" data-testid="companion-proposal-approaches">
        {#each ['melee', 'reach', 'ranged'] as const as band (band)}
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.editCompanionApproach(band)}
            data-testid={`companion-approach-${band}`}
          >
            {band}
          </button>
        {/each}
      </div>
    {/if}

    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-primary btn-xs flex-1"
        onclick={() => viewModel.approveCompanionPlan()}
        data-testid="companion-approve"
      >
        Approve
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-xs flex-1"
        onclick={() => viewModel.declineCompanionPlan()}
        data-testid="companion-decline"
      >
        Decline
      </button>
    </div>
  </div>
{:else if viewModel.companionDecisionStatus === 'partially_committed'}
  <p class="text-xs text-base-content/60" data-testid="companion-partial" aria-live="polite">
    Step committed. The remaining steps need your approval.
  </p>
{:else if viewModel.companionDecisionStatus === 'declined'}
  <p class="text-xs text-base-content/50" data-testid="companion-declined" aria-live="polite">
    Companion plan declined — the companion falls back to holding position.
  </p>
{/if}
