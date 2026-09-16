<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/party_hud.svelte
//
// C-543 PART F — party status surface.
//
// MVVM restoration: this view no longer imports `gameOverlayService` or
// `partyRosterService`. The roster is projected by the game UI ViewModel
// (`partyStatus`) and reaches the view as a prop; the open action is an
// injected callback. Identity uses the real member name/class the domain
// exposes — there is no portrait capability, so members render a neutral
// initial avatar rather than an invented image.

import type { HudPartyStatus } from './game_ui_status_projections.ts';

type Props = {
  status: HudPartyStatus;
  visible: boolean;
  onOpen: () => void;
};

const { status, visible, onOpen }: Props = $props();
</script>

{#if visible && !status.isEmpty}
  <button
    type="button"
    class="hud-party pointer-events-auto"
    data-testid="party-hud"
    aria-label={status.accessibleLabel}
    onclick={() => onOpen()}
  >
    <span class="hud-party__avatars" aria-hidden="true">
      {#each status.members as member (member.npcId)}
        <span class="hud-party__portrait" title={member.name}>{member.initial}</span>
      {/each}
    </span>
    <span class="hud-party__count game-numeric">{status.label}</span>
    {#if status.needsAttention}
      <span class="hud-party__attention" title="A companion is unhappy">!</span>
    {/if}
  </button>
{/if}
