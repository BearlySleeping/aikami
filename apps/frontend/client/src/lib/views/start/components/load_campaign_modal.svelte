<script lang="ts">
import type { CampaignSummary } from '../start_view_model.svelte';
// apps/frontend/client/src/lib/views/start/components/load_campaign_modal.svelte
import CampaignSummaryCard from './campaign_summary_card.svelte';

type Props = {
  campaigns: readonly CampaignSummary[];
  onload: (campaignId: string) => void;
  onclose: () => void;
};

let { campaigns, onload, onclose }: Props = $props();

/** Closes the modal when the backdrop is clicked. */
const handleBackdropClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) {
    onclose();
  }
};

/** Closes the modal on Escape key. */
const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    onclose();
  }
};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Load Campaign"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
>
  <div class="bg-base-200 rounded-box shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-base-300">
      <h2 class="text-lg font-bold">Load Campaign</h2>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square"
        onclick={onclose}
        aria-label="Close"
      >
        ✕
      </button>
    </div>

    <!-- Campaign list -->
    <div class="flex-1 overflow-y-auto p-4 space-y-3">
      {#if campaigns.length === 0}
        <p class="text-center text-base-content/40 py-8">No campaigns found.</p>
      {:else}
        {#each campaigns as campaign (campaign.id)}
          <CampaignSummaryCard {campaign} onclick={() => onload(campaign.id)} isFailed={false} />
        {/each}
      {/if}
    </div>
  </div>
</div>
