<script lang="ts">
// apps/frontend/client/src/lib/views/capability/capability_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ConnectionEditorPanel from '$views/settings/connection/connection_editor_panel.svelte';
import type { CapabilityViewModelInterface, ConnectionEntry } from './capability_view_model.svelte';

type Props = {
  viewModel: CapabilityViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#snippet ConnectionRow(entry: ConnectionEntry)}
  <button
    type="button"
    class="btn btn-lg {entry.isDefault ? 'btn-primary' : 'btn-outline'} justify-start gap-2 h-auto py-3"
    onclick={() => viewModel.setDefaultConnection(entry.connection.id)}
  >
    <span class="shrink-0">{entry.icon}</span>
    <span class="font-mono text-sm truncate">{entry.connection.name}</span>
    <span
      class="badge badge-sm ml-auto shrink-0 {entry.isDefault ? 'badge-accent' : 'badge-ghost'}"
    >
      {entry.providerLabel}
    </span>
    {#if entry.connection.model}
      <span class="badge badge-sm badge-outline shrink-0">{entry.connection.model}</span>
    {/if}
    {#if entry.sourceBadge}
      <span
        class="badge badge-sm shrink-0 {entry.sourceBadge.startsWith('env:') ? 'badge-info' : 'badge-ghost'}"
      >
        ✓ {entry.sourceBadge}
      </span>
    {/if}
    {#if entry.isDefault}
      <span class="badge badge-sm badge-success shrink-0">default</span>
    {/if}
  </button>
{/snippet}

<BaseViewModelContainer {viewModel}>
  <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
    <div class="card bg-base-100 w-full max-w-lg shadow-xl">
      <div class="card-body gap-6">
        <!-- Header -->
        <div class="text-center">
          <h1 class="text-2xl font-bold text-base-content">Welcome to Aikami</h1>
          <p class="mt-2 text-base-content/60">
            {viewModel.snapshot.summary}
          </p>
        </div>

        <!-- Detection spinner -->
        {#if viewModel.isDetecting}
          <div class="flex items-center justify-center gap-2 py-4">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span class="text-base-content/60">Detecting AI providers...</span>
          </div>
        {/if}

        <!-- Tabs with checkmarks -->
        <div class="tabs tabs-boxed justify-center">
          {#each viewModel.tabs as tab}
            <button
              type="button"
              class="tab gap-1 {viewModel.activeTab === tab.id ? 'tab-active' : ''}"
              onclick={() => viewModel.setActiveTab(tab.id)}
            >
              {tab.label}
              {#if tab.hasProvider}
                <span class="text-success text-xs">✓</span>
              {/if}
            </button>
          {/each}
        </div>

        <!-- Connection list (filtered by active tab) -->
        <div class="flex flex-col gap-3">
          {#each viewModel.connectionEntries as entry}
            {@render ConnectionRow(entry)}
          {/each}

          <!-- Add provider -->
          <button
            type="button"
            class="btn btn-lg btn-outline"
            onclick={() => viewModel.openCloudSetup()}
          >
            <span class="text-lg">➕</span>
            Add
            {viewModel.tabs.find((t) => t.id === viewModel.activeTab)?.label ?? 'Provider'}
            Connection
          </button>

          <!-- No connections — guidance + retry -->
          {#if viewModel.connectionEntries.length === 0 && !viewModel.isDetecting && !viewModel.showCloudSetup}
            <div class="alert alert-warning mt-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 shrink-0 stroke-current"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <title>Warning</title>
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <h3 class="font-bold">No Providers Detected</h3>
                <p class="text-sm">Install the local service or add a provider to get started.</p>
              </div>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              onclick={() => viewModel.startDetection()}
            >
              <span class="text-base">🔄</span>
              Retry Detection
            </button>
          {/if}
        </div>

        <!-- Start Campaign — disabled without a text provider -->
        <button
          type="button"
          class="btn btn-lg btn-primary"
          disabled={!viewModel.hasTextProvider}
          onclick={() => viewModel.startCampaign()}
        >
          Start Campaign
        </button>

        <!-- Privacy note -->
        <p class="text-center text-xs text-base-content/40">
          API keys are encrypted and stored only on your device.
        </p>

        <!-- Error display -->
        {#if viewModel.errorMessage}
          <div class="alert alert-error">
            <span>{viewModel.errorMessage}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>

<!-- Cloud Connection Modal -->
{#if viewModel.showCloudSetup}
  <ConnectionEditorPanel viewModel={viewModel.cloudConnectionVm} />
{/if}
