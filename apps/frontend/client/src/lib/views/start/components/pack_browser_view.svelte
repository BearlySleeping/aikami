<script lang="ts">
// apps/frontend/client/src/lib/views/start/components/pack_browser_view.svelte
//
// Pack browser UI component — displays installed content packs as cards
// with metadata and a detail panel for the selected pack.
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import type { PackIndexEntry } from '@aikami/types';

type Props = {
  /** All installed content packs. */
  packs: readonly PackIndexEntry[];
  /** The currently selected pack ID, or undefined. */
  selectedPackId: string | undefined;
  /** Called when a pack card is clicked. */
  onselect: (packId: string) => void;
  /** Called when the player confirms their selection. */
  onconfirm: () => void;
  /** Called when the player cancels pack selection. */
  oncancel: () => void;
};

let { packs, selectedPackId, onselect, onconfirm, oncancel }: Props = $props();
</script>

<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-label="Choose Your Adventure"
  tabindex="-1"
>
  <div class="modal-box max-w-2xl">
    <h3 class="text-lg font-bold mb-4">Choose Your Adventure</h3>

    {#if packs.length === 0}
      <p class="text-base-content/60">No content packs installed.</p>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => oncancel()}>Cancel</button>
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {#each packs as pack}
          <button
            type="button"
            class="card bg-base-200 border-2 cursor-pointer text-left p-4 transition-colors {selectedPackId === pack.id
              ? 'border-primary'
              : 'border-base-300 hover:border-base-content/30'}"
            onclick={() => onselect(pack.id)}
            aria-label="Select {pack.name}"
          >
            <h4 class="font-semibold text-base">{pack.name}</h4>
            <p class="text-xs text-base-content/60 font-mono">v{pack.version}</p>
            {#if pack.description}
              <p class="text-sm text-base-content/70 mt-2 line-clamp-2">{pack.description}</p>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Detail panel for selected pack -->
      {#if selectedPackId}
        {@const selectedPack = packs.find((p) => p.id === selectedPackId)}
        {#if selectedPack}
          <div class="bg-base-300 rounded-lg p-4 mb-4">
            <h4 class="font-semibold text-base mb-2">{selectedPack.name}</h4>
            <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span class="text-base-content/60">Version</span>
              <span class="font-mono">{selectedPack.version}</span>
              <span class="text-base-content/60">Updated</span>
              <span>{new Date(selectedPack.updatedAt).toLocaleDateString()}</span>
            </div>
            {#if selectedPack.description}
              <p class="text-sm text-base-content/80 mt-3">{selectedPack.description}</p>
            {/if}
          </div>
        {/if}
      {/if}

      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => oncancel()}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={!selectedPackId}
          onclick={() => onconfirm()}
        >
          Start New Game
        </button>
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="modal-backdrop border-none bg-transparent p-0"
    onclick={() => oncancel()}
    onkeydown={(e) => { if (e.key === 'Enter') { oncancel(); } }}
    aria-label="Close"
  ></button>
</div>
