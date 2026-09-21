<script lang="ts">
// apps/frontend/hub/src/routes/(public)/community/[category]/+page.svelte
//
// One category's public community-asset browse page (C-513 AC-4).
import CommunityCategoryView from '$views/community/community_category_view.svelte';
import { getCommunityCategoryViewModel } from '$views/community/community_category_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// React to route data changes (a "next page" navigation): $derived rebuilds
// the view model whenever `data` changes, so the grid never shows a stale page.
const viewModel = $derived(
  getCommunityCategoryViewModel({ data, className: 'CommunityCategoryViewModel' }),
);
</script>

<CommunityCategoryView {viewModel} />
