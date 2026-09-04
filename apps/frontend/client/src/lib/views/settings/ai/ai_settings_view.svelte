<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view.svelte
//
// C-465: AI Settings view — status board, provider tree, roles drawer,
// connection editor, and capability-specific controls.

import { BaseViewModelContainer } from '$components';
import type { AiSettingsViewModelInterface } from './ai_settings_view_model.svelte';

type Props = {
  viewModel: AiSettingsViewModelInterface;
};

const { viewModel }: Props = $props();

function capabilityColor(status: string): string {
  if (status === 'connected') {
    return 'text-success';
  }
  if (status === 'offline') {
    return 'text-error';
  }
  return 'text-base-content/40';
}

function capabilityDot(status: string): string {
  if (status === 'connected') {
    return '\u25CF';
  }
  if (status === 'offline') {
    return '\u25CF';
  }
  return '\u25CB';
}
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
                <span class="text-lg {capabilityColor(entry.status)}">
                  {capabilityDot(entry.status)}
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
                    onclick={() => { viewModel.openAddProvider(); }}
                  >
                    Set up {entry.label} →
                  </button>
                {:else}
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost font-mono text-[10px] text-[#938ea1]"
                    onclick={() => viewModel.testConnection('')}
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
                  {#if entry.isLocal}
                    <span class="badge badge-xs badge-success font-mono">running</span>
                  {:else}
                    <span class="badge badge-xs badge-ghost font-mono"
                      >{entry.connectionCount}
                      connection{entry.connectionCount !== 1 ? 's' : ''}</span
                    >
                  {/if}
                </div>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
                    onclick={() => viewModel.testConnection(entry.provider.id)}
                  >
                    Test
                  </button>
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
                    onclick={() => viewModel.openAddProvider()}
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
        {/if}
      </div>
    {/if}
  </section>

  <!-- ═══════════════════════════════════════════════════════════════════
       CONNECTION EDITOR MODAL
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.isEditorOpen}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Connection editor"
      tabindex="-1"
      onclick={(e) => { if (e.target === e.currentTarget) { viewModel.cancelEdit(); } }}
      onkeydown={(e) => { if (e.key === 'Escape') { viewModel.cancelEdit(); } }}
    >
      <div class="modal-box max-w-lg">
        <h3 class="font-mono text-lg font-bold mb-4">
          {viewModel.draft.isEditing ? 'Edit Connection' : 'Add Connection'}
        </h3>

        <div class="space-y-4">
          <!-- Provider dropdown -->
          <div>
            <label for="provider-select" class="label-text font-mono text-xs mb-1 block"
              >Provider</label
            >
            <select
              id="provider-select"
              class="select select-bordered w-full font-mono text-sm"
              value={viewModel.draft.registryId}
              onchange={(e) => viewModel.setDraftProvider((e.target as HTMLSelectElement).value)}
            >
              {#each viewModel.providerOptions as opt}
                <option value={opt.id}>{opt.label} — {opt.description}</option>
              {/each}
            </select>
          </div>

          <!-- API key (masked) -->
          {#if viewModel.needsApiKey}
            <div>
              <label for="api-key-input" class="label-text font-mono text-xs mb-1 block"
                >API Key</label
              >
              <div class="join w-full">
                <input
                  id="api-key-input"
                  type={viewModel.draft.showApiKey ? 'text' : 'password'}
                  class="input input-bordered join-item w-full font-mono text-sm"
                  placeholder={viewModel.draft.apiKey ? '••••••••' : 'Enter API key'}
                  value={viewModel.draft.apiKey}
                  oninput={(e) => viewModel.setDraftField('apiKey', (e.target as HTMLInputElement).value)}
                >
                <button
                  type="button"
                  class="btn btn-ghost join-item"
                  onclick={() => viewModel.toggleApiKeyVisibility()}
                  aria-label={viewModel.draft.showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {viewModel.draft.showApiKey ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          {/if}

          <!-- Base URL -->
          {#if viewModel.needsUrl}
            <div>
              <label for="base-url-input" class="label-text font-mono text-xs mb-1 block"
                >Server URL</label
              >
              <input
                id="base-url-input"
                type="text"
                class="input input-bordered w-full font-mono text-sm"
                placeholder="http://localhost:11434"
                value={viewModel.draft.baseUrl}
                oninput={(e) => viewModel.setDraftField('baseUrl', (e.target as HTMLInputElement).value)}
              >
            </div>
          {/if}

          <!-- Model -->
          <div>
            <label for="model-input" class="label-text font-mono text-xs mb-1 block">Model</label>
            <div class="join w-full">
              <input
                id="model-input"
                type="text"
                class="input input-bordered join-item w-full font-mono text-sm"
                placeholder="e.g. anthropic/claude-sonnet"
                value={viewModel.draft.model}
                oninput={(e) => viewModel.setDraftField('model', (e.target as HTMLInputElement).value)}
              >
              {#if viewModel.canFetchModels}
                <button
                  type="button"
                  class="btn btn-ghost join-item font-mono text-xs"
                  disabled={viewModel.isFetchingModels}
                  onclick={() => viewModel.fetchModels()}
                >
                  {#if viewModel.isFetchingModels}
                    <span class="loading loading-spinner loading-xs"></span>
                  {:else}
                    Fetch
                  {/if}
                </button>
              {/if}
            </div>
            {#if viewModel.modelOptions.length > 0}
              <div class="mt-2 max-h-32 overflow-y-auto space-y-1">
                {#each viewModel.modelOptions as m}
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost w-full justify-start font-mono text-xs"
                    onclick={() => viewModel.setDraftField('model', m.id)}
                  >
                    {m.id}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Label -->
          <div>
            <label for="label-input" class="label-text font-mono text-xs mb-1 block"
              >Label (optional)</label
            >
            <input
              id="label-input"
              type="text"
              class="input input-bordered w-full font-mono text-sm"
              placeholder="My connection"
              value={viewModel.draft.label}
              oninput={(e) => viewModel.setDraftField('label', (e.target as HTMLInputElement).value)}
            >
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 justify-end mt-6">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancelEdit()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary font-mono text-xs"
            onclick={() => viewModel.saveDraft()}
          >
            {viewModel.draft.isEditing ? 'Save Changes' : 'Add Connection'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════
       KEY CONFLICT PROMPT
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.keyConflictPrompt}
    {@const prompt = viewModel.keyConflictPrompt}
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Key conflict"
      tabindex="-1"
      onclick={(e) => { if (e.target === e.currentTarget) { viewModel.dismissKeyConflict(); } }}
      onkeydown={(e) => { if (e.key === 'Escape') { viewModel.dismissKeyConflict(); } }}
    >
      <div class="modal-box max-w-md">
        <h3 class="font-mono text-lg font-bold mb-2">Update shared account?</h3>
        <p class="text-sm text-base-content/70 mb-4">
          {prompt.providerLabel}
          has
          {prompt.sharedConnectionCount}
          connection{prompt.sharedConnectionCount !== 1 ? 's' : ''}
          using this account. Do you want to update the API key for all of them, or create a
          separate account?
        </p>
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => viewModel.dismissKeyConflict()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onclick={() => viewModel.resolveKeyConflict(false)}
          >
            Create separate
          </button>
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => viewModel.resolveKeyConflict(true)}
          >
            Update all ({prompt.sharedConnectionCount})
          </button>
        </div>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
