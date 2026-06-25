<script lang="ts">
  // apps/frontend/client/src/lib/views/start/components/missing_providers_dialog.svelte
  let {
    onGoToSettings,
    onClose,
  }: {
    onGoToSettings: () => void;
    onClose: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- biome-ignore lint/a11y/useSemanticElements: modal overlay contains nested buttons -->
<div
  class="modal modal-open"
  role="button"
  tabindex="0"
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }}
>
  <div
    class="modal-box max-w-md"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label="AI Text Provider Required"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <!-- Icon -->
    <div class="flex justify-center mb-4">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-12 w-12 text-warning"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
    </div>

    <!-- Title -->
    <h3 class="text-lg font-bold text-center mb-4">AI Text Provider Required</h3>

    <!-- Message -->
    <p class="text-sm text-base-content/70 mb-6">
      An AI text provider is required to play the game. We highly recommend configuring Image and
      Voice generation as well for the full experience.
    </p>

    <!-- Actions -->
    <div class="modal-action flex gap-2 justify-center">
      <button class="btn btn-ghost" onclick={onClose}>Cancel</button>
      <button class="btn btn-primary" onclick={onGoToSettings}>Go to Settings</button>
    </div>
  </div>
</div>
