<script lang="ts">
import VoiceModelDownload from '@aikami/frontend/components/voice-model-download/voice_model_download.svelte';
// apps/frontend/client/src/lib/views/capability/capability_view.svelte
// C-466: rebuilt on the shared AI settings component — renders a reduced
// view (status board + provider tree) via ai_settings_view.svelte instead
// of the legacy ConnectionEditorPanel.
import { BaseViewModelContainer } from '$components';
import AiSettingsView from '$views/settings/ai/ai_settings_view.svelte';
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

        <!-- Shared AI settings component (C-466) — status board + provider tree -->
        <div class="mt-4 pt-4 border-t border-base-300">
          <AiSettingsView viewModel={viewModel.aiSettingsViewModel} />
        </div>

        <!-- Local AI install wizard (C-467) — shown in the Text tab when no cloud/local provider is configured -->
        {#if viewModel.showLocalAiWizard}
          <div class="mt-2">
            <LocalAiWizardView viewModel={viewModel.localAiWizardViewModel} />
          </div>
        {/if}

        <!-- Voice local download section (C-449 AC-2) -->
        <VoiceModelDownload
          show={viewModel.showVoiceLocalDownload}
          state={viewModel.voiceModelState}
          progress={viewModel.voiceModelProgress}
          sizeLabel={viewModel.voiceModelSizeLabel}
          ondownload={() => viewModel.downloadVoiceModel()}
          oncancel={() => viewModel.cancelVoiceModelDownload()}
        />

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
