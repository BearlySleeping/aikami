<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/inventory/+page.svelte
  //
  // Sandbox route for InventoryViewModel + DevTools
  // NEVER import production ViewModels or services here.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import { getInventoryDevViewModel } from '$views/inventory/inventory_dev_view_model.svelte';
  import InventoryView from '$views/inventory/inventory_view.svelte';

  const viewModel = getInventoryDevViewModel({
    className: 'InventoryDevViewModel',
  });

  /** Dev tools actions wired to InventoryDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Give Max Gold (999,999)',
      onClick: () => viewModel.giveMaxGold(),
    },
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

<InventoryView {viewModel} />

<DevToolsPanel actions={devActions} />
