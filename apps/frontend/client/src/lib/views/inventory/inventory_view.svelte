<script lang="ts">
// apps/frontend/client/src/lib/views/inventory/inventory_view.svelte
//
// Production inventory task surface (C-551): equipment, bag and selected-item
// detail share one responsive composition. The standalone wrapper below keeps
// the legacy direct-overlay entry point without changing domain ownership.

import { BaseViewModelContainer } from '$components';
import { createInventoryPresentationState } from './inventory_presentation.svelte';
import type { InventoryViewModelInterface } from './inventory_view_model.svelte';

type Props = {
  viewModel: InventoryViewModelInterface;
};

const { viewModel }: Props = $props();
const presentation = createInventoryPresentationState({
  get items() {
    return viewModel.items;
  },
  getCompareLabel: (itemId) => viewModel.getCompareLabel(itemId),
});
</script>

<BaseViewModelContainer {viewModel} class="h-full min-h-0">
  {#snippet children()}
    {#snippet inventoryBody()}
      <div class="@container h-full min-h-0 w-full">
        <div class="game-inventory-layout">
          <section
            class="game-inventory__panel game-surface--raised"
            data-testid="inventory-paperdoll"
          >
            <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="game-eyebrow">Paperdoll</p>
                <h2 class="game-section-title">Equipment</h2>
              </div>
              <div class="flex gap-2">
                <span class="game-badge game-numeric game-numeric--attack">
                  ATK {viewModel.totalAttack}
                </span>
                <span class="game-badge game-numeric game-numeric--defense">
                  AC {viewModel.totalDefense}
                </span>
              </div>
            </header>

            <div class="game-inventory__paperdoll">
              {#each viewModel.slotOrder as slot (slot)}
                {@const equipped = viewModel.getEquippedItem(slot)}
                <div
                  class={`game-inventory__slot ${presentation.slotClass(slot, equipped !== undefined)}`}
                >
                  <span class="text-xl" aria-hidden="true">{viewModel.getSlotIcon(slot)}</span>
                  <span class="game-eyebrow text-center">{viewModel.getSlotLabel(slot)}</span>
                  {#if equipped}
                    <span class="game-body-text line-clamp-2 text-center text-sm font-semibold">
                      {equipped.definition.label}
                    </span>
                    <button
                      type="button"
                      class="btn btn-xs game-control--quiet"
                      onclick={() => viewModel.unequipItem(slot)}
                      aria-label="Unequip {equipped.definition.label}"
                    >
                      Unequip
                    </button>
                  {:else}
                    <span class="game-metadata">Empty</span>
                  {/if}
                </div>
              {/each}
            </div>
          </section>

          <section class="game-inventory__panel game-surface--raised" data-testid="inventory-bag">
            <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="game-eyebrow">Carried gear</p>
                <h2 class="game-section-title">Bag</h2>
              </div>
              {#if viewModel.hasItems}
                <fieldset class="game-segmented">
                  <legend class="sr-only">Sort bag</legend>
                  <button
                    type="button"
                    aria-pressed={viewModel.sortMode === 'acquired'}
                    onclick={() => viewModel.setSortMode('acquired')}
                  >
                    Recent
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewModel.sortMode === 'name'}
                    onclick={() => viewModel.setSortMode('name')}
                  >
                    Name
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewModel.sortMode === 'quantity'}
                    onclick={() => viewModel.setSortMode('quantity')}
                  >
                    Qty
                  </button>
                </fieldset>
              {/if}
            </header>

            {#if viewModel.feedbackMessage}
              <div class="game-notice game-notice--warning mb-3" role="status">
                {viewModel.feedbackMessage}
              </div>
            {/if}

            {#if viewModel.hasItems}
              <label class="mb-3 block">
                <span class="sr-only">Search bag</span>
                <input
                  class="input w-full"
                  type="search"
                  placeholder="Search items…"
                  data-testid="inventory-search"
                  value={viewModel.searchQuery}
                  oninput={(event) => viewModel.setSearchQuery(event.currentTarget.value)}
                >
              </label>
            {/if}

            {#if !viewModel.hasItems}
              <div class="game-empty" data-testid="inventory-empty-state">
                <span class="text-4xl" aria-hidden="true">🎒</span>
                <p class="game-section-title">Your bag is empty</p>
                <p class="game-metadata max-w-sm">
                  Collect an item in the world with E. Equipment and supplies will stay grouped
                  here.
                </p>
              </div>
            {:else if viewModel.visibleItems.length === 0}
              <div class="game-empty game-empty--inline">
                <p class="game-body-text font-semibold">No matching items</p>
                <p class="game-metadata">Clear the search to return to the full bag.</p>
              </div>
            {:else}
              <ul class="game-inventory__list" data-testid="inventory-item-list">
                {#each viewModel.visibleItems as item (item.itemId)}
                  <li
                    class={`game-inventory__item ${presentation.itemClass(item.itemId)}`}
                    data-testid={`inventory-item-${item.itemId}`}
                  >
                    <button
                      type="button"
                      class="game-inventory__item-select"
                      aria-pressed={presentation.isSelected(item.itemId)}
                      onclick={() => presentation.selectItem(item.itemId)}
                    >
                      <span class="game-inventory__item-icon" aria-hidden="true">
                        {item.initial}
                      </span>
                      <span class="min-w-0 flex-1 text-start">
                        <span class="game-body-text block truncate font-semibold">
                          {viewModel.getItemLabel(item.itemId)}
                        </span>
                        <span class="game-metadata block">
                          {viewModel.isEquippable(item.itemId) ? 'Equipment' : 'Supply'}
                          {#if viewModel.isConsumable(item.itemId)}
                            · Consumable
                          {/if}
                        </span>
                      </span>
                      <span class="game-badge game-numeric">×{item.quantity}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if viewModel.isStandalonePresentation}
              <div class="flex justify-center pt-1">
                <kbd class="kbd kbd-sm game-metadata">I</kbd>
                <span class="mx-2 game-metadata self-center">to close</span>
              </div>
            {/if}
          </section>

          <aside class="game-inventory__panel game-surface--raised" data-testid="inventory-detail">
            <header class="mb-3">
              <p class="game-eyebrow">Selection</p>
              <h2 class="game-section-title">Item details</h2>
            </header>

            {#if presentation.selectedItem}
              <div class="flex min-h-0 flex-1 flex-col gap-3">
                <div class="game-surface--inset flex items-center gap-3 rounded-lg p-3">
                  <span class="game-inventory__detail-icon" aria-hidden="true">
                    {presentation.selectedItem.label.charAt(0)}
                  </span>
                  <div class="min-w-0">
                    <p class="game-section-title truncate">{presentation.selectedItem.label}</p>
                    <p class="game-metadata">{presentation.selectedItem.definition.itemType}</p>
                  </div>
                </div>

                <dl class="game-detail-list">
                  <div>
                    <dt>Quantity</dt>
                    <dd class="game-numeric">{presentation.selectedItem.quantity}</dd>
                  </div>
                  {#if presentation.selectedItem.definition.slot}
                    <div>
                      <dt>Slot</dt>
                      <dd>{viewModel.getSlotLabel(presentation.selectedItem.definition.slot)}</dd>
                    </div>
                  {/if}
                  <div>
                    <dt>Attack</dt>
                    <dd class="game-numeric game-numeric--attack">
                      {presentation.selectedItem.definition.attackBonus}
                    </dd>
                  </div>
                  <div>
                    <dt>Defense</dt>
                    <dd class="game-numeric game-numeric--defense">
                      {presentation.selectedItem.definition.defenseBonus}
                    </dd>
                  </div>
                </dl>

                <div class="flex flex-wrap gap-1">
                  <span class="game-badge">
                    {presentation.selectedItem.isEquippable ? 'Equippable' : 'Not equippable'}
                  </span>
                  {#if presentation.selectedItem.isConsumable}
                    <span class="game-badge game-badge--positive">Usable</span>
                  {/if}
                  {#if presentation.selectedItem.compareLabel}
                    <span class="game-badge game-badge--accent">
                      {presentation.selectedItem.compareLabel}
                    </span>
                  {/if}
                </div>

                <div class="mt-auto flex flex-wrap gap-2">
                  {#if presentation.selectedItem.isEquippable}
                    <button
                      type="button"
                      class="btn game-control--accent"
                      onclick={() => viewModel.equipItem(presentation.selectedItemId ?? '')}
                      aria-label="Equip {presentation.selectedItem.label}"
                    >
                      Equip
                    </button>
                  {/if}
                  {#if presentation.selectedItem.isConsumable}
                    <button
                      type="button"
                      class="btn game-control--accent"
                      onclick={() => viewModel.useItem(presentation.selectedItemId ?? '')}
                      aria-label="Use {presentation.selectedItem.label}"
                    >
                      Use
                    </button>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="game-empty">
                <span class="text-3xl" aria-hidden="true">◇</span>
                <p class="game-section-title">No item selected</p>
                <p class="game-metadata max-w-xs">
                  {viewModel.hasItems
                  ? 'Choose a bag item to read its stats and available actions.'
                  : 'Collect equipment or supplies to reveal their details here.'}
                </p>
              </div>
            {/if}
          </aside>
        </div>
      </div>
    {/snippet}

    {#if viewModel.isStandalonePresentation}
      <div
        class={viewModel.overlayClass}
        role="dialog"
        aria-modal="true"
        aria-label="Inventory"
        tabindex="-1"
        data-testid="inventory-overlay"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
      >
        <div class="card game-surface max-h-[85vh] w-full max-w-6xl overflow-y-auto shadow-xl">
          <div class="card-body gap-4 p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="game-eyebrow">Adventure gear</p>
                <h2 class="game-section-title">Inventory</h2>
              </div>
              <button
                type="button"
                class="btn btn-sm game-control--quiet btn-circle"
                onclick={() => viewModel.closeInventory()}
                aria-label="Close inventory"
              >
                ×
              </button>
            </div>
            {@render inventoryBody()}
          </div>
        </div>
      </div>
    {:else}
      <div class="game-workspace__scroll" data-testid="inventory-overlay">
        {@render inventoryBody()}
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
