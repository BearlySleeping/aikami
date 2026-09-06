<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/capability_detail_view.svelte
//
// Per-capability detail view for Story & Dialogue, Artwork, and Read Aloud.
// Shows status, model, provider, and action buttons.
// Contract: C-484 AC-2

import { BaseViewModelContainer } from '$components';
import type { CapabilityDetailViewModelInterface } from './capability_detail_view_model.svelte';

type Props = {
  viewModel: CapabilityDetailViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
<div class="max-w-2xl mx-auto space-y-6">
  <!-- Status card -->
  <div class="card card-bordered border-base-300 bg-base-100">
    <div class="card-body">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-bold">Status</h2>
          <p class="text-sm text-base-content/60 mt-1">
            {#if viewModel.isConfigured}
              {viewModel.providerLabel}
              · {viewModel.modelName}
            {:else}
              Not configured
            {/if}
          </p>
        </div>
        <span class="badge {viewModel.statusColor}">{viewModel.status}</span>
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div class="flex gap-3">
    {#if viewModel.isConfigured}
      <button type="button" class="btn btn-primary" onclick={() => viewModel.openChange()}>
        Change
      </button>
      <button
        type="button"
        class="btn btn-outline"
        onclick={() => viewModel.testConnection()}
        disabled={viewModel.isTesting}
      >
        {viewModel.isTesting ? 'Testing…' : 'Test Connection'}
      </button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={() => viewModel.openSetup()}>
        Set Up
      </button>
    {/if}
  </div>

  <!-- Connection modals from the parent AiSettingsViewModel -->
  {#if viewModel.aiSettingsViewModel.isEditorOpen || viewModel.aiSettingsViewModel.isVoiceSetupOpen}
    <div class="text-sm text-base-content/60">
      <p>Use the connection editor to configure your provider.</p>
    </div>
  {/if}
</div>
</BaseViewModelContainer>
