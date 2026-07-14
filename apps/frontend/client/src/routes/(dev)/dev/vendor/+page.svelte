<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/vendor/+page.svelte
//
// Sandbox for testing VendorViewModel + vendor dialog.

import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
import { inventoryService, vendorService } from '$services';
import VendorView from '$views/vendor/vendor_view.svelte';
import { getVendorDevViewModel } from '$views/vendor/vendor_view_model.dev.svelte.ts';

// Seed starting gold
inventoryService.addGold({ amount: 400 });

const viewModel = getVendorDevViewModel({
  className: 'VendorDevVM',
  vendorId: 'sandbox-vendor',
  vendorName: "Grimbold's Forge",
  vendorInventory:
    'rustySword,ironSword,steelSword,woodenShield,leatherArmor,healthPotion,manaPotion',
}) as ReturnType<typeof getVendorDevViewModel> & { isHaggling: boolean; isBuying: boolean };
</script>

<div class="p-4 space-y-4">
  <button type="button" class="btn btn-primary" onclick={() => vendorService.toggle()}>
    {vendorService.isOpen ? 'Close Vendor' : 'Open Vendor'}
  </button>
</div>

{#if vendorService.isOpen}
  <div class="absolute inset-0">
    <VendorView {viewModel} />
  </div>
{/if}

<DevToolsPanel actions={[]} />
