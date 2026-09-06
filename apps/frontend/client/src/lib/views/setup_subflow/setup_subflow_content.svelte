<script lang="ts">
// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_content.svelte
//
// Pure presentation for setup steps. Receives display state and callbacks so
// the View remains a direct ViewModel adapter.

import type { ConnectionCapability } from '$types';
import type {
  CapabilityToggle,
  DiscoveredProvider,
  SetupEntryPath,
  SetupFlowStep,
} from './setup_subflow_view_model.svelte';

type Props = {
  step: SetupFlowStep;
  capabilityToggles: readonly CapabilityToggle[];
  discoveredProviders: readonly DiscoveredProvider[];
  hasDiscoveredProviders: boolean;
  resourceWarnings: readonly string[];
  hasResourceWarnings: boolean;
  isDetecting: boolean;
  isApplying: boolean;
  errorMessage: string;
  onSelectEntryPath(path: SetupEntryPath): void;
  onToggleCapability(capability: ConnectionCapability): void;
  onStartDiscovery(): void;
  onApplyPlan(): void;
  onGoBack(): void;
  onLeave(): void;
  onReset(): void;
  onRetry(): void;
};

const {
  step,
  capabilityToggles,
  discoveredProviders,
  hasDiscoveredProviders,
  resourceWarnings,
  hasResourceWarnings,
  isDetecting,
  isApplying,
  errorMessage,
  onSelectEntryPath,
  onToggleCapability,
  onStartDiscovery,
  onApplyPlan,
  onGoBack,
  onLeave,
  onReset,
  onRetry,
}: Props = $props();
</script>

{#if step === 'entry'}
  <div class="flex flex-col gap-3">
    <button type="button" class="btn btn-primary" onclick={() => onSelectEntryPath('recommended')}>
      Recommended Setup
    </button>
    <button type="button" class="btn btn-outline" onclick={() => onSelectEntryPath('existing')}>
      Connect Something I Already Use
    </button>
    <button type="button" class="btn btn-ghost" onclick={() => onSelectEntryPath('text-only')}>
      Text Only (Skip Optional)
    </button>
  </div>
{:else if step === 'results'}
  <div class="flex flex-col gap-3">
    <p class="text-sm text-base-content/70">Select capabilities to set up:</p>
    {#each capabilityToggles as toggle (toggle.id)}
      <label
        class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3 hover:bg-base-200"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-primary"
          checked={toggle.enabled}
          disabled={toggle.required}
          onchange={() => onToggleCapability(toggle.id)}
        >
        <div class="flex-1">
          <p class="font-medium">
            {toggle.label}
            {#if toggle.required}
              <span class="badge badge-xs badge-primary ml-1">Required</span>
            {/if}
          </p>
          <p class="text-xs text-base-content/50">{toggle.description}</p>
        </div>
      </label>
    {/each}

    <div class="flex gap-2">
      <button type="button" class="btn btn-outline flex-1" onclick={() => onGoBack()}>Back</button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        onclick={() => onStartDiscovery()}
        disabled={isDetecting}
      >
        {#if isDetecting}
          <span class="loading loading-spinner loading-xs"></span>
          Scanning...
        {:else}
          Continue
        {/if}
      </button>
    </div>
  </div>
{:else if step === 'detecting'}
  <div class="flex flex-col items-center gap-3 py-8">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-sm text-base-content/60">Scanning for AI providers...</p>
    <button type="button" class="btn btn-ghost btn-xs" onclick={() => onGoBack()}>Cancel</button>
  </div>
{:else if step === 'plan'}
  <div class="flex flex-col gap-4">
    <h2 class="text-lg font-semibold">Review Plan</h2>

    {#if hasDiscoveredProviders}
      <div>
        <p class="mb-2 text-sm font-medium text-base-content/70">Discovered Providers:</p>
        <div class="space-y-2">
          {#each discoveredProviders as provider (provider.provider + provider.capability)}
            <div class="rounded-lg border border-base-300 bg-base-200 p-3">
              <div class="flex items-center gap-2">
                <span class="text-lg">{provider.isLocal ? '🖥️' : '☁️'}</span>
                <div>
                  <p class="text-sm font-medium">{provider.label}</p>
                  <p class="text-xs text-base-content/50">
                    {provider.capability}
                    {#if provider.modelName}
                      · {provider.modelName}
                    {/if}
                  </p>
                </div>
                {#if provider.isCompatible}
                  <span class="badge badge-success badge-xs ml-auto">Compatible</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="rounded-lg border border-dashed border-base-300 p-4 text-center">
        <p class="text-sm text-base-content/50">
          No local providers detected. You can enter provider details manually.
        </p>
      </div>
    {/if}

    {#if hasResourceWarnings}
      <div class="space-y-1">
        {#each resourceWarnings as warning}
          <div class="alert alert-warning py-2 text-sm">
            <span>{warning}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex gap-2">
      <button type="button" class="btn btn-outline flex-1" onclick={() => onGoBack()}>
        Edit Choices
      </button>
      <button
        type="button"
        class="btn btn-primary flex-1"
        onclick={() => onApplyPlan()}
        disabled={isApplying}
      >
        {#if isApplying}
          <span class="loading loading-spinner loading-xs"></span>
          Applying...
        {:else}
          Apply & Continue
        {/if}
      </button>
    </div>
  </div>
{:else if step === 'applying'}
  <div class="flex flex-col items-center gap-3 py-8">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-sm text-base-content/60">Applying configuration...</p>
  </div>
{:else if step === 'ready'}
  <div class="flex flex-col items-center gap-4 py-4">
    <div class="text-4xl">✅</div>
    <h2 class="text-lg font-semibold">Ready to Play!</h2>
    <p class="text-center text-sm text-base-content/60">
      Your AI setup is complete. You can start playing now or configure more options later.
    </p>
    <div class="flex gap-2">
      <button type="button" class="btn btn-primary" onclick={() => onLeave()}>Start Playing</button>
      <button type="button" class="btn btn-outline" onclick={() => onReset()}>Set Up More</button>
    </div>
  </div>
{:else if step === 'error'}
  <div class="flex flex-col items-center gap-4 py-4">
    <div class="alert alert-error">
      <span>{errorMessage}</span>
    </div>
    <div class="flex gap-2">
      <button type="button" class="btn btn-outline" onclick={() => onRetry()}>Retry</button>
      <button type="button" class="btn btn-ghost" onclick={() => onGoBack()}>Go Back</button>
    </div>
  </div>
{/if}
