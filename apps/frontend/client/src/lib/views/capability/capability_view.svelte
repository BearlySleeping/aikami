<script lang="ts">
// apps/frontend/client/src/lib/views/capability/capability_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ConnectionEditorPanel from '$views/settings/connection/connection_editor_panel.svelte';
import type { CapabilityViewModelInterface, StatusBadgeInfo } from './capability_view_model.svelte';

type Props = {
  viewModel: CapabilityViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#snippet StatusBadge(props: StatusBadgeInfo)}
  {@const statusClass = props.status === 'detected' || props.status === 'configured'
    ? 'badge-success'
    : props.status === 'error' || props.status === 'not_found'
      ? 'badge-error'
      : 'badge-ghost'}
  <span class="badge badge-sm {statusClass} gap-1">
    {props.label}
    <span class="opacity-60">{props.status === 'not_found' ? 'not found' : props.status}</span>
  </span>
{/snippet}

<BaseViewModelContainer {viewModel}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
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

        <!-- Detection spinner (shown during detection) -->
        {#if viewModel.isDetecting}
          <div class="flex items-center justify-center gap-2 py-4">
            <span class="loading loading-spinner loading-md text-primary"></span>
            <span class="text-base-content/60">Detecting AI providers...</span>
          </div>
        {/if}

        <!-- Detection status badges -->
        <div class="flex justify-center gap-3">
          {#each viewModel.statusBadges as badge}
            {@render StatusBadge(badge)}
          {/each}
        </div>

        <!-- Path buttons -->
        <div class="flex flex-col gap-3">
          <!-- Play Offline Demo — always available, visually dominant when no AI -->
          <button
            type="button"
            class="btn btn-lg {viewModel.localAiDetected || viewModel.cloudConfigured || viewModel.cloudConnections.length > 0 ? 'btn-outline' : 'btn-primary'}"
            onclick={() => viewModel.selectOfflineDemo()}
          >
            <span class="text-lg">🎮</span>
            Play Offline Demo
            <span class="badge badge-sm badge-ghost ml-2">No setup</span>
          </button>

          <!-- Use Detected Local AI — enabled when Ollama found -->
          {#if viewModel.localAiDetected}
            <button
              type="button"
              class="btn btn-lg btn-primary"
              onclick={() => viewModel.selectLocalAi()}
            >
              <span class="text-lg">🖥️</span>
              Use Detected Local AI
              {#if viewModel.snapshot.textModelName}
                <span class="badge badge-sm badge-accent ml-2"
                  >{viewModel.snapshot.textModelName}</span
                >
              {/if}
            </button>
          {:else}
            <button type="button" class="btn btn-lg btn-disabled" disabled>
              <span class="text-lg">🖥️</span>
              No Local AI Detected
            </button>
          {/if}

          <!-- Existing cloud connections -->
          {#each viewModel.cloudConnections as conn}
            {@const isDefault = conn.id === viewModel.cloudConnectionVm.defaultConnectionId}
            <button
              type="button"
              class="btn btn-lg {isDefault ? 'btn-primary' : 'btn-outline'}"
              onclick={() => viewModel.selectCloudConnection(conn.id)}
            >
              <span class="text-lg">☁️</span>
              {conn.name}
              <span class="badge badge-sm ml-2 {isDefault ? 'badge-accent' : 'badge-ghost'}"
                >{viewModel.providerLabels[conn.provider] ?? conn.provider}</span
              >
              {#if conn.model}
                <span class="badge badge-sm badge-outline ml-1">{conn.model}</span>
              {/if}
              {#if isDefault}
                <span class="badge badge-sm badge-success ml-1">default</span>
              {/if}
            </button>
          {/each}

          <!-- Connect Cloud AI — always available to add new connections -->
          <button
            type="button"
            class="btn btn-lg btn-outline"
            onclick={() => viewModel.openCloudSetup()}
          >
            <span class="text-lg">➕</span>
            Add Cloud AI
          </button>
        </div>

        <!-- Privacy note -->
        <p class="text-center text-xs text-base-content/40">
          API keys are encrypted and stored only on your device. No account required — play offline
          anytime.
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

<!-- Cloud Connection Modal — reuses the settings connection editor panel -->
{#if viewModel.showCloudSetup}
  <ConnectionEditorPanel viewModel={viewModel.cloudConnectionVm} />
{/if}
