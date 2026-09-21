<script lang="ts">
// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte
//
// Hotbar — 6-slot ability bar at the bottom of the game HUD.
// Keyboard shortcuts 1-6, click to activate. Keybinding labels visible in slots.
//
// C-543 PART F: presentation consumes semantic slot state
// (`availability`, `usesRemaining`, `unavailableReason`) and the game-scoped
// theme classes. There are no black/white/purple literals and no `visible` flag
// — assigning zero abilities means the resolver/wrapper renders nothing, so no
// empty hotbar region is reserved.
//
// Contract: C-337, C-543 PART F.

import { BaseViewModelContainer } from '$components';
import { getHotbarViewModel } from './hotbar_composition.ts';
import type { HotbarViewModelInterface } from './hotbar_view_model.svelte';

type Props = {
  viewModel?: HotbarViewModelInterface;
};

const { viewModel = getHotbarViewModel({ className: 'HotbarViewModel' }) }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.hasAssignedSlots}
    <div class="hud-hotbar pointer-events-auto" data-testid="hotbar">
      {#each viewModel.assignedSlots as slot (slot.index)}
        <button
          type="button"
          class="hud-hotbar__slot hud-hotbar__slot--{slot.availability}"
          data-testid="hotbar-slot-{slot.index}"
          disabled={!slot.canUse}
          title={slot.title}
          aria-label={slot.title}
          onclick={() => viewModel.activateSlot(slot.index)}
        >
          <span class="hud-hotbar__key" aria-hidden="true">{slot.keybind}</span>
          <span class="hud-hotbar__label">{slot.label}</span>
          {#if slot.usesRemaining !== null}
            <span class="hud-hotbar__uses game-numeric">{slot.usesRemaining}</span>
          {/if}
          {#if slot.unavailableReason}
            <span class="hud-hotbar__reason">{slot.unavailableReason}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</BaseViewModelContainer>
