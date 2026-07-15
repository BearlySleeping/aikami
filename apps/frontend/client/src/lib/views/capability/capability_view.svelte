<script lang="ts">
// apps/frontend/client/src/lib/views/capability/capability_view.svelte
import { TEXT_PROVIDERS } from '@aikami/constants';
import type { DetectionStatus } from '@aikami/types';
import type { CapabilityViewModelInterface } from './capability_view_model.svelte';

type Props = {
  viewModel: CapabilityViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#snippet StatusBadge(props: { label: string; status: DetectionStatus })}
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
        {@render StatusBadge({ label: 'Text AI', status: viewModel.snapshot.textStatus })}
        {@render StatusBadge({ label: 'Voice', status: viewModel.snapshot.voiceStatus })}
      </div>

      <!-- Path buttons -->
      <div class="flex flex-col gap-3">
        <!-- Play Offline Demo — always available, visually dominant when no AI -->
        <button
          type="button"
          class="btn btn-lg {viewModel.localAiDetected || viewModel.cloudConfigured ? 'btn-outline' : 'btn-primary'}"
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

        <!-- Connect Cloud AI — always available -->
        <button
          type="button"
          class="btn btn-lg {viewModel.cloudConfigured ? 'btn-primary' : 'btn-outline'}"
          onclick={() => viewModel.openCloudSetup()}
        >
          <span class="text-lg">☁️</span>
          Connect Cloud AI
          {#if viewModel.cloudConfigured}
            <span class="badge badge-sm badge-success ml-2">Configured</span>
          {/if}
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

<!-- Cloud Connection Modal -->
{#if viewModel.showCloudSetup}
  <dialog class="modal modal-open" open>
    <div class="modal-box">
      <h3 class="text-lg font-bold">Connect Cloud AI</h3>

      <!-- Provider selector -->
      <div class="mt-4">
        <label class="label" for="provider-select">
          <span class="label-text">Provider</span>
        </label>
        <select
          id="provider-select"
          class="select select-bordered w-full"
          value={viewModel.selectedCloudProvider}
          onchange={(e: Event) => {
            const target = e.target as HTMLSelectElement;
            viewModel.selectCloudProvider(target.value);
          }}
        >
          {#each TEXT_PROVIDERS.filter(p => !p.isLocal) as provider}
            <option value={provider.id}>{provider.label}</option>
          {/each}
        </select>
      </div>

      <!-- API Key input -->
      <div class="mt-4">
        <label class="label" for="api-key-input">
          <span class="label-text">API Key</span>
        </label>
        <input
          id="api-key-input"
          type="password"
          class="input input-bordered w-full font-mono"
          placeholder="sk-or-..."
          bind:value={viewModel.tempApiKey}
        >
      </div>

      <!-- Privacy / cost disclosure -->
      <p class="mt-2 text-xs text-base-content/60">
        {#if viewModel.isCloudProviderOpenRouter}
          Your prompts are sent to {viewModel.selectedCloudProviderLabel} (which routes to various
          model providers). Usage-based billing applies per their pricing.
        {:else}
          Your prompts are sent to {viewModel.selectedCloudProviderLabel}'s API. Usage-based billing
          applies.
        {/if}
      </p>

      <!-- Test result -->
      {#if viewModel.testResult}
        <div
          class="mt-3 rounded-lg p-3 text-sm {viewModel.testResult.startsWith('✓') ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}"
        >
          {viewModel.testResult}
        </div>
      {/if}

      <!-- Error display in modal -->
      {#if viewModel.errorMessage}
        <div class="alert alert-error mt-3">
          <span>{viewModel.errorMessage}</span>
        </div>
      {/if}

      <!-- Actions -->
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.closeCloudSetup()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-outline"
          disabled={viewModel.isTesting || !viewModel.tempApiKey.trim()}
          onclick={() => viewModel.testCloudConnection()}
        >
          {#if viewModel.isTesting}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Test Connection
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={!viewModel.testResult.startsWith('✓')}
          onclick={() => viewModel.confirmCloudConnection()}
        >
          Connect & Play
        </button>
      </div>
    </div>

    <!-- Backdrop — close on click -->
    <button
      type="button"
      class="modal-backdrop"
      aria-label="Close"
      onclick={() => viewModel.closeCloudSetup()}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          viewModel.closeCloudSetup();
        }
      }}
    ></button>
  </dialog>
{/if}
