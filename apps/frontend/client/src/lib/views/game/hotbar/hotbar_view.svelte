<script lang="ts">
// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte
//
// Hotbar — 6-slot ability bar at the bottom of the game HUD.
// Keyboard shortcuts 1-6, click to activate. Keybinding labels visible in slots.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import { getHotbarViewModel, type HotbarViewModelInterface } from './hotbar_view_model.svelte';

type Props = {
  viewModel?: HotbarViewModelInterface;
};

const { viewModel = getHotbarViewModel({ className: 'HotbarViewModel' }) }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.visible}
    <div class="hotbar-container">
      {#each viewModel.slots as slot}
        <button
          type="button"
          class="hotbar-slot {slot.filled ? 'slot-filled' : 'slot-empty'} {slot.canUse ? '' : 'slot-depleted'}"
          onclick={() => viewModel.activateSlot(slot.index)}
          title={slot.filled ? slot.label : `Slot ${slot.keybind} (empty)`}
        >
          <span class="slot-keybind">{slot.keybind}</span>
          {#if slot.filled}
            <span class="slot-label">{slot.label}</span>
            {#if slot.usesRemaining !== null}
              <span class="slot-uses">{slot.usesRemaining}</span>
            {/if}
          {:else}
            <span class="slot-placeholder">+</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</BaseViewModelContainer>

<style>
.hotbar-container {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 0.75rem 0.75rem 0 0;
  z-index: 60;
}

.hotbar-slot {
  width: 4rem;
  height: 4rem;
  border-radius: 0.5rem;
  border: 2px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.hotbar-slot:hover {
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.1);
}

.slot-filled {
  border-color: rgba(168, 85, 247, 0.6); /* purple tint */
  background: rgba(168, 85, 247, 0.1);
}

.slot-filled:hover {
  border-color: rgba(168, 85, 247, 0.9);
  background: rgba(168, 85, 247, 0.2);
}

.slot-depleted {
  opacity: 0.4;
  cursor: not-allowed;
}

.slot-keybind {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 0.65rem;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
}

.slot-label {
  font-size: 0.6rem;
  color: white;
  text-align: center;
  line-height: 1.1;
  padding: 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 2.4rem;
}

.slot-placeholder {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.2);
}

.slot-uses {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 0.6rem;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}

.slot-empty {
  opacity: 0.5;
}

.slot-empty:hover {
  opacity: 0.7;
}
</style>
