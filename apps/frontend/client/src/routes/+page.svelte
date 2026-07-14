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

onMount(async () => {
  try {
    await campaignService.initialize();
  } catch {
    // If IndexedDB is unavailable, treat as first launch
  }
  isChecking = false;
});

const startViewModel = getStartViewModel({ className: 'StartViewModel' });

// Redirect to capability screen on first launch
$effect(() => {
  if (!isChecking && !campaignService.hasCampaigns()) {
    window.location.replace('/capability');
  }
});
</script>

{#if isChecking}
  <div class="flex min-h-screen items-center justify-center bg-base-200">
    <span class="loading loading-spinner loading-lg text-primary"></span>
  </div>
{:else}
  <StartView viewModel={startViewModel} />
{/if}
