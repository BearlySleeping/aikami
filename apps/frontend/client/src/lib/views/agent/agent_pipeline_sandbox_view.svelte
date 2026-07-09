<script lang="ts">
  import AgentHudDrawer from '$lib/components/agent/agent_hud_drawer.svelte';
  // apps/frontend/client/src/lib/views/agent/agent_pipeline_sandbox_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { AgentPipelineSandboxViewModelInterface } from './agent_pipeline_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: AgentPipelineSandboxViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-6 max-w-2xl mx-auto space-y-6">
    <h1 class="text-2xl font-bold text-base-content">Agent Pipeline Sandbox</h1>

    <!-- Agent toggles -->
    <div class="card bg-base-200">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Enabled Agents</h2>
        <div class="flex flex-wrap gap-2">
          {#each viewModel.availableAgents as agent (agent.id)}
            <button
              type="button"
              class="btn btn-sm {viewModel.isAgentEnabled(agent.id) ? 'btn-primary' : 'btn-ghost'}"
              onclick={() => viewModel.toggleAgent(agent.id)}
              disabled={viewModel.isRunning}
            >
              <span class="badge badge-xs {agent.phase === 'pre' ? 'badge-info' : 'badge-accent'}"
                >{agent.phase}</span
              >
              <span class="font-mono text-xs">{agent.name}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- Test message input -->
    <div class="card bg-base-200">
      <div class="card-body p-4">
        <h2 class="card-title text-base">Test Message</h2>
        <textarea
          class="textarea textarea-bordered w-full font-mono text-sm"
          rows="3"
          value={viewModel.testMessage}
          oninput={(e: Event) => {
            const target = e.target as HTMLTextAreaElement;
            viewModel.testMessage = target.value;
          }}
          disabled={viewModel.isRunning}
        ></textarea>
      </div>
    </div>

    <!-- Run button -->
    <button
      type="button"
      class="btn btn-primary w-full"
      onclick={() => viewModel.runTestPipeline()}
      disabled={viewModel.isRunning}
    >
      {#if viewModel.isRunning}
        <span class="loading loading-spinner loading-sm"></span>
        Running Pipeline...
      {:else}
        Run Pipeline
      {/if}
    </button>

    <!-- Results summary -->
    {#if viewModel.results.length > 0}
      <div class="card bg-base-200">
        <div class="card-body p-4">
          <h2 class="card-title text-base">Results ({viewModel.results.length} agents)</h2>
          <div class="space-y-1">
            {#each viewModel.results as result (result.agentId)}
              <div class="flex items-center justify-between p-2 bg-base-100 rounded text-sm">
                <span class="font-mono">{result.agentId}</span>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-mono text-base-content/40">{result.durationMs}ms</span>
                  {#if result.success}
                    <span class="badge badge-success badge-xs">OK</span>
                  {:else}
                    <span class="badge badge-error badge-xs">FAIL</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    <!-- Agent output details -->
    {#if viewModel.results.length > 0}
      <div class="card bg-base-200">
        <div class="card-body p-4">
          <h2 class="card-title text-base">Agent Outputs</h2>
          {#each viewModel.results.filter(r => r.success && r.output) as result (result.agentId)}
            <div class="mb-3">
              <span class="badge badge-sm badge-ghost font-mono mb-1">{result.agentId}</span>
              <pre
                class="text-xs font-mono text-base-content/70 bg-base-300 p-2 rounded overflow-x-auto"
              >{JSON.stringify(result.output, null, 2)}</pre>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- HUD drawer overlay -->
  <AgentHudDrawer viewModel={viewModel.hudViewModel} />
</BaseViewModelContainer>
