<script lang="ts">
// apps/frontend/client/src/routes/link/+page.svelte
import LinkView from '$lib/views/link/link_view.svelte';
import { getLinkViewModel } from '$lib/views/link/link_view_model.svelte';

const viewModel = getLinkViewModel({ className: 'LinkViewModel' });
</script>

<LinkView {viewModel} />
