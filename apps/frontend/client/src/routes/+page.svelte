<script lang="ts">
// apps/frontend/client/src/routes/+page.svelte
// Root page — checks for existing campaigns and routes accordingly.
// First launch → /capability; returning player → start menu.
// Contract: C-318 (capability), C-317 (campaign-first start menu)

import { onMount } from 'svelte';
import StartView from '$lib/views/start/start_view.svelte';
import { getStartViewModel } from '$lib/views/start/start_view_model.svelte';
import { campaignService } from '$services';

let isChecking = $state(true);
let initError = $state<string | null>(null);

onMount(async () => {
  try {
    await campaignService.refreshCampaigns();
    initError = null;
  } catch (error) {
    // Store initialization error separately from isChecking
    initError = String(error);
  } finally {
    isChecking = false;
  }
});

const startViewModel = getStartViewModel({ className: 'StartViewModel' });

// Redirect to capability screen on first launch (only when initialization succeeded)
$effect(() => {
  if (!isChecking && !initError && !campaignService.hasCampaigns()) {
    window.location.replace('/capability');
  }
});
</script>

{#if isChecking}
  <div class="flex min-h-screen items-center justify-center bg-base-200">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else if initError}
  <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
    <div class="card bg-base-100 w-full max-w-md shadow-xl">
      <div class="card-body">
        <h2 class="card-title text-error">Initialization Error</h2>
        <p class="text-base-content/80">
          Failed to load campaign data. This may be due to browser storage restrictions.
        </p>
        <div class="card-actions justify-end">
          <button type="button" class="btn btn-primary" onclick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    </div>
  </div>
{:else}
  <StartView viewModel={startViewModel} />
{/if}
