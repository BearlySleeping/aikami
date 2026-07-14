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

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
  onclick={onClose}
  onkeydown={(e) => { if (e.key === 'Escape') { onClose() }}}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <div
    class="max-h-[90vh] overflow-y-auto"
    onclick={(e: MouseEvent) => e.stopPropagation()}
    role="none"
  >
    {@render children()}
  </div>
</div>
