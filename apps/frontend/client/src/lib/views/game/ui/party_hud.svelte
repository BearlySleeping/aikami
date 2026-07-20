<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/party_hud.svelte
//
// Party HUD widget — persistent companion count badge in the top-left
// game UI area. Clickable to open the party roster overlay.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-3)

import { gameOverlayService, partyRosterService } from '$services';

type Props = {
  /** Whether the widget should be visible (hidden during overlays). */
  visible: boolean;
};

const { visible }: Props = $props();
</script>

{#if visible && partyRosterService.activeCount > 0}
  <button
    type="button"
    class="btn btn-ghost btn-sm gap-1 text-base-content/80 hover:text-base-content"
    onclick={() => gameOverlayService.openPartyRoster()}
    aria-label="Open party roster"
    title="Party Roster (P)"
  >
    <span class="text-lg">🧑‍🤝‍🧑</span>
    <span class="font-mono text-xs"
      >{partyRosterService.activeCount}/{partyRosterService.maxSize}</span
    >
  </button>
{/if}
