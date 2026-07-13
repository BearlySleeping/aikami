<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/new_adventure_confirm_dialog.svelte
import { Modal } from '@aikami/frontend/components';

type Props = {
  open: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
};

let { open = $bindable(), onConfirm, onCancel }: Props = $props();
</script>

<Modal bind:open size="sm" onclose={onCancel}>
  {#snippet title()}
    <h3 class="text-lg font-bold">New Adventure?</h3>
  {/snippet}

  {#snippet children()}
    <p class="text-sm text-base-content/70">
      Start a new adventure? Your current progress will be saved and a new campaign will be created.
    </p>
  {/snippet}

  {#snippet actions()}
    <button type="button" class="btn btn-ghost" onclick={onCancel}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={() => onConfirm()}>New Adventure</button>
  {/snippet}
</Modal>
