<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/world-gen/+page.svelte
//
// Dev sandbox for C-233 World Generation Wizard.
// Provides isolated testing with mock LLM responses, debug prompt panel,
// and failure simulation for retry logic verification.
//
// Contract: C-233

import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
import { getWorldGenSandboxViewModel } from '$views/dev/world_gen_sandbox_view_model.svelte.ts';
import WorldGenWizardView from '$views/worldgen/world_gen_wizard_view.svelte';

const viewModel = getWorldGenSandboxViewModel({
  className: 'WorldGenSandboxViewModel',
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
          onclick={() => viewModel.simulateFailure()}
        >
          Simulate Failure
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={() => viewModel.resetFailureSimulation()}
        >
          Reset Sim
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
