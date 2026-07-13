<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/campaign_summary_card.svelte
import type { CampaignSummary } from '../start_view_model.svelte';

type Props = {
  summary: CampaignSummary;
  onclick?: () => void;
  /** Optional data attribute for keyboard focus targeting. */
  menuItemId?: string;
};

let { summary, onclick, menuItemId }: Props = $props();

/** Short relative timestamp label (e.g. "Jul 14, 2026, 12:00 PM"). */
const formattedLastSaved = $derived(
  summary.lastSavedAt ? new Date(summary.lastSavedAt).toLocaleString() : 'Not yet saved',
);
</script>

<button
  type="button"
  class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow text-left w-full"
  data-menu-item={menuItemId}
  {onclick}
>
  <div class="card-body p-4">
    <!-- Campaign name + state badges -->
    <div class="flex items-center gap-2">
      <h3 class="card-title text-base">{summary.name}</h3>
      {#if summary.isFailed}
        <span class="badge badge-error badge-sm">Failed</span>
      {:else if summary.isCreating}
        <span class="badge badge-warning badge-sm">Setup</span>
      {/if}
    </div>

    <!-- Content pack -->
    <p class="text-xs text-base-content/60">Content: {summary.contentPackLabel}</p>

    <!-- Last saved -->
    <p class="text-xs text-base-content/50">
      {#if summary.lastSavedAt}
        Saved: {formattedLastSaved}
      {:else}
        {summary.lastSavedLabel}
      {/if}
    </p>

    <!-- AI capability badges -->
    <div class="flex gap-1 mt-1">
      <span
        class="badge badge-xs {summary.capabilities.textProvider ? 'badge-success' : 'badge-ghost'}"
      >
        Text
      </span>
      <span
        class="badge badge-xs {summary.capabilities.imageProvider
          ? 'badge-success'
          : 'badge-ghost'}"
      >
        Image
      </span>
      <span
        class="badge badge-xs {summary.capabilities.voiceProvider ? 'badge-success' : 'badge-ghost'}"
      >
        Voice
      </span>
    </div>
  </div>
</button>
