<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/inventory/+page.svelte
  //
  // Sandbox route for InventoryViewModel + DevTools

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import { inventoryService } from '$services';
  import InventoryView from '$views/inventory/inventory_view.svelte';
  import { getInventoryDevViewModel } from '$views/inventory/inventory_view_model.dev.svelte.ts';

  const viewModel = getInventoryDevViewModel({ className: 'InventoryDevViewModel' });

  const devActions = [
    {
      label: 'Fill with Junk',
      onClick: () => viewModel.fillWithJunk(),
    },
    {
      label: 'Clear Inventory',
      onClick: () => viewModel.clearInventory(),
    },
  ];
</script>

<div class="p-4 space-y-4">
  <button class="btn btn-primary" onclick={() => inventoryService.toggle()}>
    {inventoryService.isOpen ? 'Close Inventory' : 'Open Inventory'}
  </button>
</div>

{#if inventoryService.isOpen}
  <div class="absolute inset-0">
    <InventoryView {viewModel} />
  </div>
{/if}

<DevToolsPanel actions={devActions} />
