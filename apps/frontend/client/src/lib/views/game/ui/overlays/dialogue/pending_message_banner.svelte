<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/pending_message_banner.svelte
type Props = {
  messages: readonly string[];
  onRetry: () => void;
};

const { messages, onRetry }: Props = $props();
</script>

{#if messages.length > 0}
  <div class="border-t border-base-content/5 px-4 py-2" data-testid="pending-queue-banner">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-semibold text-base-content/70">
        Waiting to send ({messages.length})
      </span>
      <button
        type="button"
        class="btn btn-xs btn-primary"
        onclick={onRetry}
        aria-label="Send waiting messages"
      >
        Send
      </button>
    </div>
    <div class="mt-1 space-y-1">
      {#each messages as message, index (index)}
        <div class="rounded-lg bg-base-100/70 px-2 py-1 text-xs opacity-70">
          {message}
        </div>
      {/each}
    </div>
  </div>
{/if}
