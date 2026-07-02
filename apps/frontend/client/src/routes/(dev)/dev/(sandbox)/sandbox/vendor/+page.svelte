<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/vendor/+page.svelte
  //
  // Isolated Vendor Trading sandbox route.
  // Mounts the VendorView with mock vendor data and AI responses.
  // No game engine required — standalone dev tool.
  //
  // Contract: C-154 AI Vendors Economy

  import VendorView from '$lib/views/vendor/vendor_view.svelte';
  import { VendorDevViewModel } from '$lib/views/vendor/vendor_view_model.dev.svelte.ts';
  import type { VendorViewModelInterface } from '$lib/views/vendor/vendor_view_model.svelte';
  import { gameStateService } from '$services';

  // Seed starting gold for the sandbox so purchases can be tested.
  gameStateService.addGold({ amount: 400 });

  // Navigate back on close — uses history.back() which is an SPA navigation
  // and preserves the GameStateService singleton (inventory + gold).
  const wrappedOnClose = () => {
    window.history.back();
  };

  const viewModel: VendorViewModelInterface = new VendorDevViewModel({
    className: 'VendorSandboxVM',
    vendorId: 'sandbox-vendor',
    vendorName: "Grimbold's Forge",
    vendorInventory:
      'rusty_sword,iron_sword,steel_sword,wooden_shield,leather_armor,iron_armor,health_potion,mana_potion',
    onClose: wrappedOnClose,
  });
</script>

<svelte:head>
  <title>Vendor Sandbox — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-black">
  <VendorView {viewModel} />
</div>
