<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/world-gen/+page.svelte
//
// Dev sandbox for the G01 world-generation wizard.
//
// The mock provider is deliberately SLOW and cancellable so the wizard's real
// lifecycle — cancel mid-run, navigate away mid-run, restart mid-run — can be
// exercised in a browser instead of only in unit tests. `?wgDelay=800` slows
// every stage, `?wgDelayStage=arcs&wgDelay=1500` slows one, and `?wgFail=1`
// makes every stage fail so retry exhaustion is reachable.
//
// Contract: G01 — safe private narrative-world drafts

import { page } from '$app/state';
import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
import { getWorldGenSandboxViewModel } from '$views/dev/world_gen_sandbox_composition.ts';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';

const viewModel = getWorldGenSandboxViewModel({
  className: 'WorldGenSandboxViewModel',
  searchParams: page.url.searchParams,
});
</script>

<div class="flex flex-col h-screen">
  <!-- Header -->
  <div class="bg-base-200 border-b border-base-300 px-6 py-3">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-bold">World Gen Wizard — Dev Sandbox</h1>
        <p class="text-xs text-base-content/50">
          C-233: Mock LLM responses, retry simulation, debug prompt panel
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline"
          onclick={() => viewModel.toggleDebugPanel()}
        >
          {viewModel.debugPanelVisible ? 'Hide' : 'Show'}
          Prompt
        </button>
        <button
          type="button"
          class="btn btn-sm btn-warning"
          data-testid="sandbox-simulate-failure"
          onclick={() => viewModel.simulateFailure()}
        >
          Simulate Failure
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="sandbox-reset-failure"
          onclick={() => viewModel.resetFailureSimulation()}
        >
          Reset Sim
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="sandbox-clear-delay"
          onclick={() => viewModel.clearStageDelay()}
        >
          Clear Delay
        </button>
      </div>
    </div>
  </div>

  <!-- Debug prompt panel -->
  {#if viewModel.debugPanelVisible}
    <div class="bg-base-300 border-b border-base-300 px-6 py-3">
      <details>
        <summary class="text-sm font-medium cursor-pointer">LLM Prompt Preview</summary>
        <pre
          class="mt-2 p-3 bg-base-100 rounded text-xs overflow-auto max-h-64 font-mono"
        >{viewModel.debugPromptText || 'No prompt generated yet. Generate a world to see the prompt.'}</pre>
      </details>
    </div>
  {/if}

  <!-- Wizard content -->
  <div class="flex-1 overflow-y-auto">
    <WorldGenWizardView {viewModel} />
  </div>

  <DevToolsPanel
    actions={[
  {
    label: 'Reset Wizard',
    onClick: () => viewModel.restart(),
  },
  {
    label: 'Copy Prompt',
    onClick: () => {
      if (viewModel.debugPromptText) {
        navigator.clipboard.writeText(viewModel.debugPromptText);
      }
    },
  },
]}
    toggles={[]}
  />
</div>
