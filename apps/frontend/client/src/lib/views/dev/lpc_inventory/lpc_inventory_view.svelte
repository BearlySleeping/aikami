<script lang="ts">
import type { EquipmentSlot } from '@aikami/types';
// apps/frontend/client/src/lib/views/dev/lpc_inventory/lpc_inventory_view.svelte
//
// Dev sandbox view: live LPC character preview beside an inventory
// paperdoll + bag. Equipping/unequipping gear updates the LPC render in
// real time (C-374).
import { BaseViewModelContainer } from '$components';
import LpcAnimationDebugPanel from '$components/game/lpc_animation_debug_panel.svelte';
import LpcPreviewView from '$views/character/lpc_preview/lpc_preview_view.svelte';
import type { LpcInventoryViewModel } from './lpc_inventory_view_model.svelte';

type Props = {
  viewModel: LpcInventoryViewModel;
};

const { viewModel }: Props = $props();

/** Paperdoll grid placement per slot (3-column grid, 3 rows). */
const SLOT_GRID_CLASS: Record<EquipmentSlot, string> = {
  head: 'col-start-2 row-start-1',
  leftHand: 'col-start-1 row-start-2',
  body: 'col-start-2 row-start-2',
  rightHand: 'col-start-3 row-start-2',
  feet: 'col-start-2 row-start-3',
};
</script>

<BaseViewModelContainer
  {viewModel}
  class="h-[calc(100vh-4rem)] bg-base-100 text-base-content font-sans"
>
  <div class="grid grid-cols-[1fr_420px] h-full">
    <!-- Left: live LPC preview -->
    <div
      class="flex flex-col items-center justify-center bg-base-200 border-r border-base-300 gap-4 p-6 overflow-y-auto"
    >
      <h2 class="text-sm font-semibold text-primary uppercase tracking-wider">Live Character</h2>
      <LpcPreviewView viewModel={viewModel.lpcPreview} />

      <!-- Canvas zoom -->
      <fieldset class="border border-base-300 rounded-lg p-3 w-full max-w-sm bg-base-100 shrink-0">
        <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
          Canvas Zoom
        </legend>
        <label class="flex flex-col gap-1 text-xs text-base-content/60">
          Zoom: {viewModel.lpcPreview.zoom.toFixed(1)}x
          <input
            type="range"
            class="range range-sm range-primary w-full mt-1"
            min="0.5"
            max="8"
            step="0.1"
            value={viewModel.lpcPreview.zoom}
            oninput={(e: Event) => viewModel.lpcPreview.setZoom(Number.parseFloat((e.target as HTMLInputElement).value))}
          >
        </label>
      </fieldset>

      <!-- Animation debug panel (state / direction / playback ticker) -->
      <div
        class="w-full max-w-sm bg-base-100 rounded-lg border border-base-300 overflow-hidden shrink-0"
      >
        <LpcAnimationDebugPanel controller={viewModel.lpcPreview} />
      </div>

      <p class="text-xs text-base-content/50 max-w-sm text-center">
        Equip or unequip items on the right — the character updates instantly.
      </p>
    </div>

    <!-- Right: paperdoll + bag -->
    <div class="flex flex-col overflow-y-auto p-6 gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-base-content">Inventory</h2>
        <div class="flex gap-3">
          <div class="badge badge-outline gap-1 px-3 py-3">
            <span class="text-warning">⚔</span>
            <span class="font-semibold text-warning">{viewModel.totalAttack}</span>
            <span class="text-xs text-base-content/50">ATK</span>
          </div>
          <div class="badge badge-outline gap-1 px-3 py-3">
            <span class="text-info">🛡</span>
            <span class="font-semibold text-info">{viewModel.totalDefense}</span>
            <span class="text-xs text-base-content/50">DEF</span>
          </div>
        </div>
      </div>

      <div class="divider my-0"></div>

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

      <!-- Bag -->
      <h3 class="text-sm font-semibold text-base-content/70">Bag</h3>
      <div class="grid grid-cols-3 gap-2">
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
    </div>
  </div>
</BaseViewModelContainer>
