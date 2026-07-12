<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/sandbox/vendor/+page.svelte
//
// Isolated Vendor Trading sandbox route.
// Mounts the VendorView with mock vendor data and AI responses.
// No game engine required — standalone dev tool.
//
// Contract: C-154 AI Vendors Economy

import VendorView from '$lib/views/vendor/vendor_view.svelte';
import { getVendorDevViewModel } from '$lib/views/vendor/vendor_view_model.dev.svelte.ts';
import type { VendorViewModelInterface } from '$lib/views/vendor/vendor_view_model.svelte';
import { inventoryService } from '$services';

// Seed starting gold for the sandbox so purchases can be tested.
inventoryService.addGold({ amount: 400 });

const viewModel: VendorViewModelInterface = getVendorDevViewModel({
  className: 'VendorSandboxVM',
  vendorId: 'sandbox-vendor',
  vendorName: "Grimbold's Forge",
  vendorInventory:
    'rustySword,ironSword,steelSword,woodenShield,leatherArmor,ironArmor,healthPotion,manaPotion',
});
</script>

<svelte:head>
  <title>Vendor Sandbox — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-black">
  <VendorView {viewModel} />
</div>
