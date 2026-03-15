<script lang="ts">
  import '../app.css';
  import AppView from '$lib/views/app/AppView.svelte';
  import { getAppViewModel } from '$lib/views/app/app-view-model.svelte';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // svelte-ignore state_referenced_locally
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });
</script>

<AppView {viewModel}> {@render children()} </AppView>
