<script lang="ts">
// apps/frontend/client/src/routes/capability/+page.svelte
import CapabilityView from '$views/capability/capability_view.svelte';
import { getCapabilityViewModel } from '$views/capability/capability_view_model.svelte';

const viewModel = getCapabilityViewModel({ className: 'CapabilityViewModel' });
</script>

<CapabilityView {viewModel} />
