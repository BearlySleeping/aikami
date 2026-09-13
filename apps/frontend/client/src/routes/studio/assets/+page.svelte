<script lang="ts">
// apps/frontend/client/src/routes/studio/assets/+page.svelte
//
// Production Creator Studio route (C-512). Entered from the start menu's
// Advanced section; reachable without a campaign.
import { getStudioViewModel } from '$views/studio/studio_composition.ts';
import StudioView from '$views/studio/studio_view.svelte';

const viewModel = getStudioViewModel({ className: 'StudioViewModel' });
</script>

<StudioView {viewModel} />
