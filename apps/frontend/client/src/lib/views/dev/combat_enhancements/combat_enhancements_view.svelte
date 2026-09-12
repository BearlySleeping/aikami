<script lang="ts">
// apps/frontend/client/src/lib/views/dev/combat_enhancements/combat_enhancements_view.svelte
// C-234 Dev Sandbox — Combat Enhancements (Dice & Initiative)

import { BaseViewModelContainer } from '$components';
import DiceQuickMenu from '$views/combat/components/dice_quick_menu.svelte';
import EnrichedLogEntry from '$views/combat/components/enriched_log_entry.svelte';
import InitiativeTracker from '$views/combat/components/initiative_tracker.svelte';
import TurnTrackerHeader from '$views/combat/components/turn_tracker_header.svelte';
import type { CombatEnhancementsViewModelInterface } from './combat_enhancements_view_model.svelte.ts';

type Props = {
  viewModel: CombatEnhancementsViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<svelte:head>
  <title>Combat Enhancements Dev — Aikami</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="mx-auto max-w-4xl p-6 space-y-8">
    <h1 class="text-xl font-bold text-base-content">🎲 Combat Enhancements — Dev Sandbox</h1>
    <p class="text-sm text-base-content/50">
      5 new UI features: dice menu, initiative tracker, turn header, enriched log, quick-dice
      popover.
    </p>

    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <h2 class="mb-3 text-sm font-semibold text-base-content/70">1. Dice Quick Menu</h2>
      <DiceQuickMenu
        queuedRolls={viewModel.queuedRolls}
        onQueueRoll={(options) => viewModel.queueRoll(options)}
        onRemoveQueuedRoll={(id) => viewModel.removeQueuedRoll(id)}
        onRollAll={() => viewModel.resolveAllRolls()}
        isRolling={viewModel.isRolling}
      />
    </section>

    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-base-content/70">2. Initiative Tracker</h2>
        <button
          type="button"
          class="btn btn-outline btn-xs"
          onclick={() => viewModel.toggleDefeated()}
        >
          Toggle Goblin Defeated
        </button>
      </div>
      <InitiativeTracker entries={viewModel.initiativeEntries} />
    </section>

    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-base-content/70">3. Turn Tracker Header</h2>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.cycleTurn()}
          >
            Cycle Turn
          </button>
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.toggleActionAvailability()}
          >
            Toggle Action
          </button>
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.toggleQuickActionAvailability()}
          >
            Toggle Quick
          </button>
          <button
            type="button"
            class="btn btn-outline btn-xs"
            onclick={() => viewModel.toggleReactionAvailability()}
          >
            Toggle Reaction
          </button>
        </div>
      </div>
      <TurnTrackerHeader
        turnState={viewModel.turnState}
        actionEconomy={viewModel.actionEconomy}
        onEndTurn={() => viewModel.cycleTurn()}
        isEndTurnDisabled={viewModel.isEndTurnDisabled}
      />
    </section>

    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <h2 class="mb-3 text-sm font-semibold text-base-content/70">4. Enriched Combat Log</h2>
      <div class="mb-2 flex gap-2">
        <input
          type="text"
          value={viewModel.testLogText}
          oninput={(event) => viewModel.handleTestLogInput(event)}
          class="input input-bordered input-sm flex-1 font-mono text-xs"
        >
      </div>
      <div class="rounded-lg border border-base-200 bg-base-200 p-3">
        <div class="mb-1 text-xs text-base-content/50">
          Input: <code class="font-mono">{viewModel.testLogText}</code>
        </div>
        <div class="text-sm">
          <EnrichedLogEntry entry={viewModel.testLogEntry} />
        </div>
      </div>

      <div class="mt-3 space-y-1">
        <p class="text-xs font-semibold text-base-content/50">Preset test strings:</p>
        <div class="flex flex-wrap gap-1">
          {#each viewModel.logPresets as preset}
            <button
              type="button"
              class="btn btn-ghost btn-xs font-mono"
              onclick={() => viewModel.setTestLogText(preset.text)}
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-base-300 bg-base-100 p-4">
      <h2 class="mb-3 text-sm font-semibold text-base-content/70">
        5. Full Example (Dice + Enriched Log)
      </h2>
      <div class="space-y-1">
        {#each viewModel.exampleEntries as entry}
          <div class="rounded border-b border-base-200 px-2 py-1">
            <EnrichedLogEntry {entry} />
          </div>
        {/each}
      </div>
    </section>
  </div>
</BaseViewModelContainer>
