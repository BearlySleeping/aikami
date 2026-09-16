<script lang="ts">
// apps/frontend/client/src/lib/views/inventory/inventory_view.svelte
//
// Inventory surface. C-543 PART B: a single CONTENT presentation is shared by
// the standalone modal wrapper and the management workspace. Only the standalone
// wrapper contributes a backdrop, `role="dialog"`, focus-on-mount and the
// Close/X control; inside the management host the section contributes content
// only, so there is no second top-level dialog, backdrop or close action.
//
// Equip/unequip updates the LPC character via the equipment service (C-374).

import { BaseViewModelContainer } from '$components';
import type { InventoryViewModelInterface } from './inventory_view_model.svelte';

type Props = {
  viewModel: InventoryViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#snippet children()}
    {#snippet inventoryBody()}
      <div class="flex min-h-full w-full flex-col gap-4">
        <!-- Stat totals -->
        <div class="flex justify-center gap-6">
          <div class="badge badge-lg badge-outline gap-1 px-4 py-3">
            <span class="game-eyebrow">ATK</span>
            <span class="font-semibold text-warning game-numeric">{viewModel.totalAttack}</span>
          </div>
          <div class="badge badge-lg badge-outline gap-1 px-4 py-3">
            <span class="game-eyebrow">DEF</span>
            <span class="font-semibold text-info game-numeric">{viewModel.totalDefense}</span>
          </div>
        </div>

        <!-- Paperdoll -->
        <div class="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-sm mx-auto">
          {#each viewModel.slotOrder as slot (slot)}
            {@const equipped = viewModel.getEquippedItem(slot)}
            <div
              class="rounded-lg border p-2 flex flex-col items-center justify-center text-center transition-colors {viewModel.getSlotGridClass(slot)} {equipped ? 'border-primary/40 bg-primary/5' : 'border-base-300 bg-base-200'}"
            >
              <div class="text-lg leading-none">{viewModel.getSlotIcon(slot)}</div>
              <div class="mt-1 game-eyebrow text-center">{viewModel.getSlotLabel(slot)}</div>
              {#if equipped}
                <div class="mt-1 text-sm font-medium text-base-content leading-tight line-clamp-2">
                  {equipped.definition.label}
                </div>
                <div class="mt-0.5 flex items-center gap-1 flex-wrap justify-center">
                  {#if equipped.definition.attackBonus > 0}
                    <span class="game-metadata font-semibold text-warning"
                      >+{equipped.definition.attackBonus}
                      ATK</span
                    >
                  {/if}
                  {#if equipped.definition.defenseBonus > 0}
                    <span class="game-metadata font-semibold text-info"
                      >+{equipped.definition.defenseBonus}
                      DEF</span
                    >
                  {/if}
                </div>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost text-error mt-1"
                  onclick={() => viewModel.unequipItem(slot)}
                  aria-label="Unequip {equipped.definition.label}"
                >
                  Unequip
                </button>
              {:else}
                <div class="mt-1 game-metadata">Empty</div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Transient feedback (inventory full / used item / full HP) -->
        {#if viewModel.feedbackMessage}
          <div class="alert alert-warning py-1.5 px-3" role="status">
            <span class="text-sm font-semibold">{viewModel.feedbackMessage}</span>
          </div>
        {/if}

        <!-- Bag items -->
        <div class="flex items-center justify-between gap-2">
          <h3 class="game-section-title">Bag</h3>
          {#if viewModel.hasItems}
            <fieldset class="join m-0 border-0 p-0">
              <legend class="sr-only">Sort bag</legend>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-active={viewModel.sortMode === 'acquired'}
                onclick={() => viewModel.setSortMode('acquired')}
              >
                Recent
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-active={viewModel.sortMode === 'name'}
                onclick={() => viewModel.setSortMode('name')}
              >
                Name
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-active={viewModel.sortMode === 'quantity'}
                onclick={() => viewModel.setSortMode('quantity')}
              >
                Qty
              </button>
            </fieldset>
          {/if}
        </div>

        {#if viewModel.hasItems}
          <label class="block">
            <span class="sr-only">Search bag</span>
            <input
              class="input input-bordered w-full"
              type="search"
              placeholder="Search items…"
              data-testid="inventory-search"
              value={viewModel.searchQuery}
              oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
            >
          </label>
        {/if}

        {#if !viewModel.hasItems}
          <div class="game-empty game-surface--inset rounded-lg">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <title>Empty bag</title>
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
            <p class="game-body-text font-medium">No items collected yet</p>
            <p class="game-metadata">Walk up to items and press E to collect them</p>
          </div>
        {:else if viewModel.visibleItems.length === 0}
          <p class="game-metadata">No items match “{viewModel.searchQuery}”.</p>
        {:else}
          <div class="game-item-grid">
            {#each viewModel.visibleItems as item (item.itemId)}
              <div class="game-surface--inset flex flex-col items-center gap-1 rounded-lg p-3">
                <div class="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                  <span class="text-lg font-bold text-primary"
                    >{item.itemId.charAt(0).toUpperCase()}</span
                  >
                </div>
                <span class="game-body-text truncate w-full text-center">
                  {viewModel.getItemLabel(item.itemId)}
                </span>
                {#if item.quantity > 1}
                  <span class="badge badge-sm badge-primary game-numeric">{item.quantity}</span>
                {/if}
                {#if viewModel.isEquippable(item.itemId)}
                  <span class="game-metadata font-semibold text-warning">
                    {viewModel.getCompareLabel(item.itemId)}
                  </span>
                  <button
                    type="button"
                    class="btn btn-xs btn-primary btn-outline mt-1"
                    onclick={() => viewModel.equipItem(item.itemId)}
                    aria-label="Equip {viewModel.getItemLabel(item.itemId)}"
                  >
                    Equip
                  </button>
                {/if}
                {#if viewModel.isConsumable(item.itemId)}
                  <button
                    type="button"
                    class="btn btn-xs btn-secondary btn-outline mt-1"
                    onclick={() => viewModel.useItem(item.itemId)}
                    aria-label="Use {viewModel.getItemLabel(item.itemId)}"
                  >
                    Use
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if viewModel.isStandalonePresentation}
          <div class="flex justify-center pt-1">
            <kbd class="kbd kbd-sm game-metadata">I</kbd>
            <span class="mx-2 game-metadata self-center">to close</span>
          </div>
        {/if}
      </div>
    {/snippet}

    {#if viewModel.isStandalonePresentation}
      <div
        class={viewModel.overlayClass}
        role="dialog"
        aria-modal="true"
        aria-label="Inventory"
        tabindex="-1"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
      >
        <div class="card max-h-[85vh] w-full max-w-xl overflow-y-auto bg-base-100 shadow-xl">
          <div class="card-body gap-4 p-6">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-bold text-base-content">Inventory</h2>
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-circle"
                onclick={() => viewModel.closeInventory()}
                aria-label="Close inventory"
              >
                ✕
              </button>
            </div>
            <div class="divider my-0"></div>
            {@render inventoryBody()}
          </div>
        </div>
      </div>
    {:else}
      <div class="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto p-1">
        {@render inventoryBody()}
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
