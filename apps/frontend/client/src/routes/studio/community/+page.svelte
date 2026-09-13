<script lang="ts">
// apps/frontend/client/src/routes/studio/community/+page.svelte
//
// Production community browse/import route (C-513 AC-4). Reachable from the
// Creator Studio and by deep link.
import { getCommunityViewModel } from '$views/community/community_composition.ts';
import CommunityView from '$views/community/community_view.svelte';

const viewModel = getCommunityViewModel({ className: 'CommunityViewModel' });
</script>

<CommunityView {viewModel} />
