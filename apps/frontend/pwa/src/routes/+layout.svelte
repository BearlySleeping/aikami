<script lang="ts">
  import '../app.css';
  import AppView from '$lib/views/app/AppView.svelte';
  import { getAppViewModel } from '$lib/views/app/app-view-model.svelte';
  import type { LayoutProps } from './$types';
  // Force Firebase to load early to ensure single instance
  import '@aikami/frontend/services/firebase/configs/firestore';

  let { data, children }: LayoutProps = $props();

  // svelte-ignore state_referenced_locally
  const viewModel = getAppViewModel({ data, className: 'AppViewModel' });
</script>

<AppView {viewModel}> {@render children()} </AppView>
