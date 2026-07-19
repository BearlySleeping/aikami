<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/autosave_indicator.svelte
//
// Autosave indicator HUD element — shows transient autosave status
// adjacent to the clock in the top-right HUD zone.
// Contract: C-332 AC-3

type Props = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  visible: boolean;
};

const { status, visible }: Props = $props();
</script>

{#if visible && status !== 'idle'}
  <div
    class="autosave-indicator flex items-center gap-1.5 rounded-full bg-base-200/80 px-2.5 py-1 backdrop-blur-sm text-xs"
    role="status"
    aria-live="polite"
    aria-label={status === 'saving' ? 'Autosaving' : status === 'saved' ? 'Autosave complete' : 'Autosave failed'}
  >
    {#if status === 'saving'}
      <span class="loading loading-spinner loading-xs"></span>
      <span class="text-base-content/70">Saving…</span>
    {:else if status === 'saved'}
      <span class="text-success">✓</span>
      <span class="text-success">Saved</span>
    {:else if status === 'error'}
      <span class="text-error">✗</span>
      <span class="text-error">Save failed</span>
    {/if}
  </div>
{/if}
