<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/studio/+page.svelte
//
// Dev sandbox for the C-512 Creator Studio. Same ViewModel + View as the
// production route, so the sandbox cannot drift from what players see.
import { getStudioViewModel } from '$views/studio/studio_composition.ts';
import StudioView from '$views/studio/studio_view.svelte';

const viewModel = getStudioViewModel({ className: 'StudioViewModel' });
</script>

<StudioView {viewModel} />
