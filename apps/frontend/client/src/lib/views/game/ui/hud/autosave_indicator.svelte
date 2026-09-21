<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/autosave_indicator.svelte
//
// Autosave indicator HUD element — shows transient autosave status adjacent to
// the clock in the top-right HUD zone.
//
// C-543 PART F: theme-semantic `.hud-notice` styling; success stays quiet and
// transient. The persistent, actionable Save-failed state is owned by the
// required `system-notice` widget, so this optional widget may be hidden.
//
// Contract: C-332 AC-3, C-543 PART F.

type Props = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  visible: boolean;
};

const { status, visible }: Props = $props();
</script>

{#if visible && status !== 'idle'}
  <div class="hud-notice" role="status" aria-live="polite" data-testid="autosave-indicator">
    {#if status === 'saving'}
      <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      <span class="game-metadata">Saving…</span>
    {:else if status === 'saved'}
      <span class="hud-status__mark" aria-hidden="true"></span>
      <span class="game-metadata">Saved</span>
    {:else if status === 'error'}
      <span class="game-metadata">Save failed</span>
    {/if}
  </div>
{/if}
