<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/campaign_summary_card.svelte
import type { CampaignSummary } from '../start_view_model.svelte';

type Props = {
  campaign: CampaignSummary;
  onclick?: () => void;
  /** When true, the card shows a "Failed to load" indicator and blocks click. */
  isFailed?: boolean;
};

let { campaign, onclick, isFailed = false }: Props = $props();

/** Formats an ISO timestamp to a short relative or absolute date string. */
const formatDate = (iso: string | undefined): string => {
  if (!iso) {
    return 'Not yet saved';
  }
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};
</script>

<button
  type="button"
  class="card card-compact bg-base-100 border border-base-300 w-full text-left hover:border-primary transition-colors {isFailed ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}"
  onclick={isFailed ? undefined : onclick}
  disabled={isFailed}
>
  <div class="card-body">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h3 class="card-title text-sm font-semibold truncate">{campaign.name}</h3>
        <p class="text-xs text-base-content/60 mt-0.5">{campaign.contentPackLabel}</p>
      </div>

      <!-- AI capability badges -->
      <div class="flex gap-1 shrink-0">
        {#if campaign.capabilities.textProvider}
          <span class="badge badge-xs badge-primary" title="Text AI available">AI</span>
        {:else}
          <span class="badge badge-xs badge-ghost" title="Text AI unavailable">AI</span>
        {/if}
        {#if campaign.capabilities.imageProvider}
          <span class="badge badge-xs badge-primary" title="Image AI available">Img</span>
        {:else}
          <span class="badge badge-xs badge-ghost" title="Image AI unavailable">Img</span>
        {/if}
        {#if campaign.capabilities.voiceProvider}
          <span class="badge badge-xs badge-primary" title="Voice AI available">Vox</span>
        {:else}
          <span class="badge badge-xs badge-ghost" title="Voice AI unavailable">Vox</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center justify-between mt-1">
      <span class="text-xs text-base-content/40">
        {formatDate(campaign.lastSavedAt)}
      </span>
      {#if isFailed}
        <span class="text-xs text-error">Failed to load</span>
      {:else if campaign.isResumable}
        <span class="text-xs text-success">Resumable</span>
      {:else}
        <span class="text-xs text-warning">{campaign.lastSavedAt ? 'Saved' : 'New'}</span>
      {/if}
    </div>
  </div>
</button>
