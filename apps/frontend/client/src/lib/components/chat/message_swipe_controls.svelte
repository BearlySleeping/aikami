<script lang="ts">
  // apps/frontend/client/src/lib/components/chat/message_swipe_controls.svelte
  //
  // Left/right arrow buttons + alternative counter badge for browsing
  // alternative AI responses. Only renders when alternatives.length > 1.
  //
  // Contract: C-231 AC-1 Message Branching & Swiping

  type Props = {
    /** Whether swipe left is available. */
    canSwipeLeft: boolean;
    /** Whether swipe right is available. */
    canSwipeRight: boolean;
    /** Display label for alternative counter (e.g. "2/3"). */
    label: string;
    /** Called when left arrow is clicked. */
    onSwipeLeft: () => void;
    /** Called when right arrow is clicked. */
    onSwipeRight: () => void;
  };

  const { canSwipeLeft, canSwipeRight, label, onSwipeLeft, onSwipeRight }: Props = $props();

  const shouldShow = $derived(label.length > 0);
</script>

{#if shouldShow}
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="btn btn-ghost btn-xs px-1"
      disabled={!canSwipeLeft}
      onclick={(e) => {
        e.stopPropagation();
        onSwipeLeft();
      }}
      aria-label="Previous alternative"
    >
      ◀
    </button>
    <span class="text-xs font-mono text-base-content/50">{label}</span>
    <button
      type="button"
      class="btn btn-ghost btn-xs px-1"
      disabled={!canSwipeRight}
      onclick={(e) => {
        e.stopPropagation();
        onSwipeRight();
      }}
      aria-label="Next alternative"
    >
      ▶
    </button>
  </div>
{/if}
