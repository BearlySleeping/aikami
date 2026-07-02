<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/inventory/+page.svelte
  //
  // Sandbox route for InventoryViewModel + DevTools
  // NEVER import production ViewModels or services here.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import InventoryView from '$views/inventory/inventory_view.svelte';
  import { getInventoryDevViewModel } from '$views/inventory/inventory_view_model.dev.svelte.ts';

  const viewModel = getInventoryDevViewModel({
    className: 'InventoryDevViewModel',
    onClose: () => {},
  });

  /** Dev tools actions wired to InventoryDevViewModel sandbox methods. */
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

<InventoryView {viewModel} />

<DevToolsPanel actions={devActions} />
