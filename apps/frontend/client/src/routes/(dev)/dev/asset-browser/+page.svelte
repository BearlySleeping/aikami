<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/asset-browser/+page.svelte
import AssetBrowserView from '$views/asset-browser/asset_browser_view.svelte';
import { getAssetBrowserViewModel } from '$views/asset-browser/asset_browser_view_model.svelte.ts';

const viewModel = getAssetBrowserViewModel({ className: 'AssetBrowserViewModel' });
</script>

<AssetBrowserView {viewModel} />
