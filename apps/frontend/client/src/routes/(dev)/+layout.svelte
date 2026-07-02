<script lang="ts">
  import { BaseDevViewModel } from '@aikami/frontend/services';
  // apps/frontend/client/src/routes/(dev)/+layout.svelte
  import DevView from '$lib/views/dev/layout/layout_view.dev.svelte';
  import { getDevViewModel } from '$lib/views/dev/layout/layout_view_model.dev.svelte.ts';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const isScreenshot = $state(BaseDevViewModel.isScreenshot());
  const viewModel = getDevViewModel({ className: 'DevViewModel' });
</script>

{#if isScreenshot}
  {@render children()}
{:else}
  <DevView {viewModel}> {@render children()} </DevView>
{/if}
