<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/load_campaign_modal.svelte
import { Modal } from '@aikami/frontend/components';
import type { CampaignSummary } from '../start_view_model.svelte';
import CampaignSummaryCard from './campaign_summary_card.svelte';

type Props = {
  open: boolean;
  campaigns: readonly CampaignSummary[];
  onclose?: () => void;
  onSelect: (campaignId: string) => Promise<void>;
};

let { open = $bindable(), campaigns, onclose, onSelect }: Props = $props();
</script>

<Modal bind:open size="lg" {onclose}>
  {#snippet title()}
    <h3 class="text-lg font-bold">Load Campaign</h3>
  {/snippet}

  {#snippet children()}
    {#if campaigns.length === 0}
      <p class="text-sm text-base-content/50 text-center py-8">No campaigns found.</p>
    {:else}
      <div class="grid gap-3 max-h-96 overflow-y-auto">
        {#each campaigns as summary}
          <CampaignSummaryCard
            {summary}
            onclick={() => onSelect(summary.id)}
            menuItemId="campaign-{summary.id}"
          />
        {/each}
      </div>
    {/if}
  {/snippet}

  {#snippet actions()}
    <button type="button" class="btn btn-ghost" onclick={onclose}>Close</button>
  {/snippet}
</Modal>
