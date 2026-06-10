<script lang="ts">
  // apps/frontend/pwa/src/lib/views/inventory/inventory_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { InventoryViewModelInterface } from './inventory_view_model.svelte.ts';

  type Props = {
    viewModel: InventoryViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="relative">
  <div class="flex flex-col gap-4 p-4">
    <!-- ═══ Gold Display ═══ -->
    <div class="rounded-lg border border-warning/30 bg-warning/5 p-3">
      <div class="flex items-center gap-2">
        <span class="text-lg">🪙</span>
        <span class="text-sm font-semibold text-warning">Gold</span>
        <span class="ml-auto text-sm font-bold tabular-nums text-base-content">
          {viewModel.gold.toLocaleString()}
        </span>
      </div>
    </div>

    <!-- ═══ Capacity Bar ═══ -->
    <div class="rounded-lg border border-base-300 bg-base-200 p-3">
      <div class="mb-1 flex items-center justify-between">
        <span class="text-xs font-semibold text-base-content/70">Capacity</span>
        <span class="text-xs tabular-nums text-base-content/50">
          {viewModel.usedSlots}
          / {viewModel.maxCapacity}
        </span>
      </div>
      <progress
        class="progress w-full"
        class:progress-success={viewModel.capacityPercent < 70}
        class:progress-warning={viewModel.capacityPercent >= 70 && viewModel.capacityPercent < 95}
        class:progress-error={viewModel.capacityPercent >= 95}
        value={viewModel.capacityPercent}
        max="100"
      ></progress>
    </div>

    <!-- ═══ Item List / Empty State ═══ -->
    {#if viewModel.isEmpty}
      <div
        class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-base-300 bg-base-100 p-12"
      >
        <div class="text-center">
          <span class="text-3xl">🎒</span>
          <p class="mt-2 text-lg font-semibold text-base-content/50">Your bag is empty</p>
          <p class="mt-1 text-sm text-base-content/30">Items you collect will appear here.</p>
        </div>
      </div>
    {:else}
      <div class="rounded-lg border border-base-300 bg-base-200">
        <div class="border-b border-base-300 px-4 py-2">
          <h2 class="text-sm font-semibold text-base-content/70">
            Items ({viewModel.items.length})
          </h2>
        </div>
        <ul class="divide-y divide-base-300">
          {#each viewModel.items as item (item.id)}
            <li class="flex items-center gap-3 px-4 py-3">
              <div class="flex-1">
                <span class="text-sm font-medium text-base-content">{item.name}</span>
                {#if item.quantity > 1}
                  <span class="ml-2 text-xs text-base-content/50"> ×{item.quantity} </span>
                {/if}
              </div>
              <div class="flex gap-1">
                <button
                  class="btn btn-xs btn-ghost text-base-content/50 hover:text-info"
                  onclick={() => viewModel.useItem(item.id)}
                  title="Use item"
                >
                  Use
                </button>
                <button
                  class="btn btn-xs btn-ghost text-base-content/50 hover:text-error"
                  onclick={() => viewModel.dropItem(item.id)}
                  title="Drop item"
                >
                  Drop
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- ═══ Full Warning ═══ -->
    {#if viewModel.isFull}
      <div class="rounded-lg border border-error/30 bg-error/5 p-3 text-center">
        <span class="text-sm font-semibold text-error">⚠ Inventory Full</span>
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
