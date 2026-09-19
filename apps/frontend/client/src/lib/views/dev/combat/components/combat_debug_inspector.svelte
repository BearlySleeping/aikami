<script lang="ts">
// apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_inspector.svelte
//
// Inspector pane for the combat debug workspace. A keyboard-operable tablist
// selects the active inspector, and each tab renders its read-only projection
// as a definition list. The assertions section surfaces detected dev
// assertion violations (never auto-repaired) and reports explicitly when the
// list is empty so "no violations" is never confused with "not evaluated".
//
// Zero logic: the tablist delegates selection to `viewModel.setTab`; every
// rendered value is a direct property access on the ViewModel.
//
// Contract: combat debug workspace (execution plan §3, §5)

import type { CombatDebugViewModelInterface } from '../combat_debug_view_model.svelte.ts';

type Props = {
  viewModel: CombatDebugViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<section class="flex h-full min-h-0 flex-col bg-base-100" data-testid="combat-debug-inspector">
  <div
    class="tabs tabs-box bg-base-200 overflow-x-auto"
    role="tablist"
    aria-label="Combat debug inspectors"
  >
    {#each viewModel.tabOptions as tab (tab)}
      <button
        type="button"
        class="tab tab-sm"
        class:tab-active={viewModel.activeTab === tab}
        role="tab"
        aria-selected={viewModel.activeTab === tab}
        onclick={() => viewModel.setTab(tab)}
        data-testid={`combat-debug-tab-${tab}`}
      >
        {tab}
      </button>
    {/each}
  </div>

  <div class="flex-1 overflow-y-auto p-3 space-y-4">
    {#if viewModel.activeTab === 'context'}
      <div data-testid="combat-debug-panel-context">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">
          Context
        </h3>
        {#if viewModel.contextSummary}
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt class="text-base-content/50">Run id</dt>
            <dd class="font-mono break-all">{viewModel.contextSummary.runId}</dd>
            <dt class="text-base-content/50">Encounter</dt>
            <dd class="font-mono break-all">{viewModel.contextSummary.encounterId}</dd>
            <dt class="text-base-content/50">Rules version</dt>
            <dd class="font-mono">{viewModel.contextSummary.rulesVersion}</dd>
            <dt class="text-base-content/50">Schema version</dt>
            <dd class="font-mono">{viewModel.contextSummary.schemaVersion}</dd>
            <dt class="text-base-content/50">Revision</dt>
            <dd class="font-mono">{viewModel.contextSummary.revision}</dd>
            <dt class="text-base-content/50">Round</dt>
            <dd class="font-mono">{viewModel.contextSummary.round}</dd>
            <dt class="text-base-content/50">Phase</dt>
            <dd class="font-mono">{viewModel.contextSummary.phase}</dd>
            <dt class="text-base-content/50">Active combatant</dt>
            <dd class="font-mono">{viewModel.contextSummary.activeCombatantId}</dd>
            <dt class="text-base-content/50">Turn id</dt>
            <dd class="font-mono">{viewModel.contextSummary.turnId}</dd>
            <dt class="text-base-content/50">Seed</dt>
            <dd class="font-mono">{viewModel.contextSummary.seed}</dd>
            <dt class="text-base-content/50">Settlement</dt>
            <dd>{viewModel.contextSummary.settlementPresent ? 'present' : 'none'}</dd>
            <dt class="text-base-content/50">Outcome</dt>
            <dd>{viewModel.contextSummary.outcomePresent ? 'present' : 'none'}</dd>
          </dl>
          <h4 class="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-base-content/50">
            RNG streams
          </h4>
          <ul class="space-y-0.5 text-xs">
            {#each viewModel.contextSummary.rngStreams as stream (stream.name)}
              <li class="flex justify-between font-mono">
                <span>{stream.name}</span>
                <span class="text-base-content/50">seed {stream.seed} · state {stream.state}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-xs italic text-base-content/40">No live state observed yet.</p>
        {/if}
      </div>
    {/if}

    {#if viewModel.activeTab === 'actor'}
      <div data-testid="combat-debug-panel-actor">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">Actor</h3>
        {#if viewModel.actorSummary}
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt class="text-base-content/50">Id</dt>
            <dd class="font-mono break-all">{viewModel.actorSummary.combatantId}</dd>
            <dt class="text-base-content/50">Name</dt>
            <dd>{viewModel.actorSummary.name}</dd>
            <dt class="text-base-content/50">Team</dt>
            <dd class="font-mono">{viewModel.actorSummary.team}</dd>
            <dt class="text-base-content/50">HP</dt>
            <dd class="font-mono">{viewModel.actorSummary.hp}/{viewModel.actorSummary.maxHp}</dd>
            <dt class="text-base-content/50">Initiative</dt>
            <dd class="font-mono">{viewModel.actorSummary.initiative}</dd>
            <dt class="text-base-content/50">Position</dt>
            <dd class="font-mono">
              ({viewModel.actorSummary.position.x}, {viewModel.actorSummary.position.y})
            </dd>
            <dt class="text-base-content/50">Movement remaining</dt>
            <dd class="font-mono">{viewModel.actorSummary.movementRemaining}</dd>
            <dt class="text-base-content/50">Action available</dt>
            <dd>{viewModel.actorSummary.actionAvailable ? 'yes' : 'no'}</dd>
            <dt class="text-base-content/50">Quick action</dt>
            <dd>{viewModel.actorSummary.quickActionAvailable ? 'yes' : 'no'}</dd>
            <dt class="text-base-content/50">Reaction</dt>
            <dd>{viewModel.actorSummary.reactionAvailable ? 'yes' : 'no'}</dd>
            <dt class="text-base-content/50">Downed</dt>
            <dd>{viewModel.actorSummary.downed ? 'yes' : 'no'}</dd>
            <dt class="text-base-content/50">Defeated</dt>
            <dd>{viewModel.actorSummary.defeated ? 'yes' : 'no'}</dd>
            <dt class="text-base-content/50">Control mode</dt>
            <dd class="font-mono">{viewModel.actorSummary.controlMode}</dd>
          </dl>
          <h4 class="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-base-content/50">
            Abilities
          </h4>
          {#if viewModel.actorSummary.abilityIds.length > 0}
            <ul class="flex flex-wrap gap-1 text-xs">
              {#each viewModel.actorSummary.abilityIds as abilityId (abilityId)}
                <li class="badge badge-outline badge-sm font-mono">{abilityId}</li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs italic text-base-content/40">No abilities recorded.</p>
          {/if}
          {#if viewModel.actorSummary.participation}
            <h4 class="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-base-content/50">
              Participation
            </h4>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt class="text-base-content/50">Morale</dt>
              <dd class="font-mono">{viewModel.actorSummary.participation.morale}</dd>
              <dt class="text-base-content/50">Broken</dt>
              <dd>{viewModel.actorSummary.participation.broken ? 'yes' : 'no'}</dd>
            </dl>
          {:else}
            <p class="mt-3 text-xs italic text-base-content/40">No participation record.</p>
          {/if}
        {:else}
          <p class="text-xs italic text-base-content/40">No active actor to inspect.</p>
        {/if}
      </div>
    {/if}

    {#if viewModel.activeTab === 'objects'}
      <div data-testid="combat-debug-panel-objects">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">
          Objects
        </h3>
        {#if viewModel.objectsSummary}
          {#if viewModel.objectsSummary.objects.length > 0}
            <ul class="space-y-2 text-xs">
              {#each viewModel.objectsSummary.objects as object (object.objectId)}
                <li class="rounded border border-base-300 p-2">
                  <p class="font-mono font-semibold break-all">{object.objectId}</p>
                  <p class="text-base-content/50">
                    definition <span class="font-mono">{object.definitionId}</span> · state
                    <span class="font-mono">{object.state}</span>
                  </p>
                  <ul class="mt-1 space-y-0.5">
                    {#each object.affordances as affordance (affordance.affordanceId)}
                      <li class="flex justify-between">
                        <span class="font-mono">{affordance.affordanceId}</span>
                        <span class:text-success={affordance.available}>
                          {affordance.available ? 'available' : 'unavailable'}
                        </span>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs italic text-base-content/40">No battlefield objects.</p>
          {/if}

          <h4 class="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-base-content/50">
            Objectives
          </h4>
          {#if viewModel.objectsSummary.objectives.length > 0}
            <ul class="space-y-1 text-xs">
              {#each viewModel.objectsSummary.objectives as objective (objective.objectiveId)}
                <li class="flex flex-wrap justify-between gap-2 rounded border border-base-300 p-2">
                  <span class="font-mono break-all">{objective.objectiveId}</span>
                  <span class="text-base-content/50">
                    {objective.kind}
                    · progress {objective.progress}
                    {#if objective.required}
                      · required
                    {/if}
                    {#if objective.deadlineRound !== undefined}
                      · by round {objective.deadlineRound}
                    {/if}
                  </span>
                  <span>
                    {objective.satisfied === true ? 'satisfied' : 'not satisfied'}
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs italic text-base-content/40">No objectives declared.</p>
          {/if}
        {:else}
          <p class="text-xs italic text-base-content/40">No live state observed yet.</p>
        {/if}
      </div>
    {/if}

    {#if viewModel.activeTab === 'reactions'}
      <div data-testid="combat-debug-panel-reactions">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">
          Reactions
        </h3>
        {#if viewModel.reactionSummary}
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt class="text-base-content/50">Window id</dt>
            <dd class="font-mono break-all">{viewModel.reactionSummary.windowId}</dd>
            <dt class="text-base-content/50">Trigger</dt>
            <dd class="font-mono break-all">{viewModel.reactionSummary.trigger}</dd>
            <dt class="text-base-content/50">Current reactor</dt>
            <dd class="font-mono break-all">{viewModel.reactionSummary.currentReactorId}</dd>
            <dt class="text-base-content/50">Window version</dt>
            <dd class="font-mono">{viewModel.reactionSummary.windowVersion}</dd>
            <dt class="text-base-content/50">Policy</dt>
            <dd class="font-mono">{viewModel.reactionSummary.policy}</dd>
          </dl>
          <h4 class="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-base-content/50">
            Ordered reactors
          </h4>
          {#if viewModel.reactionSummary.orderedReactors.length > 0}
            <ol class="list-inside list-decimal space-y-0.5 text-xs font-mono">
              {#each viewModel.reactionSummary.orderedReactors as reactorId (reactorId)}
                <li>{reactorId}</li>
              {/each}
            </ol>
          {:else}
            <p class="text-xs italic text-base-content/40">No open reaction window.</p>
          {/if}
        {:else}
          <p class="text-xs italic text-base-content/40">No live state observed yet.</p>
        {/if}
      </div>
    {/if}

    {#if viewModel.activeTab === 'ai'}
      <div data-testid="combat-debug-panel-ai">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">AI</h3>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt class="text-base-content/50">Provider used</dt>
          <dd class="font-mono">{viewModel.aiSummary.providerUsedCount}</dd>
          <dt class="text-base-content/50">Degraded decisions</dt>
          <dd class="font-mono">{viewModel.aiSummary.degradedCount}</dd>
        </dl>
        {#if viewModel.aiSummary.records.length > 0}
          <ul class="mt-3 space-y-1 text-xs">
            {#each viewModel.aiSummary.records as record, index (index)}
              <li class="rounded border border-base-300 p-2">
                <p class="font-mono">
                  {record.commandId === undefined ? 'no command id' : record.commandId}
                </p>
                <p class="text-base-content/50">
                  owner <span class="font-mono">{record.controlOwner}</span> · provider
                  <span class="font-mono">{record.providerUsed ? 'used' : 'not used'}</span>
                  {#if record.failureCode !== undefined}
                    · failure <span class="font-mono">{record.failureCode}</span>
                  {/if}
                </p>
                {#if record.rationale !== undefined}
                  <p class="text-base-content/60">{record.rationale}</p>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="mt-3 text-xs italic text-base-content/40">No controller decisions recorded.</p>
        {/if}
      </div>
    {/if}

    {#if viewModel.activeTab === 'action'}
      <div data-testid="combat-debug-panel-action">
        <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">
          Last / pending action
        </h3>
        {#if viewModel.actionSummary}
          <dl class="space-y-1 text-xs">
            <dt class="text-base-content/50">Command id</dt>
            <dd class="font-mono break-all">{viewModel.actionSummary.commandId}</dd>
            <dt class="text-base-content/50">Acknowledgement</dt>
            <dd class="font-semibold">{viewModel.actionSummary.acknowledgement}</dd>
            <dt class="text-base-content/50">Grounded kind</dt>
            <dd class="font-mono">{viewModel.actionSummary.groundedKind}</dd>
            <dt class="text-base-content/50">Rejection code</dt>
            <dd class="font-mono text-error">{viewModel.actionSummary.rejectionCode}</dd>
            <dt class="text-base-content/50">Resulting revision</dt>
            <dd class="font-mono">{viewModel.actionSummary.resultingRevision}</dd>
          </dl>
          {#if viewModel.actionSummary.warnings.length > 0}
            <ul class="mt-2 space-y-1 text-xs">
              {#each viewModel.actionSummary.warnings as warning}
                <li class="rounded border border-warning/40 bg-warning/5 p-2">{warning}</li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="text-xs italic text-base-content/40">
            No command has been acknowledged or rejected in this run yet.
          </p>
        {/if}
      </div>
    {/if}

    <div class="border-t border-base-300 pt-3" data-testid="combat-debug-assertions">
      <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-base-content/50">
        Assertions
      </h3>
      {#if viewModel.assertions.length > 0}
        <ul class="space-y-1 text-xs">
          {#each viewModel.assertions as violation (violation.assertion + String(violation.revision))}
            <li class="rounded border border-error/40 bg-error/5 p-2" role="alert">
              <p class="font-mono font-semibold text-error">{violation.assertion}</p>
              <p class="text-base-content/70">{violation.detail}</p>
              <p class="text-base-content/50">
                revision <span class="font-mono">{violation.revision}</span> · command
                <span class="font-mono">
                  {violation.commandId === undefined ? 'none' : violation.commandId}
                </span>
              </p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs italic text-base-content/40" role="status">
          No assertion violations detected.
        </p>
      {/if}
    </div>
  </div>
</section>
