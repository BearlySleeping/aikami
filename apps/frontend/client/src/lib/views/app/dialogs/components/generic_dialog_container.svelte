<script lang="ts">
// apps/frontend/client/src/lib/views/app/dialogs/components/GenericDialogContainer.svelte
//
// Shared backdrop + centered container for all dialogs.
// Usage:
//   <GenericDialogContainer onClose={() => dialogService.close()}>
//     <YourDialogContent />
//   </GenericDialogContainer>

type Props = {
  onClose: () => void;
  children: import('svelte').Snippet;
};

let { onClose, children }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
  onclick={onClose}
  onkeydown={(e) => { if (e.key === 'Escape') { onClose() }}}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="max-h-[90vh] overflow-y-auto"
    onclick={(e: MouseEvent) => e.stopPropagation()}
    role="none"
  >
    {@render children()}
  </div>
</div>
