<script lang="ts">
  import DevView from '$lib/views/dev/layout/dev_layout_view.svelte';
  // apps/frontend/client/src/routes/(dev)/+layout.svelte
  import { getDevViewModel } from '$lib/views/dev/layout/dev_layout_view_model.svelte';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const viewModel = getDevViewModel({ className: 'DevViewModel' });
</script>

<DevView {viewModel}> {@render children()} </DevView>
