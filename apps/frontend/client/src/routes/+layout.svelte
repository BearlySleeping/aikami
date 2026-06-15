<script lang="ts">
  // apps/frontend/chat/src/routes/+layout.svelte
  import '../app.css';
  import { untrack } from 'svelte';
  import AppView from '$lib/views/app/app_view.svelte';
  import { getAppViewModel } from '$lib/views/app/app_view_model.svelte.ts';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // Layout data is static per SvelteKit mount — read non-reactively.
  const viewModel = untrack(() =>
    getAppViewModel({
      className: 'AppViewModel',
      data: data ?? {},
    }),
  );
</script>

<AppView {viewModel}> {@render children()} </AppView>
