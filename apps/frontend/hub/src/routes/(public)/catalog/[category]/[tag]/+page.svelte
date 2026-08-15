<script lang="ts">
import CatalogAssetView from '$views/catalog/catalog_asset_view.svelte';
import { getCatalogAssetViewModel } from '$views/catalog/catalog_asset_view_model.svelte.ts';
// apps/frontend/hub/src/routes/(public)/catalog/[category]/[tag]/+page.svelte
// Asset detail page (C-396 AC-3).
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = getCatalogAssetViewModel({ data, className: 'CatalogAssetViewModel' });
</script>

<CatalogAssetView {viewModel} />
