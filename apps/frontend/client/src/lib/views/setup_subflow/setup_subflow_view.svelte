<script lang="ts">
// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view.svelte
//
// Shared setup subflow view — renders the guided AI setup flow based on
// the current step. Used by the capability route and the guided setup route.
// Contract: C-483

import { BaseViewModelContainer } from '$components';
import type { SetupSubflowViewModelInterface } from './setup_subflow_view_model.svelte';

type Props = {
  viewModel: SetupSubflowViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
    <div class="card bg-base-100 w-full max-w-lg shadow-xl">
      <div class="card-body gap-4">
        <!-- Header -->
        <div class="text-center">
          <h1 class="text-2xl font-bold text-base-content">AI Setup</h1>
          <p class="mt-1 text-sm text-base-content/60">
            Configure AI capabilities for your game
          </p>
        </div>

        <!-- Entry step — choose a path -->
        {#if viewModel.step === 'entry'}
          <div class="flex flex-col gap-3">
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.selectEntryPath('recommended')}
            >
              Recommended Setup
            </button>
            <button
              type="button"
              class="btn btn-outline"
              onclick={() => viewModel.selectEntryPath('existing')}
            >
              Connect Something I Already Use
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => viewModel.selectEntryPath('text-only')}
            >
              Text Only (Skip Optional)
            </button>
          </div>

        <!-- Results step — feature selection -->
        {:else if viewModel.step === 'results'}
          <div class="flex flex-col gap-3">
            <p class="text-sm text-base-content/70">Select capabilities to set up:</p>
            {#each viewModel.capabilityToggles as toggle (toggle.id)}
              <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3 hover:bg-base-200">
                <input
                  type="checkbox"
                  class="checkbox checkbox-primary"
                  checked={toggle.enabled}
                  disabled={toggle.required}
                  onchange={() => viewModel.toggleCapability(toggle.id)}
                />
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
              <button
                type="button"
                class="btn btn-outline flex-1"
                onclick={() => viewModel.goBack()}
              >
                Back
              </button>
              <button
                type="button"
                class="btn btn-primary flex-1"
                onclick={() => viewModel.startDiscovery()}
                disabled={viewModel.isDetecting}
              >
                {#if viewModel.isDetecting}
                  <span class="loading loading-spinner loading-xs"></span>
                  Scanning...
                {:else}
                  Continue
                {/if}
              </button>
            </div>
          </div>

        <!-- Detecting step -->
        {:else if viewModel.step === 'detecting'}
          <div class="flex flex-col items-center gap-3 py-8">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <p class="text-sm text-base-content/60">Scanning for AI providers...</p>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => viewModel.goBack()}
            >
              Cancel
            </button>
          </div>

        <!-- Plan step — review -->
        {:else if viewModel.step === 'plan'}
          <div class="flex flex-col gap-4">
            <h2 class="text-lg font-semibold">Review Plan</h2>

            {#if viewModel.discoveredProviders.length > 0}
              <div>
                <p class="mb-2 text-sm font-medium text-base-content/70">Discovered Providers:</p>
                <div class="space-y-2">
                  {#each viewModel.discoveredProviders as provider (provider.provider + provider.capability)}
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

            {#if viewModel.planSummary && viewModel.planSummary.resourceWarnings.length > 0}
              <div class="space-y-1">
                {#each viewModel.planSummary.resourceWarnings as warning}
                  <div class="alert alert-warning py-2 text-sm">
                    <span>{warning}</span>
                  </div>
                {/each}
              </div>
            {/if}

            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-outline flex-1"
                onclick={() => viewModel.goBack()}
              >
                Edit Choices
              </button>
              <button
                type="button"
                class="btn btn-primary flex-1"
                onclick={() => viewModel.applyPlan()}
                disabled={viewModel.isApplying}
              >
                {#if viewModel.isApplying}
                  <span class="loading loading-spinner loading-xs"></span>
                  Applying...
                {:else}
                  Apply & Continue
                {/if}
              </button>
            </div>
          </div>

        <!-- Applying step -->
        {:else if viewModel.step === 'applying'}
          <div class="flex flex-col items-center gap-3 py-8">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <p class="text-sm text-base-content/60">Applying configuration...</p>
          </div>

        <!-- Ready step -->
        {:else if viewModel.step === 'ready'}
          <div class="flex flex-col items-center gap-4 py-4">
            <div class="text-4xl">✅</div>
            <h2 class="text-lg font-semibold">Ready to Play!</h2>
            <p class="text-center text-sm text-base-content/60">
              Your AI setup is complete. You can start playing now or configure more options later.
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => viewModel.leave()}
              >
                Start Playing
              </button>
              <button
                type="button"
                class="btn btn-outline"
                onclick={() => viewModel.reset()}
              >
                Set Up More
              </button>
            </div>
          </div>

        <!-- Error step -->
        {:else if viewModel.step === 'error'}
          <div class="flex flex-col items-center gap-4 py-4">
            <div class="alert alert-error">
              <span>{viewModel.errorMessage || 'An error occurred'}</span>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-outline"
                onclick={() => viewModel.retry()}
              >
                Retry
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                onclick={() => viewModel.goBack()}
              >
                Go Back
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
