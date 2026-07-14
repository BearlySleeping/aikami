<script lang="ts">
// apps/frontend/client/src/lib/views/agent/list/agent_list_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { AgentListViewModelInterface } from './agent_list_view_model.svelte.ts';

type Props = {
  viewModel: AgentListViewModelInterface;
};

const { viewModel }: Props = $props();

// ── Helpers ──────────────────────────────────────────────────────

const phaseLabel = (phase: string): string => {
  return phase === 'pre' ? 'Pre-processing' : 'Post-processing';
};

const phaseBadge = (phase: string): string => {
  return phase === 'pre' ? 'badge-info' : 'badge-accent';
};
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- ═══════════════════════════════════════════════════════════
         Header
         ═══════════════════════════════════════════════════════════ -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-bold">Agents</h2>
        <p class="text-sm text-base-content/50">Manage built-in and custom background agents</p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onclick={() => viewModel.createAgent()}
        >
          Create Agent
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={() => viewModel.refresh()}
          disabled={viewModel.isLoading}
          aria-label="Refresh agents"
        >
          {#if viewModel.isLoading}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            ↻
          {/if}
        </button>
      </div>
    </div>

    <!-- Error -->
    {#if viewModel.errorMessage}
      <div class="alert alert-error">
        <span>{viewModel.errorMessage}</span>
      </div>
    {/if}

    <!-- ═══════════════════════════════════════════════════════════
         Built-in Agents
         ═══════════════════════════════════════════════════════════ -->
    <div>
      <h3 class="text-md font-semibold mb-3 flex items-center gap-2">
        Built-in Agents
        <span class="badge badge-sm badge-ghost">{viewModel.builtInAgents.length}</span>
      </h3>
      <div class="grid gap-2">
        {#each viewModel.builtInAgents as agent (agent.id)}
          <div class="card card-compact bg-base-100 border border-base-300">
            <div class="card-body p-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-sm font-semibold truncate">{agent.name}</span>
                  <span class="badge badge-sm {phaseBadge(agent.phase)}"
                    >{phaseLabel(agent.phase)}</span
                  >
                  <span class="badge badge-sm badge-ghost">Built-in</span>
                </div>
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-primary"
                  checked={agent.enabled}
                  onchange={() => viewModel.toggleBuiltIn(agent.id)}
                >
              </div>
              <p class="text-xs text-base-content/50 line-clamp-2">
                {agent.systemPrompt.slice(0, 120)}
              </p>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         Custom Agents
         ═══════════════════════════════════════════════════════════ -->
    <div>
      <h3 class="text-md font-semibold mb-3 flex items-center gap-2">
        Custom Agents
        <span class="badge badge-sm badge-ghost">{viewModel.customAgents.length}</span>
      </h3>

      {#if viewModel.customAgents.length === 0}
        <div class="text-center py-8 text-base-content/50">
          <p class="text-sm">No custom agents yet.</p>
          <button
            type="button"
            class="btn btn-sm btn-ghost mt-2"
            onclick={() => viewModel.createAgent()}
          >
            Create your first agent
          </button>
        </div>
      {:else}
        <div class="grid gap-2">
          {#each viewModel.customAgents as agent (agent.id)}
            <div class="card card-compact bg-base-100 border border-base-300">
              <div class="card-body p-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-sm font-semibold truncate">{agent.name}</span>
                    {#if agent.folder}
                      <span class="badge badge-sm badge-outline">{agent.folder}</span>
                    {/if}
                    <span class="badge badge-sm {phaseBadge(agent.phase)}"
                      >{phaseLabel(agent.phase)}</span
                    >
                  </div>
                  <input
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    checked={agent.enabled}
                    onchange={() => viewModel.toggleBuiltIn(agent.id)}
                  >
                </div>
                {#if agent.description}
                  <p class="text-xs text-base-content/50 line-clamp-1">{agent.description}</p>
                {/if}
                <div class="flex gap-1 mt-1">
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    onclick={() => viewModel.editAgent(agent)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    onclick={() => viewModel.duplicateAgent(agent.id)}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    onclick={() => viewModel.exportAgent(agent.id)}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost text-error"
                    onclick={() => viewModel.deleteAgent(agent.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
