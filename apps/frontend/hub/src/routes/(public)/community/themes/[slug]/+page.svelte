<script lang="ts">
// apps/frontend/hub/src/routes/(public)/community/themes/[slug]/+page.svelte
//
// One theme version's public detail page (C-530 AC-3 / AC-4).
import ThemeDetailView from '$views/community/theme_detail_view.svelte';
import { getThemeDetailViewModel } from '$views/community/theme_detail_view_model.svelte.ts';
import type { PageProps } from './$types';

let { data }: PageProps = $props();

const viewModel = $derived(
  getThemeDetailViewModel({ data, className: 'ThemeDetailViewModel' }),
);
</script>

<ThemeDetailView {viewModel} />
