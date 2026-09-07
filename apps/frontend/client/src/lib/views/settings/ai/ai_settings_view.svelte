<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view.svelte
//
// C-465: AI Settings view — status board, provider tree, roles drawer,
// connection editor, and capability-specific controls.

import { BaseViewModelContainer } from '$components';
import AiConnectionModals from './ai_connection_modals.svelte';
import type { AiSettingsViewModelInterface } from './ai_settings_view_model.svelte';

type Props = {
  viewModel: AiSettingsViewModelInterface;
};

let { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="max-w-4xl mx-auto space-y-8">
  <!-- ═══════════════════════════════════════════════════════════════════
       STATUS BOARD
       ═══════════════════════════════════════════════════════════════════ -->
  <section>
    <h2 class="font-mono text-lg font-bold text-[#cabeff] mb-4">Status</h2>
    <div class="grid gap-3">
      {#each viewModel.statusEntries as entry (entry.capability)}
        <div class="card card-bordered border-white/[0.08] bg-base-100/50">
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <span class="text-lg {entry.color}">
                  {entry.dot}
                </span>
                <div>
                  <span class="font-mono text-sm font-semibold">{entry.label}</span>
                  {#if entry.providerLabel && entry.modelName}
                    <p class="text-xs text-[#938ea1] font-sans">
                      {entry.providerLabel}
                      · {entry.modelName}
                    </p>
                  {:else if entry.status === 'not_configured'}
                    <p class="text-xs text-[#938ea1]/60 font-sans">Not set up</p>
                  {:else}
                    <p class="text-xs text-[#938ea1]/60 font-sans">No connection</p>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-2">
                {#if entry.status === 'not_configured'}
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost font-mono text-[#00e3fd]"
                    onclick={() => viewModel.openCapabilitySetup(entry.capability)}
                  >
                    Set up {entry.label} →
                  </button>
                {:else if entry.connectionId}
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost font-mono text-[10px] text-[#938ea1]"
                    onclick={() => viewModel.testConnection(entry.connectionId)}
                  >
                    Test
                  </button>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════════
       PROVIDER TREE
       ═══════════════════════════════════════════════════════════════════ -->
  <section>
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-mono text-lg font-bold text-[#cabeff]">Providers</h2>
      <button
        type="button"
        class="btn btn-sm font-mono text-xs uppercase tracking-wider border-[#00e3fd]/30 text-[#00e3fd] hover:bg-[#00e3fd]/10"
        onclick={() => viewModel.openAddProvider()}
      >
        + Add provider
      </button>
    </div>

    {#if viewModel.providerTree.length === 0}
      <div class="text-center py-12 border border-dashed border-white/[0.08] rounded-lg">
        <p class="text-[#938ea1] font-sans text-sm">No providers configured yet.</p>
        <p class="text-[#938ea1]/60 font-sans text-xs mt-1">
          Add a provider to connect to AI services.
        </p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each viewModel.providerTree as entry (entry.provider.id)}
          <div class="card card-bordered border-white/[0.08] bg-base-100/50">
            <div class="card-body p-4">
              <!-- Provider row -->
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-sm">{entry.isLocal ? '▣' : '☁'}</span>
                  <span class="font-mono text-sm font-semibold">{entry.registryLabel}</span>
                  <span class="badge badge-xs font-mono {entry.statusColorClass}"
                    >{entry.statusLabel}</span
                  >
                </div>
                <div class="flex items-center gap-1">
                  {#if entry.connections[0]}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                      onclick={() => viewModel.testConnection(entry.connections[0].id)}
                    >
                      Test
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                    onclick={() => viewModel.openEditConnection(entry.connections[0]?.id ?? '')}
                  >
                    Edit
                  </button>
                </div>
              </div>

              <!-- Nested connections -->
              <div class="ml-6 space-y-1">
                {#each entry.connections as conn (conn.id)}
                  {@const connRoles = viewModel.connectionsWithRoles.find(cwr => cwr.connection.id === conn.id)?.roles ?? []}
                  <div
                    class="flex items-center justify-between text-xs font-mono text-[#938ea1] py-1"
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-[#cabeff]">├</span>
                      <span>{conn.label}</span>
                      <span class="badge badge-xs badge-ghost">{conn.capability}</span>
                      <span class="text-[10px] {conn.statusColorClass}">
                        {conn.statusDot}
                        {conn.statusLabel}
                      </span>
                      {#if connRoles.length > 0}
                        <span class="text-[#938ea1]/60"> · {connRoles.join(', ')} </span>
                      {/if}
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-[10px]"
                        onclick={() => viewModel.openEditConnection(conn.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-[10px] text-error/60"
                        onclick={() => viewModel.deleteConnection(conn.id)}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                {/each}
                <div class="flex items-center text-xs font-mono text-[#00e3fd]/60 py-1 ml-4">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-[10px]"
                    onclick={() => viewModel.openAddProvider(entry.connections[0]?.capability)}
                  >
                    + Add model
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ═══════════════════════════════════════════════════════════════════
       ROLES DRAWER
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.showAdvancedSections}
    <section>
      <button
        type="button"
        class="btn btn-ghost w-full font-mono text-sm text-[#938ea1] justify-start"
        onclick={() => viewModel.toggleRolesDrawer()}
      >
        {viewModel.isRolesDrawerOpen ? '▾' : '▸'}
        Roles & advanced
      </button>

      {#if viewModel.isRolesDrawerOpen}
        <div class="mt-3 space-y-3">
          {#if viewModel.connectionsWithRoles.length === 0}
            <p class="text-sm text-[#938ea1]/60 font-sans italic">No role assignments yet.</p>
          {:else}
            {#each viewModel.connectionsWithRoles as cwr (cwr.connection.id)}
              <div class="card card-bordered border-white/[0.08] bg-base-100/30">
                <div class="card-body p-3">
                  <div class="flex items-center justify-between">
                    <span class="font-mono text-xs">{cwr.connection.label}</span>
                    <span class="text-xs text-[#938ea1]/60">
                      {#if cwr.roles.length > 0}
                        {cwr.roles.join(', ')}
                      {:else}
                        No roles assigned
                      {/if}
                    </span>
                  </div>
                  {#if cwr.roles.length > 0}
                    <div class="flex flex-wrap gap-1 mt-1">
                      {#each cwr.roles as role}
                        <button
                          type="button"
                          class="badge badge-xs badge-outline gap-1 cursor-pointer"
                          onclick={() => viewModel.clearRole(role)}
                        >
                          {role}
                          ✕
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
            {#each viewModel.unassignedConnections as connection (connection.id)}
              <div class="card card-bordered border-white/[0.08] bg-base-100/30">
                <div class="card-body p-3">
                  <span class="font-mono text-xs">Assign {connection.label}</span>
                  <div class="flex flex-wrap gap-1 mt-2">
                    {#each viewModel.availableRoles as role}
                      <button
                        type="button"
                        class="badge badge-xs badge-outline cursor-pointer"
                        onclick={() => viewModel.assignRole(role, connection.id)}
                      >
                        {role}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <AiConnectionModals {viewModel} />
</BaseViewModelContainer>
