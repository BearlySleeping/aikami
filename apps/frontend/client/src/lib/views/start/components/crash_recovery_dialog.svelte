<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/crash_recovery_dialog.svelte
//
// C-334 AC-5: a stale session marker means the last run ended without a
// clean shutdown. Offer the last save back instead of dropping the player on
// a start menu that silently pretends the crash never happened.

type Props = {
  isRecovering: boolean;
  onaccept: () => void;
  ondecline: () => void;
};

let { isRecovering, onaccept, ondecline }: Props = $props();

/** Escape declines — same as the backdrop. */
const handleKeyDown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') {
    ondecline();
  }
};

/** Focuses the dialog as soon as it mounts. */
const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  node.focus();
  return { destroy: () => {} };
};
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-label="Recover previous session"
  tabindex="-1"
  data-testid="crash-recovery-dialog"
  use:focusOnMount
>
  <button
    type="button"
    class="absolute inset-0 bg-black/60 backdrop-blur-sm"
    aria-label="Dismiss recovery prompt"
    tabindex="-1"
    onclick={ondecline}
  ></button>

  <div class="relative w-full max-w-sm rounded-box bg-base-200 p-6 shadow-2xl">
    <h2 class="mb-2 text-lg font-bold">Pick up where you left off?</h2>
    <p class="mb-1 text-sm text-base-content/70">
      Your last session ended unexpectedly. We can reopen it from its most recent save.
    </p>
    <p class="mb-6 text-xs text-base-content/40">
      Dismissing this leaves the campaign untouched — you can still load it from Load Campaign.
    </p>

    <div class="flex justify-end gap-3">
      <button type="button" class="btn btn-ghost" disabled={isRecovering} onclick={ondecline}>
        Not now
      </button>
      <button type="button" class="btn btn-primary" disabled={isRecovering} onclick={onaccept}>
        {#if isRecovering}
          <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
        {/if}
        Resume
      </button>
    </div>
  </div>
</div>
