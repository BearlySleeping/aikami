<script lang="ts">
// apps/frontend/client/src/routes/capability/+page.svelte
import { onMount } from 'svelte';
import CapabilityView from '$lib/views/capability/capability_view.svelte';
import { getCapabilityViewModel } from '$lib/views/capability/capability_view_model.svelte';

const viewModel = getCapabilityViewModel({ className: 'CapabilityViewModel' });

onMount(() => {
  void viewModel.initialize();
});
</script>

<CapabilityView {viewModel} />
