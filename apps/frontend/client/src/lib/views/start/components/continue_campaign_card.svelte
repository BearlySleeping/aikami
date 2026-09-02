<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/continue_campaign_card.svelte
//
// The start menu's hero action (C-317 AC-1). Continue is the one thing a
// returning player almost always wants, so it gets the whole width and says
// *which* campaign it resumes — a bare "Continue" button makes the player
// guess.
import type { CampaignSummary } from '../start_view_model.svelte';

type Props = {
  campaign: CampaignSummary;
  onclick: () => void;
};

let { campaign, onclick }: Props = $props();
</script>

<button
  type="button"
  class="group relative w-full overflow-hidden rounded-box border border-primary/40 bg-primary/10 px-5 py-4 text-left transition-colors hover:border-primary hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  data-testid="continue-campaign"
  {onclick}
>
  <span class="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary">Continue</span>

  <h2 class="mt-1 truncate pr-8 text-xl font-semibold leading-tight">{campaign.name}</h2>

  <p class="mt-1 truncate pr-8 text-xs text-base-content/60">
    {campaign.contentPackLabel}
    · {campaign.lastSavedLabel}
  </p>

  <span
    class="absolute right-5 top-1/2 -translate-y-1/2 text-primary transition-transform group-hover:translate-x-1"
  >
    <svg
      class="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</button>
