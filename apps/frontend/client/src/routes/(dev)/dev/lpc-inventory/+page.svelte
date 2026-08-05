<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/lpc-inventory/+page.svelte
//
// Dev sandbox: live LPC character preview + inventory paperdoll.
// Equipping/unequipping gear updates the LPC render in real time (C-374).
import LpcInventoryView from '$views/dev/lpc_inventory/lpc_inventory_view.svelte';
import { getLpcInventoryViewModel } from '$views/dev/lpc_inventory/lpc_inventory_view_model.svelte';

const viewModel = getLpcInventoryViewModel({ className: 'LpcInventoryViewModel' });
</script>

<LpcInventoryView {viewModel} />
