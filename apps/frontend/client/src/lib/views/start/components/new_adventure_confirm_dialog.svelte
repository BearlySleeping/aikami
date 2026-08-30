<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/new_adventure_confirm_dialog.svelte
import type { CampaignSummary } from '../start_view_model.svelte';

type Props = {
  campaign: CampaignSummary;
  onconfirm: () => void;
  oncancel: () => void;
};

let { campaign, onconfirm, oncancel }: Props = $props();

/** Closes the dialog when the backdrop is clicked. */
const handleBackdropClick = (e: MouseEvent): void => {
  if (e.target === e.currentTarget) {
    oncancel();
  }
};

/** Handles keyboard events. */
const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    oncancel();
  }
};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Confirm new adventure"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
>
  <div class="bg-base-200 rounded-box shadow-2xl w-full max-w-sm p-6">
    <h2 class="text-lg font-bold mb-2">Start a new adventure?</h2>
    <p class="text-sm text-base-content/70 mb-1">
      Your current progress in <strong>{campaign.name}</strong> will be saved and a new campaign
      will be created.
    </p>
    <p class="text-xs text-base-content/40 mb-6">
      You can always return to this campaign from the Load Campaign menu.
    </p>

    <div class="flex gap-3 justify-end">
      <button type="button" class="btn btn-ghost" onclick={oncancel}>Cancel</button>
      <button type="button" class="btn btn-primary" onclick={onconfirm}>Start New Adventure</button>
    </div>
  </div>
</div>
