<script lang="ts">
// apps/frontend/client/src/lib/views/inventory/inventory_view.svelte
//
// Inventory modal — 5-slot paperdoll (head, leftHand, body, rightHand,
// feet) + bag grid. Equip/unequip updates the LPC character via the
// equipment service (C-374).
import type { EquipmentSlot } from '@aikami/types';
import { BaseViewModelContainer } from '$components';
import type { InventoryViewModelInterface } from './inventory_view_model.svelte';

type Props = {
  viewModel: InventoryViewModelInterface;
};

const { viewModel }: Props = $props();

const SLOT_GRID_CLASS: Record<EquipmentSlot, string> = {
  head: 'col-start-2 row-start-1',
  leftHand: 'col-start-1 row-start-2',
  body: 'col-start-2 row-start-2',
  rightHand: 'col-start-3 row-start-2',
  feet: 'col-start-2 row-start-3',
};

const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  node.focus();
  return { destroy: () => {} };
};
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Inventory"
    tabindex="-1"
    onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) { viewModel.closeInventory(); } }}
    onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      viewModel.closeInventory();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const focusable = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }
      const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
      const direction = e.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }
  }}
    use:focusOnMount
  >
    <div class="card w-full max-w-xl bg-base-100 shadow-xl">
      <div class="card-body p-6 gap-4">
        <!-- Header -->
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

        <!-- Stat totals -->
        <div class="flex justify-center gap-6">
          <div class="badge badge-lg badge-outline gap-1 px-4 py-3">
            <span class="text-warning">⚔</span>
            <span class="font-semibold text-warning">{viewModel.totalAttack}</span>
            <span class="text-xs text-base-content/50">ATK</span>
          </div>
          <div class="badge badge-lg badge-outline gap-1 px-4 py-3">
            <span class="text-info">🛡</span>
            <span class="font-semibold text-info">{viewModel.totalDefense}</span>
            <span class="text-xs text-base-content/50">DEF</span>
          </div>
        </div>

        <!-- Paperdoll -->
        <div class="grid grid-cols-3 grid-rows-3 gap-2 w-full max-w-sm mx-auto">
          {#each viewModel.slotOrder as slot (slot)}
            {@const equipped = viewModel.getEquippedItem(slot)}
            <div
              class="rounded-lg border p-2 flex flex-col items-center justify-center text-center transition-colors {SLOT_GRID_CLASS[slot]} {equipped ? 'border-primary/40 bg-primary/5' : 'border-base-300 bg-base-200'}"
            >
              <div class="text-lg leading-none">{viewModel.getSlotIcon(slot)}</div>
              <div class="mt-1 text-[0.62rem] uppercase tracking-wide text-base-content/50">
                {viewModel.getSlotLabel(slot)}
              </div>
              {#if equipped}
                <div class="mt-1 text-xs font-medium text-base-content leading-tight line-clamp-2">
                  {equipped.definition.label}
                </div>
                <div class="mt-0.5 flex items-center gap-1 flex-wrap justify-center">
                  {#if equipped.definition.attackBonus > 0}
                    <span class="text-[0.6rem] font-semibold text-warning"
                      >+{equipped.definition.attackBonus}
                      ATK</span
                    >
                  {/if}
                  {#if equipped.definition.defenseBonus > 0}
                    <span class="text-[0.6rem] font-semibold text-info"
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
                <div class="mt-1 text-[0.62rem] text-base-content/30">Empty</div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="divider my-0"></div>

        <!-- Transient feedback (inventory full / used item / full HP) -->
        {#if viewModel.feedbackMessage}
          <div class="alert alert-warning py-1.5 px-3" role="status">
            <span class="text-xs font-semibold">{viewModel.feedbackMessage}</span>
          </div>
        {/if}

        <!-- Bag items -->
        <h3 class="text-sm font-semibold text-base-content/70">Bag</h3>

        {#if viewModel.items.length === 0}
          <div class="flex flex-col items-center gap-3 py-4 text-base-content/50">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <title>icon</title>
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
            <p class="text-sm font-medium">No items collected yet</p>
            <p class="text-xs">Walk up to items and press E to collect them</p>
          </div>
        {:else}
          <div class="grid grid-cols-4 gap-2 max-h-52 overflow-y-auto pr-1">
            {#each viewModel.items as item, index (index)}
              <div
                class="flex flex-col items-center gap-1 rounded-lg bg-base-200 p-3 transition-colors hover:bg-base-300"
              >
                <div class="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                  <span class="text-lg font-bold text-primary"
                    >{item.itemId.charAt(0).toUpperCase()}</span
                  >
                </div>
                <span class="text-xs font-medium text-base-content truncate w-full text-center">
                  {viewModel.getItemLabel(item.itemId)}
                </span>
                {#if item.quantity > 1}
                  <span class="badge badge-sm badge-primary">{item.quantity}</span>
                {/if}
                {#if viewModel.isEquippable(item.itemId)}
                  <span class="text-[10px] text-warning font-semibold">
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

        <!-- Footer hint -->
        <div class="flex justify-center pt-1">
          <kbd class="kbd kbd-sm text-xs opacity-60">I</kbd>
          <span class="mx-2 text-xs text-base-content/40 self-center">to close</span>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
