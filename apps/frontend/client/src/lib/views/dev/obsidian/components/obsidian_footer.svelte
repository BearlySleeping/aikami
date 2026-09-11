<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_footer.svelte
//
// Bottom chrome: labeled management navigation plus one contextual action
// dock. During combat the same dock shows legal turn actions and an
// initiative surface; unavailable actions explain why.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="shrink-0 border-t border-brass/20 bg-panel" data-testid="obsidian-footer">
  {#if viewModel.isCombat}
    <div class="flex flex-col gap-2 border-b border-brass/10 bg-ink px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="font-display text-xs uppercase tracking-widest text-brass">Initiative</span>
        <span class="text-xs text-base-content/55">Round {viewModel.combatRound}</span>
      </div>
      <ol class="flex flex-wrap gap-2" data-testid="initiative">
        {#each viewModel.initiative as entry (entry.actorId)}
          <li
            class="flex items-center gap-2 rounded-lg border px-2 py-1"
            class:border-primary={entry.isCurrent}
            class:bg-elevated={entry.isCurrent}
            class:border-base-300={!entry.isCurrent}
          >
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full font-display text-xs"
              style="background: oklch(0.34 0.06 {entry.hue})"
              aria-hidden="true"
            >
              {entry.name.slice(0, 1)}
            </span>
            <span class="text-xs text-base-content">{entry.name}</span>
            <span class="font-mono text-xs text-base-content/60">{entry.hp}/{entry.maxHp}</span>
            <span class="font-mono text-[10px] text-base-content/40">init {entry.initiative}</span>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-2 px-3 py-2">
    <span class="text-[10px] uppercase tracking-widest text-base-content/40">Codex</span>
    {#each viewModel.navItems as item (item.id)}
      <button
        type="button"
        class="rounded-md border border-transparent px-2 py-1 text-xs text-base-content/70 hover:border-base-300 hover:bg-elevated"
        onclick={() => viewModel.openCodex(item.id)}
      >
        {item.label}
      </button>
    {/each}

    <span class="mx-1 hidden h-4 w-px bg-base-300 sm:inline-block" aria-hidden="true"></span>

    <span class="text-[10px] uppercase tracking-widest text-base-content/40">Actions</span>
    {#if viewModel.isCombat}
      {#each viewModel.availableCombatActions as action (action.id)}
        <div class="flex flex-col">
          <button
            type="button"
            class="rounded-md border px-2.5 py-1 text-xs"
            class:border-base-300={action.available}
            class:bg-elevated={action.available}
            class:text-base-content={action.available}
            class:border-transparent={!action.available}
            class:action-disabled={!action.available}
            disabled={!action.available}
            title={action.description}
            onclick={() => viewModel.useCombatAction(action.id)}
          >
            {action.label}
            <span class="ml-1 text-[10px] uppercase text-base-content/40">{action.cost}</span>
          </button>
          {#if !action.available && action.unavailableReason}
            <span class="mt-0.5 text-[10px] text-warning/80">{action.unavailableReason}</span>
          {/if}
        </div>
      {/each}
      <button
        type="button"
        class="btn btn-primary btn-xs ml-auto"
        onclick={() => viewModel.endTurn()}
      >
        End Turn
      </button>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => viewModel.endCombat()}>
        End Encounter
      </button>
    {:else}
      {#each viewModel.explorationActions as action (action.id)}
        <button
          type="button"
          class="rounded-md border border-base-300 bg-elevated px-2.5 py-1 text-xs text-base-content"
          title={action.description}
          onclick={() => viewModel.useExplorationAction(action.id)}
        >
          {action.label}
        </button>
      {/each}
    {/if}
  </div>
</div>

{#if viewModel.encounterSummary}
  <div
    class="fixed inset-x-0 bottom-0 z-30 border-t border-brass/40 bg-ink/95 p-4 backdrop-blur-sm"
    data-testid="encounter-summary"
  >
    <div class="mx-auto flex max-w-2xl flex-col gap-2">
      <h3 class="font-display text-lg text-brass">Encounter complete</h3>
      <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-xs uppercase tracking-wide text-base-content/50">Experience</dt>
          <dd class="text-base-content">{viewModel.encounterSummary.xp} XP</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-base-content/50">Loot</dt>
          <dd class="text-base-content">{viewModel.encounterSummary.loot}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-base-content/50">Injuries</dt>
          <dd class="text-base-content">{viewModel.encounterSummary.injuries}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-base-content/50">Quest effects</dt>
          <dd class="text-base-content">{viewModel.encounterSummary.questEffects}</dd>
        </div>
      </dl>
      <button
        type="button"
        class="btn btn-primary btn-sm self-end"
        onclick={() => viewModel.dismissEncounterSummary()}
      >
        Continue
      </button>
    </div>
  </div>
{/if}

<style>
.action-disabled {
  opacity: 0.4;
}
</style>
