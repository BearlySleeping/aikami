<script lang="ts">
  import ConnectionEditorPanel from './connection_editor_panel.svelte';
  // apps/frontend/client/src/lib/views/settings/connection/connections_list_view.svelte
  import {
    type ConnectionManagerViewModelInterface,
    getConnectionManagerViewModel,
  } from './connection_manager_view_model.svelte';

  type Props = {
    viewModel?: ConnectionManagerViewModelInterface;
  };

  const {
    viewModel = getConnectionManagerViewModel({
      className: 'ConnectionManagerViewModel',
    }),
  }: Props = $props();
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h2 class="font-mono text-lg font-bold text-[#cabeff]">Connections</h2>
      <p class="text-sm text-[#938ea1] mt-0.5 font-sans">
        Manage saved provider profiles for quick switching and per-chat assignment.
      </p>
    </div>
    <button
      class="btn btn-sm font-mono text-xs uppercase tracking-wider border-[#00e3fd]/30 text-[#00e3fd] hover:bg-[#00e3fd]/10"
      onclick={() => viewModel.openCreate()}
    >
      + Add Connection
    </button>
  </div>

  <!-- Empty State -->
  {#if viewModel.connections.length === 0}
    <div class="text-center py-12 border border-dashed border-white/[0.08] rounded-lg">
      <p class="text-[#938ea1] font-sans text-sm">No connections yet.</p>
      <p class="text-[#938ea1]/60 font-sans text-xs mt-1">
        Create a connection to save a provider + model configuration for quick reuse.
      </p>
    </div>
  {:else}
    <div class="grid gap-3">
      {#each viewModel.connections as connection (connection.id)}
        {@const isTesting = viewModel.testingIds.has(connection.id)}
        {@const testResult = viewModel.testResults[connection.id]}
        {@const providerLabel = viewModel.providerLabels[connection.provider] ?? connection.provider}

        <div
          class="card card-bordered border-white/[0.08] bg-base-100/50 hover:border-[#cabeff]/20 transition-colors"
        >
          <div class="card-body p-4">
            <div class="flex items-start justify-between gap-4">
              <!-- Left: info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5">
                  <span class="font-mono text-sm font-semibold text-base-content truncate">
                    {connection.name}
                  </span>
                  {#if connection.isDefault}
                    <span
                      class="badge badge-xs badge-warning gap-1 font-mono"
                      title="Default connection"
                    >
                      ★ Default
                    </span>
                  {/if}
                </div>
                <div class="flex items-center gap-2 text-xs font-mono text-[#938ea1]">
                  <span
                    class="badge badge-sm {connection.provider === 'ollama'
                      ? 'badge-success'
                      : 'badge-primary'} badge-outline"
                  >
                    {providerLabel}
                  </span>
                  <span class="truncate">{connection.model || '(no model)'}</span>
                </div>
                {#if testResult}
                  <div class="mt-2">
                    {#if testResult.ok}
                      <span class="text-xs font-mono text-success">
                        ✓ Connected ({testResult.latencyMs}ms
                        {#if testResult.modelCount !== undefined}
                          · {testResult.modelCount} models
                        {/if}
                        )
                      </span>
                    {:else}
                      <span class="text-xs font-mono text-error">
                        ✗ {testResult.error ?? 'Failed'} ({testResult.latencyMs}ms)
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Right: actions -->
              <div class="flex items-center gap-1 shrink-0">
                {#if !connection.isDefault}
                  <button
                    class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                    onclick={() => viewModel.setDefault(connection.id)}
                    title="Set as default"
                  >
                    ★
                  </button>
                {/if}
                <button
                  class="btn btn-ghost btn-xs font-mono text-[10px] {isTesting
                    ? 'text-[#00e3fd]'
                    : 'text-[#938ea1]'}"
                  onclick={() => viewModel.testConnection(connection.id)}
                  disabled={isTesting}
                  title="Test connection"
                >
                  {#if isTesting}
                    <span class="loading loading-spinner loading-xs"></span>
                  {:else}
                    Test
                  {/if}
                </button>
                <button
                  class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                  onclick={() => viewModel.duplicateConnection(connection.id)}
                  title="Duplicate"
                >
                  Dup
                </button>
                <button
                  class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                  onclick={() => viewModel.openEdit(connection.id)}
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  class="btn btn-ghost btn-xs font-mono text-[10px] text-error/60 hover:text-error"
                  onclick={() => viewModel.deleteConnection(connection.id)}
                  title="Delete"
                >
                  Del
                </button>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Editor Modal -->
  {#if viewModel.isEditorOpen}
    <ConnectionEditorPanel {viewModel} />
  {/if}
</div>
