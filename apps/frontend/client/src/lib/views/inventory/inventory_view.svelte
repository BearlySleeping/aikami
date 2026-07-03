<script lang="ts">
  // apps/frontend/client/src/lib/views/inventory/inventory_view.svelte
  import type { InventoryViewModelInterface } from './inventory_view_model.svelte';

  type Props = {
    viewModel: InventoryViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: fullscreen backdrop must be div -->
<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="button"
  tabindex="0"
  aria-label="Close inventory"
  onclick={() => viewModel.closeInventory()}
  onkeydown={(e: KeyboardEvent) => e.key === 'Escape' && viewModel.closeInventory()}
>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: prevent backdrop close when clicking card -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: card is not interactive, just stops propagation -->
  <div
    class="card w-full max-w-md bg-base-100 shadow-xl"
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <div class="card-body p-6 gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-base-content">Inventory</h2>
        <button
          class="btn btn-sm btn-ghost btn-circle"
          onclick={() => viewModel.closeInventory()}
          aria-label="Close inventory"
        >
          ✕
        </button>
      </div>

      <div class="divider my-0"></div>

      <!-- Equipment Slots -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Weapon Slot -->
        <div class="rounded-lg bg-base-200 p-3 flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-md {viewModel.equippedWeaponDef ? 'bg-warning/20' : 'bg-base-300'}"
          >
            <span class="text-lg">
              {viewModel.equippedWeaponDef ? '⚔️' : '🗡️'}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs opacity-50">Weapon</div>
            <div class="text-sm font-medium truncate">
              {viewModel.equippedWeaponDef?.label ?? 'Empty'}
            </div>
            {#if viewModel.equippedWeaponDef}
              <div class="flex items-center gap-1 mt-1">
                <span class="text-xs text-warning"
                  >+{viewModel.equippedWeaponDef.attackBonus}
                  ATK</span
                >
                <button
                  class="btn btn-xs btn-ghost text-error"
                  onclick={() => viewModel.unequipItem('weapon')}
                  aria-label="Unequip weapon"
                >
                  Unequip
                </button>
              </div>
            {/if}
          </div>
        </div>

        <!-- Armor Slot -->
        <div class="rounded-lg bg-base-200 p-3 flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-md {viewModel.equippedArmorDef ? 'bg-info/20' : 'bg-base-300'}"
          >
            <span class="text-lg">
              {viewModel.equippedArmorDef ? '🛡️' : '👕'}
            </span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs opacity-50">Armor</div>
            <div class="text-sm font-medium truncate">
              {viewModel.equippedArmorDef?.label ?? 'Empty'}
            </div>
            {#if viewModel.equippedArmorDef}
              <div class="flex items-center gap-1 mt-1">
                <span class="text-xs text-info"
                  >+{viewModel.equippedArmorDef.defenseBonus}
                  DEF</span
                >
                <button
                  class="btn btn-xs btn-ghost text-error"
                  onclick={() => viewModel.unequipItem('armor')}
                  aria-label="Unequip armor"
                >
                  Unequip
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="divider my-0"></div>

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
        <div class="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
          {#each viewModel.items as item, index (index)}
            {@const definition = viewModel.isEquippable(item.itemId)}
            <div
              class="flex flex-col items-center gap-1 rounded-lg bg-base-200 p-3 transition-colors hover:bg-base-300"
            >
              <div class="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <span class="text-lg font-bold text-primary"
                  >{item.itemId.charAt(0).toUpperCase()}</span
                >
              </div>
              <span class="text-xs font-medium text-base-content truncate w-full text-center">
                {item.itemId}
              </span>
              {#if item.quantity > 1}
                <span class="badge badge-sm badge-primary">{item.quantity}</span>
              {/if}
              {#if definition}
                <button
                  class="btn btn-xs btn-primary btn-outline mt-1"
                  onclick={() => viewModel.equipItem(item.itemId)}
                  aria-label="Equip {item.itemId}"
                >
                  Equip
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
