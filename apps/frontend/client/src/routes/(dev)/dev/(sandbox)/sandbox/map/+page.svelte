<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/sandbox/map/+page.svelte
//
// Isolated Map & Zoning sandbox route.
// Mounts a GameWorld with explicit map loading for visual testing of
// tilemaps, entity spawning, collision, camera, and map transitions.
//
// Contract: C-139 Task 2

import MapSandboxView from '$lib/views/dev/sandbox/map/map_sandbox_view.svelte';
import { getMapSandboxViewModel } from '$lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts';

const viewModel = getMapSandboxViewModel({
  className: 'MapSandboxViewModel',
});
</script>

<MapSandboxView {viewModel} />
