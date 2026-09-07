<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/capability_detail_content.svelte
//
// Stateless presentation for capability status and setup actions. Mounts
// the same shared connection editor / voice setup modals used by the full
// AI Settings page and onboarding — one editor, three hosts.

import AiConnectionModals from './ai_connection_modals.svelte';
import type { CapabilityDetailViewModelInterface } from './capability_detail_view_model.svelte';

type Props = {
  viewModel: CapabilityDetailViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

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
        <span class="badge {viewModel.statusColor}">{viewModel.statusLabel}</span>
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

  <!-- Real connection editor / voice setup — same controller instance that
       owns Set Up / Change above, so Save and Cancel act on this page. -->
  <AiConnectionModals viewModel={viewModel.aiSettingsViewModel} />
</div>
