<script lang="ts">
  // apps/frontend/client/src/lib/views/start/components/missing_providers_dialog.svelte
  import { Modal } from '@aikami/frontend/components';

  let {
    open = $bindable(),
    onGoToSettings,
    onClose,
  }: {
    open: boolean;
    onGoToSettings: () => void;
    onClose: () => void;
  } = $props();
</script>

<Modal bind:open size="md" onclose={onClose}>
  {#snippet title()}
    <div class="flex justify-center mb-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-12 w-12 text-warning"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <title>icon</title>
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
    </div>
    <h3 class="text-lg font-bold text-center">AI Text Provider Required</h3>
  {/snippet}

  {#snippet children()}
    <p class="text-sm text-base-content/70">
      An AI text provider is required to play the game. We highly recommend configuring Image and
      Voice generation as well for the full experience.
    </p>
  {/snippet}

  {#snippet actions()}
    <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={onGoToSettings}>Go to Settings</button>
  {/snippet}
</Modal>
