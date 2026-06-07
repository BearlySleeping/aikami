<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/+layout.svelte
  import AppView from '$lib/views/app/app_view.svelte';
  import { getAppViewModel } from '$lib/views/app/app_view_model.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // svelte-ignore state_referenced_locally
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });
</script>

<AppView {viewModel}> {@render children()} </AppView>
