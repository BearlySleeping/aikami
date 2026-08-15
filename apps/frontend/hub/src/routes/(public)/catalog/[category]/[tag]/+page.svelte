<script lang="ts">
import CatalogAssetView from '$views/catalog/catalog_asset_view.svelte';
import { getCatalogAssetViewModel } from '$views/catalog/catalog_asset_view_model.svelte.ts';
// apps/frontend/hub/src/routes/(public)/catalog/[category]/[tag]/+page.svelte
// Asset detail page (C-396 AC-3).
import type { PageProps } from './$types';

let { data }: PageProps = $props();

// React to parameter-only navigation (asset → asset) and load reruns:
// $derived rebuilds the view model whenever `data` changes, so the displayed
// entry/preview/stats never show a stale asset after navigation.
const viewModel = $derived(getCatalogAssetViewModel({ data, className: 'CatalogAssetViewModel' }));
</script>

<CatalogAssetView {viewModel} />
