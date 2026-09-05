<script lang="ts">
// apps/frontend/client/src/lib/views/capability/capability_view.svelte
// Onboarding capability screen — one capability at a time. Each tab shows
// either its connected provider(s) or a single "connect" call to action;
// no Status board or Provider tree here (that's the Settings page's job).
import { BaseViewModelContainer } from '$components';
import AiConnectionModals from '$views/settings/ai/ai_connection_modals.svelte';
import LocalAiWizardView from '../ai/local_ai_wizard_view.svelte';
import type { CapabilityViewModelInterface } from './capability_view_model.svelte';

type Props = {
  viewModel: CapabilityViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

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

        <!-- Active-capability panel — connected providers, or one CTA -->
        <div>
          {#if viewModel.connectionEntries.length > 0}
            <div class="space-y-2">
              {#each viewModel.connectionEntries as entry (entry.connection.id)}
                <div class="card card-bordered bg-base-200">
                  <div class="card-body flex-row items-center justify-between p-4">
                    <div class="flex items-center gap-3">
                      <span class="text-lg">{entry.icon}</span>
                      <div>
                        <p class="font-medium">{entry.providerLabel}</p>
                        {#if entry.connection.model}
                          <p class="text-xs text-base-content/60">{entry.connection.model}</p>
                        {/if}
                      </div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        onclick={() => viewModel.aiSettingsViewModel.testConnection(entry.connection.id)}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        onclick={() => viewModel.aiSettingsViewModel.openEditConnection(entry.connection.id)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              {/each}
              <button
                type="button"
                class="btn btn-ghost btn-xs w-full"
                onclick={() => viewModel.aiSettingsViewModel.openCapabilitySetup(viewModel.activeTab)}
              >
                + Add another {viewModel.activeCapabilityLabel} provider
              </button>
            </div>
          {:else}
            <div class="rounded-lg border border-dashed border-base-300 py-8 text-center">
              <p class="mb-3 text-sm text-base-content/60">
                No {viewModel.activeCapabilityLabel} provider connected yet.
              </p>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                onclick={() => viewModel.aiSettingsViewModel.openCapabilitySetup(viewModel.activeTab)}
              >
                {viewModel.capabilitySetupLabel}
              </button>
            </div>
          {/if}
        </div>

        <!-- Local AI install wizard (C-467) — shown in the Text tab when no cloud/local provider is configured -->
        {#if viewModel.showLocalAiWizard}
          <div class="mt-2">
            <LocalAiWizardView viewModel={viewModel.localAiWizardViewModel} />
          </div>
        {/if}

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

  <AiConnectionModals viewModel={viewModel.aiSettingsViewModel} />
</BaseViewModelContainer>
