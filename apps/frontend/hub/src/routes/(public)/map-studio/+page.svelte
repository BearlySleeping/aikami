<script lang="ts">
// apps/frontend/hub/src/routes/(public)/map-studio/+page.svelte
// Map studio page: client-only route that mounts the manifest preview studio.

import MapStudioView from '$views/map_studio/map_studio_view.svelte';
import { getHubMapStudioViewModel } from '$views/map_studio/map_studio_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// Create the ViewModel once per data change ($derived re-evaluates only when deps change)
const viewModel = $derived(getHubMapStudioViewModel({ data, className: 'HubMapStudioViewModel' }));
</script>

<MapStudioView {viewModel} />
