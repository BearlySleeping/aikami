<script lang="ts">
// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte
//
// Hotbar — 6-slot ability bar at the bottom of the game HUD.
// Keyboard shortcuts 1-6, click to activate. Keybinding labels visible in slots.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import { BaseViewModelContainer } from '$components';
import { getHotbarViewModel, type HotbarViewModelInterface } from './hotbar_view_model.svelte';

type Props = {
  viewModel?: HotbarViewModelInterface;
};

const { viewModel = getHotbarViewModel({ className: 'HotbarViewModel' }) }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.visible}
    <div
      class="fixed bottom-0 left-1/2 -translate-x-1/2 flex gap-2 p-3 bg-black/70 rounded-t-xl z-[60]"
    >
      {#each viewModel.slots as slot}
        <button
          type="button"
          class={slot.className}
          onclick={() => viewModel.activateSlot(slot.index)}
          title={slot.title}
        >
          <span class="absolute top-0.5 left-1 text-[0.65rem] text-white/50 font-bold"
            >{slot.keybind}</span
          >
          {#if slot.filled}
            <span
              class="text-[0.6rem] text-white text-center leading-tight px-0.5 overflow-hidden text-ellipsis max-h-[2.4rem]"
              >{slot.label}</span
            >
            {#if slot.usesRemaining !== null}
              <span class="absolute bottom-0.5 right-1 text-[0.6rem] text-white/70 font-semibold"
                >{slot.usesRemaining}</span
              >
            {/if}
          {:else}
            <span class="text-[1.2rem] text-white/20">+</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</BaseViewModelContainer>
