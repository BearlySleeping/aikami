<script lang="ts">
import CategoryView from '$views/catalog/category_view.svelte';
import { getCategoryViewModel } from '$views/catalog/category_view_model.svelte.ts';
// apps/frontend/hub/src/routes/(public)/catalog/[category]/+page.svelte
// One category's browse page (C-396 AC-2).
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = getCategoryViewModel({ data, className: 'CategoryViewModel' });
</script>

<CategoryView {viewModel} />
