<script lang="ts">
// apps/frontend/client/src/lib/views/dev/combat/combat_debug_view.svelte
//
// Root workspace shell for the consolidated combat debug workspace. One view
// and one ViewModel serve three explicit modes:
//
//   live     — an isolated engine session rendered through the PRODUCTION
//              combat sidebar, with the inspector + trace timeline alongside.
//   replay   — import a recorded bundle and compare the replayed log.
//   fixtures — production dice/initiative/log components rendered from typed
//              fixtures, labelled so nobody mistakes them for live state.
//
// Zero logic by construction: every expression is a direct property access on
// the ViewModel, and every handler delegates to a ViewModel method through an
// arrow wrapper. The two documented exceptions are the seed/import controls
// (which read `event.currentTarget` so the ViewModel can stay state-free) and
// the canvas host, which uses a Svelte attachment to hand the real element to
// the ViewModel without local reactive state or a lifecycle hook.
//
// Contract: combat debug workspace (execution plan §3–§8)

import { BaseViewModelContainer } from '$components';
import CombatSidebar from '$views/combat/combat_sidebar.svelte';
import EnrichedLogEntry from '$views/combat/components/enriched_log_entry.svelte';
import TurnTrackerHeader from '$views/combat/components/turn_tracker_header.svelte';
import type { CombatDebugViewModelInterface } from './combat_debug_view_model.svelte.ts';
import CombatDebugInspector from './components/combat_debug_inspector.svelte';
import CombatDebugTimeline from './components/combat_debug_timeline.svelte';
import CombatDebugToolbar from './components/combat_debug_toolbar.svelte';

type Props = {
  viewModel: CombatDebugViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === ' ') {
      event.preventDefault();
      viewModel.togglePause();
    }
  }}
/>

<BaseViewModelContainer {viewModel}>
  <div id="combat-debug-announcer" aria-live="polite" class="sr-only"></div>

  <div class="flex h-screen min-h-0 flex-col bg-base-100" data-testid="combat-debug-view">
    <div class="flex items-center justify-between border-b border-base-300 bg-base-200 px-4 py-2">
      <h1 class="text-sm font-bold text-base-content">⚔️ Combat Debug Workspace</h1>
      <p class="text-xs text-base-content/50">
        mode <span class="font-mono">{viewModel.mode}</span> · scenario
        <span class="font-mono">{viewModel.scenario.id}</span>
      </p>
    </div>

    <CombatDebugToolbar {viewModel} />

    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-base-300 bg-base-100 px-4 py-2 text-xs"
      data-testid="combat-debug-status"
    >
      <span class="flex items-center gap-1">
        <span class="font-semibold text-base-content/60">Status</span>
        <span class="badge badge-outline badge-sm" data-testid="combat-debug-status-label">
          {viewModel.statusLabel}
        </span>
      </span>
      <span class="text-base-content/60">
        revision <span class="font-mono text-base-content/80">{viewModel.revision}</span>
      </span>
      <span class="text-base-content/60">
        round <span class="font-mono text-base-content/80">{viewModel.round}</span>
      </span>
      <span class="text-base-content/60">
        control owner <span class="font-mono text-base-content/80">{viewModel.controlOwner}</span>
      </span>
      {#if viewModel.engineError}
        <span class="text-error" role="alert" data-testid="combat-debug-engine-error">
          Engine error: {viewModel.engineError}
        </span>
      {/if}
      <details class="ml-auto">
        <summary class="cursor-pointer text-base-content/60">Run details</summary>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt class="text-base-content/50">Encounter run id</dt>
          <dd class="font-mono break-all">{viewModel.encounterRunId}</dd>
          <dt class="text-base-content/50">Seed</dt>
          <dd class="font-mono">{viewModel.seed}</dd>
          <dt class="text-base-content/50">URL config</dt>
          <dd class="font-mono break-all">{viewModel.urlSnapshot}</dd>
          {#if viewModel.urlError}
            <dt class="text-error">URL error</dt>
            <dd class="text-error">{viewModel.urlError}</dd>
          {/if}
        </dl>
      </details>
    </div>

    {#if viewModel.mode === 'live'}
      <div class="grid min-h-0 flex-1 overflow-hidden" style="grid-template-columns: 35vw 1fr;">
        {#if viewModel.combatViewModel}
          <div class="min-h-0 overflow-hidden">
            <CombatSidebar viewModel={viewModel.combatViewModel} />
          </div>
        {/if}

        <div class="flex min-h-0 flex-col overflow-hidden">
          <div class="relative min-h-0 flex-1 overflow-hidden bg-black">
            {#if !viewModel.engineReady && !viewModel.engineError}
              <div
                class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/90"
              >
                <span class="loading loading-spinner loading-lg text-primary"></span>
                <p class="text-sm font-bold text-white">Initializing isolated combat session…</p>
              </div>
            {/if}
            <!--
              Keyed on the session epoch: a scenario switch, mode switch,
              restart or reset bumps it, so the canvas is re-created and the
              attachment boots exactly ONE fresh isolated session against the
              new element instead of leaving a disposed world behind a dead
              canvas.
            -->
            {#key viewModel.sessionEpoch}
              <canvas
                id="combat-debug-canvas"
                class="h-full w-full"
                {@attach (element) => {
                  void viewModel.initializeLiveCanvas(element);
                }}
                aria-label="Combat debug live canvas"
              ></canvas>
            {/key}
          </div>

          <div class="grid min-h-0 flex-1 grid-cols-2 overflow-hidden border-t border-base-300">
            <div class="min-h-0 overflow-hidden">
              <CombatDebugInspector {viewModel} />
            </div>
            <div class="min-h-0 overflow-hidden border-l border-base-300">
              <CombatDebugTimeline {viewModel} />
            </div>
          </div>
        </div>
      </div>
    {/if}

    {#if viewModel.mode === 'fixtures'}
      <div
        class="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs font-semibold text-warning"
        role="status"
        data-testid="combat-debug-fixture-notice"
      >
        {viewModel.fixtureNotice}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 space-y-6">
        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-1 text-sm font-semibold text-base-content/80">
            Fixture: {viewModel.presentationFixture.title}
          </h2>
          <p class="text-xs text-base-content/50">{viewModel.presentationFixture.description}</p>
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">Turn tracker</h2>
          <TurnTrackerHeader
            turnState={viewModel.presentationFixture.turnState}
            actionEconomy={viewModel.presentationFixture.turnState.actionEconomy}
            onEndTurn={() => {}}
            isEndTurnDisabled={true}
          />
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">
            Initiative tracker (read-only fixture projection)
          </h2>
          <ul class="space-y-0.5">
            {#each viewModel.presentationFixture.initiativeEntries as entry (entry.entityId)}
              <li
                class="flex items-center gap-2 rounded px-2 py-1 text-xs"
                class:opacity-40={entry.isDefeated}
              >
                <span
                  class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  class:bg-primary={entry.isCurrentTurn && !entry.isDefeated}
                  class:bg-base-content={!entry.isCurrentTurn || entry.isDefeated}
                  class:opacity-20={!entry.isCurrentTurn || entry.isDefeated}
                ></span>
                <span
                  class="font-semibold"
                  class:text-primary={entry.isCurrentTurn && !entry.isDefeated}
                >
                  {entry.name}
                </span>
                <span class="font-mono text-base-content/40">(Init: {entry.initiative})</span>
                <span class="ml-auto font-mono text-base-content/50">
                  {entry.currentHp}/{entry.maxHp}
                </span>
                {#if entry.isCurrentTurn}
                  <span class="badge badge-primary badge-sm">current</span>
                {/if}
                {#if entry.isDefeated}
                  <span class="badge badge-error badge-sm">defeated</span>
                {/if}
                {#if entry.isDowned}
                  <span class="badge badge-warning badge-sm">downed</span>
                {/if}
                {#each entry.statusEffectIds as effectId (effectId)}
                  <span class="badge badge-outline badge-sm font-mono">{effectId}</span>
                {/each}
              </li>
            {/each}
          </ul>
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">Enriched combat log</h2>
          {#if viewModel.presentationFixture.logEntries.length > 0}
            <div class="space-y-1">
              {#each viewModel.presentationFixture.logEntries as entry, index (index)}
                <div class="border-b border-base-200 px-2 py-1">
                  <EnrichedLogEntry {entry} />
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-xs italic text-base-content/40">No log entries in this fixture.</p>
          {/if}
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">
            Queued dice (read-only fixture projection)
          </h2>
          {#if viewModel.presentationFixture.queuedRolls.length > 0}
            <ul class="flex flex-wrap gap-1">
              {#each viewModel.presentationFixture.queuedRolls as roll (roll.id)}
                <li class="badge badge-outline badge-sm font-mono">
                  {roll.notation.label}
                  · {roll.label}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs italic text-base-content/40">No queued rolls in this fixture.</p>
          {/if}
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">Status effects</h2>
          {#if viewModel.presentationFixture.statusEffects.length > 0}
            <ul class="space-y-1 text-xs">
              {#each viewModel.presentationFixture.statusEffects as effect (effect.effectId)}
                <li
                  class="flex flex-wrap items-center justify-between gap-2 rounded border border-base-300 p-2"
                >
                  <span class="font-semibold">{effect.name}</span>
                  <span class="text-base-content/50">
                    <span class="font-mono">{effect.tag}</span>
                    ·
                    {effect.remainingDuration}
                    turn(s) · source <span class="font-mono">{effect.sourceEntityId}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs italic text-base-content/40">No status effects in this fixture.</p>
          {/if}
        </section>
      </div>
    {/if}

    {#if viewModel.mode === 'replay'}
      <div class="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">Import recorded run</h2>
          <form
            class="space-y-2"
            onsubmit={(event) => {
            event.preventDefault();
            const bundle = new FormData(event.currentTarget).get('bundle');
            if (typeof bundle === 'string') {
              viewModel.importReproduction(bundle);
            }
          }}
          >
            <textarea
              name="bundle"
              class="textarea textarea-bordered w-full font-mono text-xs"
              rows="8"
              placeholder="Paste a reproduction bundle JSON"
              aria-label="Reproduction bundle JSON"
              data-testid="combat-debug-import-text"
            ></textarea>
            <button type="submit" class="btn btn-primary btn-sm" data-testid="combat-debug-import">
              ⧉ Replay bundle
            </button>
          </form>
        </section>

        <section class="rounded-lg border border-base-300 bg-base-100 p-4">
          <h2 class="mb-3 text-sm font-semibold text-base-content/70">Replay result</h2>
          {#if viewModel.replayResultText}
            <p
              class="text-xs text-base-content/70"
              role="status"
              data-testid="combat-debug-replay-result"
            >
              {viewModel.replayResultText}
            </p>
          {:else}
            <p class="text-xs italic text-base-content/40">
              No replay run yet — import a bundle to compare.
            </p>
          {/if}

          {#if viewModel.replayComparison}
            <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt class="text-base-content/50">Matched</dt>
              <dd>{viewModel.replayComparison.matched ? 'yes' : 'no'}</dd>
              <dt class="text-base-content/50">Expected events</dt>
              <dd class="font-mono">{viewModel.replayComparison.expectedEventCount}</dd>
              <dt class="text-base-content/50">Actual events</dt>
              <dd class="font-mono">{viewModel.replayComparison.actualEventCount}</dd>
            </dl>
            {#if viewModel.replayComparison.firstDivergence}
              <dl
                class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-error/40 bg-error/5 p-2 text-xs"
                data-testid="combat-debug-replay-divergence"
              >
                <dt class="font-semibold text-error">First divergence at revision</dt>
                <dd class="font-mono">
                  {viewModel.replayComparison.firstDivergence.stateRevision}
                </dd>
                <dt class="text-base-content/50">Event index</dt>
                <dd class="font-mono">
                  {viewModel.replayComparison.firstDivergence.eventIndex}
                </dd>
              </dl>
            {/if}
          {/if}
        </section>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
