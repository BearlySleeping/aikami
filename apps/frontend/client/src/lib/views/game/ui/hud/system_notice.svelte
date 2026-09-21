<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/system_notice.svelte
//
// C-543 PART F — the required, persistent system notice.
//
// Unlike the transient autosave indicator, an actionable failure (save failed,
// action-affecting disconnection) must not disappear because of a theme or a
// temporary Hide HUD. `system-notice` is a required widget in the C-528 registry
// (never collapsed and never hideable), so this surface stays reachable and
// offers a recovery action.

import type { AutoSaveStatus } from '$types';

type Props = {
  status: AutoSaveStatus;
  visible: boolean;
  onRetry: () => void;
};

const { status, visible, onRetry }: Props = $props();
</script>

{#if visible && status === 'error'}
  <div class="hud-notice hud-notice--error" role="alert" data-testid="system-notice">
    <span>Save failed</span>
    <button type="button" class="hud-notice__action" onclick={() => onRetry()}>Retry</button>
  </div>
{/if}
