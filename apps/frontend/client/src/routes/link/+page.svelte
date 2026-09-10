<script lang="ts">
import { getLinkViewModel } from '$lib/views/link/link_composition';
// apps/frontend/client/src/routes/link/+page.svelte
import LinkView from '$lib/views/link/link_view.svelte';

const viewModel = getLinkViewModel({ className: 'LinkViewModel', startWithLoadingView: true });
</script>

<LinkView {viewModel} />
