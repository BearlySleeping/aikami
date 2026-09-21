<script lang="ts">
import { getAssetBrowserViewModel } from '$views/asset-browser/asset_browser_composition.ts';
// apps/frontend/client/src/routes/(dev)/dev/asset-browser/+page.svelte
import AssetBrowserView from '$views/asset-browser/asset_browser_view.svelte';

const viewModel = getAssetBrowserViewModel({ className: 'AssetBrowserViewModel' });
</script>

<AssetBrowserView {viewModel} />
