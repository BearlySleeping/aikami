<script lang="ts">
import CatalogLandingView from '$views/catalog/catalog_landing_view.svelte';
import { getCatalogLandingViewModel } from '$views/catalog/catalog_landing_view_model.svelte.ts';
// apps/frontend/hub/src/routes/(public)/+page.svelte
// Catalog landing — renders for anyone, signed in or not (C-396 AC-1).
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// React to load reruns: $derived rebuilds the view model whenever `data`
// changes (e.g. catalog:root invalidation), so the copied categories/error
// state never goes stale after a refresh.
const viewModel = $derived(
  getCatalogLandingViewModel({ data, className: 'CatalogLandingViewModel' }),
);
</script>

<CatalogLandingView {viewModel} />
