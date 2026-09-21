<script lang="ts">
// apps/frontend/client/src/lib/views/dev/combat/components/combat_debug_toolbar.svelte
//
// Toolbar sub-view for the consolidated combat debug workspace. Renders the
// mode / scenario / seed / scheduler / fault-mode / trace / link controls.
// Zero logic: every control delegates to an existing CombatDebugViewModel
// method through an arrow wrapper; the only inline expressions read a form
// control's value so the ViewModel receives the typed scalar it expects.
//
// Contract: combat debug workspace (execution plan §3, §5)

import type { CombatDebugViewModelInterface } from '../combat_debug_view_model.svelte.ts';

type Props = {
  viewModel: CombatDebugViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div
  class="flex flex-wrap items-end gap-3 border-b border-base-300 bg-base-200 px-4 py-3"
  data-testid="combat-debug-toolbar"
>
  <div class="flex flex-col gap-1">
    <label class="text-xs font-semibold text-base-content/70" for="combat-debug-mode">Mode</label>
    <select
      id="combat-debug-mode"
      class="select select-bordered select-sm"
      value={viewModel.mode}
      onchange={(event) => viewModel.setMode(event.currentTarget.value as never)}
    >
      {#each viewModel.modeOptions as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-semibold text-base-content/70" for="combat-debug-scenario">
      Scenario
    </label>
    <select
      id="combat-debug-scenario"
      class="select select-bordered select-sm"
      value={viewModel.scenario.id}
      onchange={(event) => viewModel.selectScenario(event.currentTarget.value)}
    >
      {#each viewModel.scenarios as scenario (scenario.id)}
        <option value={scenario.id}>{scenario.title}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-semibold text-base-content/70" for="combat-debug-seed">Seed</label>
    <input
      id="combat-debug-seed"
      type="number"
      class="input input-bordered input-sm w-28 font-mono"
      value={viewModel.seed}
      onchange={(event) => viewModel.setSeed(Number(event.currentTarget.value))}
    >
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-semibold text-base-content/70" for="combat-debug-fault">
      Provider fault
    </label>
    <select
      id="combat-debug-fault"
      class="select select-bordered select-sm"
      value={viewModel.faultMode}
      onchange={(event) => viewModel.setFaultMode(event.currentTarget.value as never)}
    >
      {#each viewModel.faultModeOptions as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs font-semibold text-base-content/70" for="combat-debug-fixture">
      Fixture preset
    </label>
    <select
      id="combat-debug-fixture"
      class="select select-bordered select-sm"
      value={viewModel.fixturePreset}
      onchange={(event) => viewModel.setFixturePreset(event.currentTarget.value as never)}
    >
      {#each viewModel.fixturePresetOptions as option (option)}
        <option value={option}>{option}</option>
      {/each}
    </select>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.restart()}
      data-testid="combat-debug-restart"
    >
      ↻ Restart
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.resetDebug()}
      data-testid="combat-debug-reset"
    >
      ⨯ Reset
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.togglePause()}
      aria-pressed={viewModel.isPaused}
      data-testid="combat-debug-pause"
    >
      {viewModel.isPaused ? '▶ Resume' : '⏸ Pause'}
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.step()}
      disabled={!viewModel.canStep}
      data-testid="combat-debug-step"
    >
      ⏭ Step
    </button>
    {#if viewModel.isPaused}
      <!--
        Honest boundary state: the engine has no pause primitive, so the
        debugger holds client → engine command dispatch. Say how many commands
        are actually waiting rather than implying the engine is frozen.
      -->
      <span class="text-xs opacity-70" data-testid="combat-debug-gate-state">
        {viewModel.queuedCommandCount === 0
          ? 'boundary held — no command queued'
          : `boundary held — ${viewModel.queuedCommandCount} command(s) queued`}
      </span>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.exportReproduction()}
      data-testid="combat-debug-export"
    >
      ⇩ Export trace
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.downloadReproductionBundle()}
      data-testid="combat-debug-download"
    >
      ⇩ Download bundle
    </button>
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={() => viewModel.copyUrl()}
      data-testid="combat-debug-copy-url"
    >
      🔗 Copy link
    </button>
  </div>

  {#if viewModel.exportText}
    <div class="w-full">
      <textarea
        class="textarea textarea-bordered w-full font-mono text-xs"
        rows="4"
        readonly
        aria-label="Exported reproduction"
        data-testid="combat-debug-export-text"
      >{viewModel.exportText}</textarea>
    </div>
  {/if}
</div>
