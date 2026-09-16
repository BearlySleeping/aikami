<script lang="ts">
// apps/frontend/hub/src/routes/(public)/community/themes/+page.svelte
//
// The public theme listing page (C-530 AC-3).
import ThemeListingView from '$views/community/theme_listing_view.svelte';
import { getThemeListingViewModel } from '$views/community/theme_listing_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// React to route data changes (a "next page" navigation): $derived rebuilds
// the view model whenever `data` changes, so the grid never shows a stale page.
const viewModel = $derived(getThemeListingViewModel({ data, className: 'ThemeListingViewModel' }));
</script>

<ThemeListingView {viewModel} />
